//! A2A ⇄ ACP bridge: turns collaboration messages into ACP prompts and streams
//! the agents' replies back as A2A task artifacts.
//!
//! Port of `packages/server/src/api/a2a-collab/bridge-runner.ts`.
//!
//! Four collaboration modes, identical to the TS implementation:
//!
//! - **01 single**      route one prompt to one session (explicit / role /
//!   orchestrator / keyword);
//! - **02 pipeline**    sequential handoff, static order or orchestrator-decided;
//! - **03 parallel**    fan out sub-tasks (bounded concurrency), optional aggregator;
//! - **04 voluntary**   broadcast, collect claims, hand off to the winner.
//!
//! ACP only allows one prompt per session at a time, so prompts to the same
//! session are serialized through a per-session lock.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use indexmap::IndexMap;
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::mpsc;

use crate::a2a::events::{
    STATE_CANCELED, STATE_COMPLETED, STATE_FAILED, STATE_SUBMITTED, STATE_WORKING, agent_message,
    artifact_event, extract_agent_chunk, extract_text, task_event, task_snapshot, task_status,
    text_part,
};
use crate::a2a::spaces::{CollabSpace, CollabSpaceStore, resolve_member_id};
use crate::acp::{AgentRegistry, SessionManager};

const DEFAULT_MAX_TURNS: i64 = 10;
const HARD_MAX_TURNS: i64 = 30;
const DEFAULT_MAX_CONCURRENCY: usize = 4;
const HARD_MAX_CONCURRENCY: usize = 8;
/// Keeps handoff / responsibility prompts from ballooning.
const CONTEXT_OUTPUT_MAX_LEN: usize = 8000;
/// Task snapshots retained for `GetTask` (oldest finished ones are dropped).
const MAX_STORED_TASKS: usize = 200;

// ---------------------------------------------------------------------------
// metadata.collab contract shared with the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineConfig {
    /// `static` | `orchestrated`.
    #[serde(default)]
    pub mode: String,
    /// static: ordered member references (participantId / sessionId / agentId).
    #[serde(default)]
    pub order: Option<Vec<String>>,
    #[serde(default)]
    pub orchestrator_agent_id: Option<String>,
    #[serde(default)]
    pub max_turns: Option<Value>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelSubTask {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub target_agent_id: Option<String>,
    #[serde(default)]
    pub target_role: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParallelConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub sub_tasks: Option<Vec<ParallelSubTask>>,
    #[serde(default)]
    pub aggregator_agent_id: Option<String>,
    #[serde(default)]
    pub max_concurrency: Option<Value>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoluntaryConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub max_turns: Option<Value>,
    #[serde(default)]
    pub conflict_resolution: Option<String>,
    #[serde(default)]
    pub priority_order: Option<Vec<String>>,
}

/// `metadata.collab` contract shared with the frontend.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabMetadata {
    #[serde(default)]
    pub space_id: Option<String>,
    #[serde(default)]
    pub participant_ids: Option<Vec<String>>,
    #[serde(default)]
    pub agent_ids: Option<Vec<String>>,
    /// Target member (participantId / sessionId / agentId).
    #[serde(default)]
    pub target_participant_id: Option<String>,
    /// Legacy alias of `target_participant_id`.
    #[serde(default)]
    pub target_agent_id: Option<String>,
    #[serde(default)]
    pub target_role: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub pipeline: Option<PipelineConfig>,
    #[serde(default)]
    pub parallel: Option<ParallelConfig>,
    #[serde(default)]
    pub voluntary: Option<VoluntaryConfig>,
}

/// One task run requested through the JSON-RPC surface.
pub struct RunInput {
    pub task_id: String,
    pub context_id: String,
    pub user_message: Value,
    /// `SendMessageRequest.metadata` (top-level).
    pub request_metadata: Option<Value>,
    /// Forces the target agent (per-agent A2A servers).
    pub forced_agent_id: Option<String>,
    /// Stream sink; `None` for the non-streaming `SendMessage` path.
    pub sink: Option<mpsc::UnboundedSender<Value>>,
}

#[derive(Debug)]
enum PromptFailure {
    Timeout,
    Failed(String),
}

impl PromptFailure {
    /// `Calling <label> timed out after Nms` / the raw error.
    fn describe_calling(&self, label: &str, timeout: Duration) -> String {
        match self {
            Self::Timeout => format!("Calling {label} timed out after {}ms", timeout.as_millis()),
            Self::Failed(message) => message.clone(),
        }
    }

    /// `<label> timed out after Nms` / the raw error.
    fn describe_plain(&self, label: &str, timeout: Duration) -> String {
        match self {
            Self::Timeout => format!("{label} timed out after {}ms", timeout.as_millis()),
            Self::Failed(message) => message.clone(),
        }
    }
}

/// Per-run cancellation flag + the session currently being prompted.
#[derive(Default)]
pub struct RunState {
    cancelled: AtomicBool,
    session_id: Mutex<Option<String>>,
}

impl RunState {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    fn set_session(&self, session_id: Option<&str>) {
        let mut guard = self
            .session_id
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *guard = session_id.map(str::to_string);
    }

    pub fn session(&self) -> Option<String> {
        self.session_id
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
}

/// Per-run event context (frame ids, stream sink, accumulated artifacts).
struct RunContext {
    task_id: String,
    context_id: String,
    user_message: Value,
    sink: Option<mpsc::UnboundedSender<Value>>,
    run: Arc<RunState>,
    artifacts: Mutex<Vec<Value>>,
}

impl RunContext {
    fn publish(&self, response: Value) {
        if let Some(sink) = &self.sink {
            let _ = sink.send(response);
        }
    }
}

#[derive(Debug, Clone)]
struct SubTaskResult {
    sub_task_id: String,
    member_id: String,
    output: String,
    ok: bool,
    error: Option<String>,
}

#[derive(Debug, Clone)]
struct MemberClaim {
    member_id: String,
    reason: String,
}

pub struct BridgeRunner {
    sessions: Arc<SessionManager>,
    spaces: Arc<CollabSpaceStore>,
    registry: Arc<AgentRegistry>,
    timeout: Duration,
    route_timeout: Duration,
    active: Mutex<HashMap<String, Arc<RunState>>>,
    /// Per-session FIFO: serializes prompts targeting the same ACP session.
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Last known task snapshot per task id (`GetTask`).
    tasks: Mutex<IndexMap<String, Value>>,
}

impl BridgeRunner {
    pub fn new(
        sessions: Arc<SessionManager>,
        spaces: Arc<CollabSpaceStore>,
        registry: Arc<AgentRegistry>,
        timeout: Duration,
        route_timeout: Duration,
    ) -> Arc<Self> {
        Arc::new(Self {
            sessions,
            spaces,
            registry,
            timeout,
            route_timeout,
            active: Mutex::new(HashMap::new()),
            locks: Mutex::new(HashMap::new()),
            tasks: Mutex::new(IndexMap::new()),
        })
    }

    /// Same defaults and env keys as the TS server.
    pub fn from_env(
        sessions: Arc<SessionManager>,
        spaces: Arc<CollabSpaceStore>,
        registry: Arc<AgentRegistry>,
    ) -> Arc<Self> {
        let timeout = env_millis("A2A_BRIDGE_TIMEOUT_MS", 10 * 60 * 1000);
        let route_timeout = env_millis("A2A_ROUTE_TIMEOUT_MS", 30 * 1000);
        Self::new(sessions, spaces, registry, timeout, route_timeout)
    }

    pub fn task(&self, task_id: &str) -> Option<Value> {
        self.tasks
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(task_id)
            .cloned()
    }

    /// Cancel an in-flight task (A2A `CancelTask`).
    pub async fn cancel(&self, task_id: &str) {
        let run = self
            .active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(task_id)
            .cloned();
        let Some(run) = run else {
            return;
        };
        run.cancel();
        if let Some(session_id) = run.session() {
            self.sessions.dispatch_cancel(&session_id);
        }
    }

    pub fn is_active(&self, task_id: &str) -> bool {
        self.active
            .lock()
            .map(|active| active.contains_key(task_id))
            .unwrap_or(false)
    }

    /// Run one collaboration task to completion.
    pub async fn run(self: &Arc<Self>, input: RunInput) {
        let run = Arc::new(RunState::default());
        let ctx = RunContext {
            task_id: input.task_id.clone(),
            context_id: input.context_id.clone(),
            user_message: input.user_message.clone(),
            sink: input.sink.clone(),
            run: Arc::clone(&run),
            artifacts: Mutex::new(Vec::new()),
        };
        self.active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(ctx.task_id.clone(), Arc::clone(&run));

        self.dispatch(&ctx, &input).await;

        self.active
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(&ctx.task_id);
    }

    async fn dispatch(self: &Arc<Self>, ctx: &RunContext, input: &RunInput) {
        // 1. Streaming turns must begin with a Task event.
        let snapshot = self.store_task(ctx, STATE_SUBMITTED, None);
        ctx.publish(task_event(snapshot));

        let prompt_text = extract_text(&input.user_message);
        self.set_status(
            ctx,
            STATE_WORKING,
            Some("Selecting the target session…"),
            None,
        );
        if ctx.run.is_cancelled() {
            self.set_status(ctx, STATE_CANCELED, Some("Task canceled"), None);
            return;
        }

        let Some(collab) = read_collab_metadata(input) else {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some(
                    "Missing collaboration space info (message.metadata.collab); create a collaboration space first.",
                ),
                None,
            );
            return;
        };

        let Some(space) = self.spaces.get(collab.space_id.as_deref()) else {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some(
                    "Collaboration space does not exist or is closed; recreate the collaboration space.",
                ),
                None,
            );
            return;
        };

        let parallel_enabled = collab
            .parallel
            .as_ref()
            .map(|parallel| parallel.enabled)
            .unwrap_or(false);
        // Parallel mode may carry its work entirely in `parallel.subTasks`.
        if prompt_text.is_empty() && !parallel_enabled {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some("Send text content as the collaboration task."),
                None,
            );
            return;
        }

        let forced = input.forced_agent_id.as_deref();
        if parallel_enabled {
            self.run_parallel(ctx, &collab, &space).await;
        } else if collab
            .voluntary
            .as_ref()
            .map(|voluntary| voluntary.enabled)
            .unwrap_or(false)
        {
            self.run_voluntary(ctx, &collab, &space, &prompt_text, forced)
                .await;
        } else if collab.pipeline.is_some() {
            self.run_pipeline(ctx, &collab, &space, &prompt_text, forced)
                .await;
        } else {
            self.run_single(ctx, &collab, &space, &prompt_text, forced)
                .await;
        }
    }

    // ==========================================================================
    // Event helpers
    // ==========================================================================

    fn set_status(
        &self,
        ctx: &RunContext,
        state: &str,
        text: Option<&str>,
        metadata: Option<Value>,
    ) {
        let status = task_status(
            state,
            text.map(|text| agent_message(&ctx.task_id, &ctx.context_id, text)),
        );
        self.record_task(ctx, status.clone());
        ctx.publish(crate::a2a::events::status_event(
            &ctx.task_id,
            &ctx.context_id,
            status,
            metadata,
        ));
    }

    fn store_task(&self, ctx: &RunContext, state: &str, text: Option<&str>) -> Value {
        let status = task_status(
            state,
            text.map(|text| agent_message(&ctx.task_id, &ctx.context_id, text)),
        );
        self.record_task(ctx, status)
    }

    fn record_task(&self, ctx: &RunContext, status: Value) -> Value {
        let artifacts = ctx
            .artifacts
            .lock()
            .map(|artifacts| artifacts.clone())
            .unwrap_or_default();
        let task = task_snapshot(
            &ctx.task_id,
            &ctx.context_id,
            status,
            artifacts,
            vec![ctx.user_message.clone()],
            ctx.user_message.get("metadata").cloned(),
        );
        let mut tasks = self
            .tasks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        tasks.insert(ctx.task_id.clone(), task.clone());
        // Bound the store: drop the oldest *finished* snapshot. (The TS SDK's
        // in-memory store never evicts, which is a slow leak on long sessions.)
        while tasks.len() > MAX_STORED_TASKS {
            let evictable = tasks
                .keys()
                .find(|task_id| !self.is_active(task_id))
                .cloned();
            match evictable {
                Some(task_id) => {
                    tasks.shift_remove(&task_id);
                }
                None => break,
            }
        }
        task
    }

    fn turn_meta(&self, space: &CollabSpace, member_id: &str, turn: i64) -> Value {
        let mut meta = json!({ "turn": turn, "participantId": member_id });
        if let Some(info) = space.member(member_id) {
            meta["agentId"] = json!(info.agent_id);
        }
        if let Some(session_id) = space.session_of(member_id) {
            meta["sessionId"] = json!(session_id);
        }
        if let Some(role) = space.member(member_id).and_then(|info| info.role.clone()) {
            meta["role"] = json!(role);
        }
        meta
    }

    fn agent_label(&self, agent_id: &str) -> String {
        self.registry
            .get_agent_config(agent_id)
            .map(|config| config.name)
            .unwrap_or_else(|| agent_id.to_string())
    }

    fn member_label(&self, space: &CollabSpace, member_id: &str) -> String {
        space
            .member(member_id)
            .map(|info| self.agent_label(&info.agent_id))
            .unwrap_or_else(|| member_id.to_string())
    }

    // ==========================================================================
    // 01 — single-target collaboration
    // ==========================================================================

    async fn run_single(
        &self,
        ctx: &RunContext,
        collab: &CollabMetadata,
        space: &CollabSpace,
        prompt_text: &str,
        forced_agent_id: Option<&str>,
    ) {
        let mut target = explicit_target(space, collab, forced_agent_id);

        if target.is_none() {
            target = role_target(space, collab.target_role.as_deref());
            if let Some(member_id) = target.clone() {
                let label = self.member_label(space, &member_id);
                let role = collab.target_role.clone().unwrap_or_default();
                self.set_status(
                    ctx,
                    STATE_WORKING,
                    Some(&format!("Routed to {label} by role \"{role}\"…")),
                    None,
                );
            }
        }

        let mut routed_by_orchestrator = false;
        if target.is_none() && space.orchestrator_id.is_some() {
            let routed = self.route_via_orchestrator(ctx, space, prompt_text).await;
            if ctx.run.is_cancelled() {
                self.set_status(ctx, STATE_CANCELED, Some("Task canceled"), None);
                return;
            }
            match routed {
                Some(member_id) => {
                    target = Some(member_id);
                    routed_by_orchestrator = true;
                }
                None => self.set_status(
                    ctx,
                    STATE_WORKING,
                    Some(
                        "Orchestrator routing found no match; falling back to rule-based routing…",
                    ),
                    None,
                ),
            }
        }
        if target.is_none() {
            target = keyword_target(&self.registry, space, prompt_text);
        }
        let Some(target) = target else {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some(
                    "Cannot determine the target session: specify metadata.collab.targetParticipantId / targetRole, or select a session in the collaboration space.",
                ),
                None,
            );
            return;
        };

        let Some(_) = space.session_of(&target) else {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some(&format!(
                    "The collaboration space does not contain session \"{target}\"."
                )),
                None,
            );
            return;
        };

        let label = self.member_label(space, &target);
        self.set_status(
            ctx,
            STATE_WORKING,
            Some(&format!(
                "{} {label}; calling…",
                if routed_by_orchestrator {
                    "Orchestrator selected"
                } else {
                    "Routed to"
                }
            )),
            Some(self.turn_meta(space, &target, 1)),
        );

        let artifact_id = format!("{}-reply", ctx.task_id);
        match self
            .prompt_member(
                ctx,
                space,
                &target,
                prompt_text,
                &artifact_id,
                json!({ "turn": 1 }),
            )
            .await
        {
            Ok((_, cancelled)) => {
                if cancelled || ctx.run.is_cancelled() {
                    self.set_status(ctx, STATE_CANCELED, Some(&format!("{label} canceled")), None);
                    return;
                }
                self.set_status(
                    ctx,
                    STATE_COMPLETED,
                    Some(&format!("{label} reply completed")),
                    Some(self.turn_meta(space, &target, 1)),
                );
            }
            Err(error) => {
                let message = error.describe_calling(&label, self.timeout);
                tracing::error!("[A2A Collab] Single task {} failed: {message}", ctx.task_id);
                self.set_status(
                    ctx,
                    STATE_FAILED,
                    Some(&format!("Calling {label} failed: {message}")),
                    None,
                );
            }
        }
    }

    /// Asks the space's orchestrator session which member should answer.
    async fn route_via_orchestrator(
        &self,
        ctx: &RunContext,
        space: &CollabSpace,
        prompt_text: &str,
    ) -> Option<String> {
        let orchestrator_id = space.orchestrator_id.clone()?;
        let session_id = space.session_of(&orchestrator_id)?.clone();

        self.set_status(
            ctx,
            STATE_WORKING,
            Some("Orchestrator is selecting the target session…"),
            None,
        );

        let prompt = build_routing_prompt(&self.registry, space, prompt_text);
        let reply = self
            .ask_raw(&ctx.run, &session_id, &prompt, self.route_timeout)
            .await;
        let reply = reply?;
        if ctx.run.is_cancelled() {
            return None;
        }

        let ids = space.member_ids();
        let target = parse_routing_reply(&self.registry, &reply, space, &ids);
        match &target {
            Some(target) => tracing::info!(
                "[A2A Collab] Orchestrator selected {target} (space: {}) for: {}",
                space.id,
                prompt_text.chars().take(120).collect::<String>()
            ),
            None => tracing::warn!(
                "[A2A Collab] Orchestrator reply unparsable (space: {}), falling back to rules: {}",
                space.id,
                reply.chars().take(200).collect::<String>()
            ),
        }
        target
    }

    // ==========================================================================
    // 02 — pipeline / sequential collaboration
    // ==========================================================================

    async fn run_pipeline(
        &self,
        ctx: &RunContext,
        collab: &CollabMetadata,
        space: &CollabSpace,
        prompt_text: &str,
        forced_agent_id: Option<&str>,
    ) {
        let Some(pipeline) = collab.pipeline.clone() else {
            return;
        };
        let max_turns = clamp_turns(pipeline.max_turns.as_ref());

        // Static execution order (defaults to the space member order).
        let mut order: Vec<String> = pipeline
            .order
            .clone()
            .filter(|order| !order.is_empty())
            .unwrap_or_else(|| space.member_ids())
            .iter()
            .filter_map(|reference| resolve_member_id(space, Some(reference)))
            .collect();

        let current = explicit_target(space, collab, forced_agent_id)
            .or_else(|| role_target(space, collab.target_role.as_deref()))
            .or_else(|| order.first().cloned());
        let Some(mut current) = current else {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some(
                    "The pipeline has no executable session; check the collaboration space configuration.",
                ),
                None,
            );
            return;
        };
        if pipeline.mode == "static" && !order.contains(&current) {
            order.insert(0, current.clone());
        }

        let mut current_prompt = prompt_text.to_string();
        let mut prev: Option<String> = None;
        let mut pending_meta = json!({});
        let mut turn = 0i64;

        while turn < max_turns {
            turn += 1;
            let label = self.member_label(space, &current);
            let role = space
                .member(&current)
                .and_then(|info| info.role.clone());
            let mut meta = self.turn_meta(space, &current, turn);
            if let Some(prev) = &prev {
                meta["prevParticipantId"] = json!(prev);
                if let Some(session_id) = space.session_of(prev) {
                    meta["prevSessionId"] = json!(session_id);
                }
            }
            self.set_status(
                ctx,
                STATE_WORKING,
                Some(&format!("Turn {turn}: calling {label}…")),
                Some(meta),
            );

            let mut artifact_meta = json!({ "turn": turn });
            if let Some(prev) = &prev {
                artifact_meta["prevParticipantId"] = json!(prev);
                if let Some(session_id) = space.session_of(prev) {
                    artifact_meta["prevSessionId"] = json!(session_id);
                }
            }
            if let Value::Object(pending) = &pending_meta {
                for (key, value) in pending {
                    artifact_meta[key] = value.clone();
                }
            }

            let artifact_id = format!("{}-reply-{turn}", ctx.task_id);
            let result = self
                .prompt_member(
                    ctx,
                    space,
                    &current,
                    &current_prompt,
                    &artifact_id,
                    artifact_meta,
                )
                .await;

            let (output, cancelled) = match result {
                Ok(result) => result,
                Err(error) => {
                    let message = error.describe_calling(&label, self.timeout);
                    tracing::error!(
                        "[A2A Collab] Pipeline task {} failed at turn {turn}: {message}",
                        ctx.task_id
                    );
                    self.set_status(
                        ctx,
                        STATE_FAILED,
                        Some(&format!("Turn {turn} calling {label} failed: {message}")),
                        None,
                    );
                    return;
                }
            };
            if cancelled || ctx.run.is_cancelled() {
                self.set_status(
                    ctx,
                    STATE_CANCELED,
                    Some(&format!("Turn {turn} canceled")),
                    None,
                );
                return;
            }

            let finished = current.clone();
            prev = Some(finished.clone());
            pending_meta = json!({});

            let next = if pipeline.mode == "static" {
                order
                    .iter()
                    .position(|member_id| member_id == &finished)
                    .and_then(|index| order.get(index + 1).cloned())
            } else {
                self.decide_next_via_orchestrator(ctx, space, &pipeline, &finished, &output)
                    .await
            };
            if ctx.run.is_cancelled() {
                self.set_status(ctx, STATE_CANCELED, Some("Task canceled"), None);
                return;
            }
            let Some(next) = next else {
                break;
            };

            let next_label = self.member_label(space, &next);
            let mut handoff_meta = json!({ "turn": turn, "prevParticipantId": finished });
            if let Some(session_id) = space.session_of(&finished) {
                handoff_meta["prevSessionId"] = json!(session_id);
            }
            self.set_status(
                ctx,
                STATE_WORKING,
                Some(&format!("Turn {turn} done; {next_label} takes over…")),
                Some(handoff_meta),
            );
            current = next;
            current_prompt = build_handoff_prompt(role.as_deref(), &output, None);
        }

        self.set_status(
            ctx,
            STATE_COMPLETED,
            Some("Pipeline collaboration task finished"),
            None,
        );
    }

    /// Asks the pipeline orchestrator which session should run next.
    async fn decide_next_via_orchestrator(
        &self,
        ctx: &RunContext,
        space: &CollabSpace,
        pipeline: &PipelineConfig,
        current_member_id: &str,
        prior_output: &str,
    ) -> Option<String> {
        let orchestrator_id = resolve_member_id(space, pipeline.orchestrator_agent_id.as_deref())
            .or_else(|| space.orchestrator_id.clone());
        let candidates: Vec<String> = space
            .member_ids()
            .into_iter()
            .filter(|member_id| member_id != current_member_id)
            .collect();
        if candidates.is_empty() {
            return None;
        }
        let Some(orchestrator_id) = orchestrator_id else {
            // No orchestrator configured: fall back to declaration order.
            return candidates.first().cloned();
        };
        let Some(session_id) = space.session_of(&orchestrator_id).cloned() else {
            return candidates.first().cloned();
        };

        self.set_status(
            ctx,
            STATE_WORKING,
            Some("Orchestrator is deciding the next session…"),
            None,
        );
        let prompt = build_pipeline_decision_prompt(
            &self.registry,
            space,
            current_member_id,
            &truncate(prior_output, CONTEXT_OUTPUT_MAX_LEN),
        );
        let reply = self
            .ask_raw(&ctx.run, &session_id, &prompt, self.route_timeout)
            .await;
        let Some(reply) = reply else {
            return candidates.first().cloned();
        };

        let next = parse_pipeline_decision(&reply, &candidates);
        if next.is_none() {
            tracing::info!(
                "[A2A Collab] Pipeline orchestrator ended the flow (space: {})",
                space.id
            );
        }
        next
    }

    // ==========================================================================
    // 03 — parallel division of labour
    // ==========================================================================

    async fn run_parallel(
        &self,
        ctx: &RunContext,
        collab: &CollabMetadata,
        space: &CollabSpace,
    ) {
        let Some(parallel) = collab.parallel.clone() else {
            return;
        };
        let sub_tasks: Vec<ParallelSubTask> = parallel
            .sub_tasks
            .unwrap_or_default()
            .into_iter()
            .filter(|task| !task.prompt.trim().is_empty())
            .collect();
        if sub_tasks.is_empty() {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some("Parallel mode has no valid sub-tasks (parallel.subTasks)."),
                None,
            );
            return;
        }
        let max_concurrency = clamp_concurrency(parallel.max_concurrency.as_ref());

        self.set_status(
            ctx,
            STATE_WORKING,
            Some(&format!(
                "Dispatching {} sub-tasks (max concurrency {max_concurrency})…",
                sub_tasks.len()
            )),
            None,
        );

        let results: Vec<SubTaskResult> = {
            // Declaration order for the summary sort (completion order differs).
            let declaration: HashMap<String, usize> = sub_tasks
                .iter()
                .enumerate()
                .map(|(index, task)| (task.id.clone(), index))
                .collect();
            let mut results: Vec<SubTaskResult> = futures_util::stream::iter(
                sub_tasks
                    .into_iter()
                    .map(|sub_task| self.run_parallel_sub_task(ctx, space, sub_task)),
            )
            .buffer_unordered(max_concurrency)
            .collect()
            .await;
            results.sort_by_key(|result| {
                declaration
                    .get(&result.sub_task_id)
                    .copied()
                    .unwrap_or(usize::MAX)
            });
            results
        };

        if ctx.run.is_cancelled() {
            self.set_status(
                ctx,
                STATE_CANCELED,
                Some("Parallel task canceled"),
                None,
            );
            return;
        }

        let aggregator_id = resolve_member_id(space, parallel.aggregator_agent_id.as_deref());
        if let Some(aggregator_id) = aggregator_id {
            let label = self.member_label(space, &aggregator_id);
            let mut meta = self.turn_meta(space, &aggregator_id, 2);
            meta["turn"] = json!(2);
            self.set_status(
                ctx,
                STATE_WORKING,
                Some(&format!("{label} is aggregating sub-task results…")),
                Some(meta),
            );
            let prompt = build_summary_prompt(&results, |member_id| {
                self.member_label(space, member_id)
            });
            let artifact_id = format!("{}-summary", ctx.task_id);
            let result = self
                .prompt_member(
                    ctx,
                    space,
                    &aggregator_id,
                    &prompt,
                    &artifact_id,
                    json!({ "turn": 2, "subTaskId": "summary" }),
                )
                .await;
            match result {
                Ok((_, cancelled)) => {
                    if cancelled || ctx.run.is_cancelled() {
                        self.set_status(
                            ctx,
                            STATE_CANCELED,
                            Some("Aggregation canceled"),
                            None,
                        );
                        return;
                    }
                }
                Err(error) => {
                    let message = error.describe_plain(&label, self.timeout);
                    tracing::error!("[A2A Collab] Parallel aggregator failed: {message}");
                    self.set_status(
                        ctx,
                        STATE_FAILED,
                        Some(&format!("Aggregation failed: {message}")),
                        None,
                    );
                    return;
                }
            }
        }

        let failed = results.iter().filter(|result| !result.ok).count();
        self.set_status(
            ctx,
            STATE_COMPLETED,
            Some(&if failed > 0 {
                format!("Parallel task finished ({failed} sub-task(s) failed)")
            } else {
                "Parallel task finished".to_string()
            }),
            None,
        );
    }

    async fn run_parallel_sub_task(
        &self,
        ctx: &RunContext,
        space: &CollabSpace,
        sub_task: ParallelSubTask,
    ) -> SubTaskResult {
        let member_id = resolve_member_id(space, sub_task.target_agent_id.as_deref())
            .or_else(|| role_target(space, sub_task.target_role.as_deref()))
            .or_else(|| keyword_target(&self.registry, space, &sub_task.prompt));
        let Some(member_id) = member_id else {
            return SubTaskResult {
                sub_task_id: sub_task.id,
                member_id: String::new(),
                output: String::new(),
                ok: false,
                error: Some("Cannot determine the target session".to_string()),
            };
        };
        let label = self.member_label(space, &member_id);
        let artifact_id = format!("{}-sub-{}", ctx.task_id, sub_task.id);
        match self
            .prompt_member(
                ctx,
                space,
                &member_id,
                &sub_task.prompt,
                &artifact_id,
                json!({ "turn": 1, "subTaskId": sub_task.id }),
            )
            .await
        {
            Ok((output, cancelled)) => {
                if cancelled || ctx.run.is_cancelled() {
                    SubTaskResult {
                        sub_task_id: sub_task.id,
                        member_id,
                        output,
                        ok: false,
                        error: Some("canceled".to_string()),
                    }
                } else {
                    SubTaskResult {
                        sub_task_id: sub_task.id,
                        member_id,
                        output,
                        ok: true,
                        error: None,
                    }
                }
            }
            Err(error) => {
                let message = error.describe_plain(&label, self.timeout);
                tracing::error!(
                    "[A2A Collab] Parallel sub-task {} failed: {message}",
                    sub_task.id
                );
                SubTaskResult {
                    sub_task_id: sub_task.id,
                    member_id,
                    output: String::new(),
                    ok: false,
                    error: Some(message),
                }
            }
        }
    }

    // ==========================================================================
    // 04 — voluntary claim / competitive handoff
    // ==========================================================================

    async fn run_voluntary(
        &self,
        ctx: &RunContext,
        collab: &CollabMetadata,
        space: &CollabSpace,
        prompt_text: &str,
        forced_agent_id: Option<&str>,
    ) {
        let Some(voluntary) = collab.voluntary.clone() else {
            return;
        };
        let max_turns = clamp_turns(voluntary.max_turns.as_ref());
        let resolution = voluntary
            .conflict_resolution
            .clone()
            .unwrap_or_else(|| "first-come".to_string());

        let mut pending_meta = json!({});
        let mut current = explicit_target(space, collab, forced_agent_id)
            .or_else(|| role_target(space, collab.target_role.as_deref()));

        if current.is_none() && space.orchestrator_id.is_some() {
            let routed = self.route_via_orchestrator(ctx, space, prompt_text).await;
            if ctx.run.is_cancelled() {
                self.set_status(ctx, STATE_CANCELED, Some("Task canceled"), None);
                return;
            }
            current = routed;
        }

        if current.is_none() {
            self.set_status(
                ctx,
                STATE_WORKING,
                Some("Initial phase: broadcasting the user task to all sessions and collecting claims…"),
                None,
            );
            let task_section = format!(
                "User task:\n{}",
                truncate(prompt_text, CONTEXT_OUTPUT_MAX_LEN)
            );
            let (claims, relinquished, cancelled) = self
                .collect_claims(ctx, space, &space.member_ids(), &task_section)
                .await;
            if cancelled {
                self.set_status(ctx, STATE_CANCELED, Some("Task canceled"), None);
                return;
            }
            if !claims.is_empty() {
                let winner = self.pick_claim(
                    space,
                    &claims,
                    &resolution,
                    voluntary.priority_order.as_deref(),
                );
                let label = self.member_label(space, &winner.member_id);
                current = Some(winner.member_id.clone());
                pending_meta = json!({
                    "claimReason": winner.reason,
                    "relinquishedBy": relinquished,
                });
                self.set_status(
                    ctx,
                    STATE_WORKING,
                    Some(&format!(
                        "Initial task: {label} claimed{}…",
                        if claims.len() > 1 {
                            format!(" ({} competing)", claims.len())
                        } else {
                            String::new()
                        }
                    )),
                    None,
                );
            } else {
                current = space.member_ids().first().cloned();
                self.set_status(
                    ctx,
                    STATE_WORKING,
                    Some("Nobody claimed in the initial phase; falling back to the first session."),
                    None,
                );
            }
        }

        let Some(mut current) = current else {
            self.set_status(
                ctx,
                STATE_FAILED,
                Some("The collaboration space has no executable session."),
                None,
            );
            return;
        };

        let mut current_prompt = prompt_text.to_string();
        let mut prev: Option<String> = None;
        let mut turn = 0i64;

        while turn < max_turns {
            turn += 1;
            let label = self.member_label(space, &current);
            let role = space.member(&current).and_then(|info| info.role.clone());
            let mut meta = self.turn_meta(space, &current, turn);
            if let Some(prev) = &prev {
                meta["prevParticipantId"] = json!(prev);
                if let Some(session_id) = space.session_of(prev) {
                    meta["prevSessionId"] = json!(session_id);
                }
            }
            self.set_status(
                ctx,
                STATE_WORKING,
                Some(&format!("Turn {turn}: {label} is working…")),
                Some(meta),
            );

            let mut artifact_meta = json!({ "turn": turn });
            if let Some(prev) = &prev {
                artifact_meta["prevParticipantId"] = json!(prev);
                if let Some(session_id) = space.session_of(prev) {
                    artifact_meta["prevSessionId"] = json!(session_id);
                }
            }
            if let Value::Object(pending) = &pending_meta {
                for (key, value) in pending {
                    artifact_meta[key] = value.clone();
                }
            }

            let artifact_id = format!("{}-reply-{turn}", ctx.task_id);
            let result = self
                .prompt_member(
                    ctx,
                    space,
                    &current,
                    &current_prompt,
                    &artifact_id,
                    artifact_meta,
                )
                .await;
            let (output, cancelled) = match result {
                Ok(result) => result,
                Err(error) => {
                    let message = error.describe_calling(&label, self.timeout);
                    tracing::error!(
                        "[A2A Collab] Voluntary task {} failed at turn {turn}: {message}",
                        ctx.task_id
                    );
                    self.set_status(
                        ctx,
                        STATE_FAILED,
                        Some(&format!("Turn {turn} calling {label} failed: {message}")),
                        None,
                    );
                    return;
                }
            };
            if cancelled || ctx.run.is_cancelled() {
                self.set_status(
                    ctx,
                    STATE_CANCELED,
                    Some(&format!("Turn {turn} canceled")),
                    None,
                );
                return;
            }

            let finished = current.clone();
            prev = Some(finished.clone());

            let candidates: Vec<String> = space
                .member_ids()
                .into_iter()
                .filter(|member_id| member_id != &finished)
                .collect();
            if candidates.is_empty() {
                break;
            }

            let mut judge_meta = json!({ "turn": turn, "prevParticipantId": finished });
            if let Some(session_id) = space.session_of(&finished) {
                judge_meta["prevSessionId"] = json!(session_id);
            }
            self.set_status(
                ctx,
                STATE_WORKING,
                Some(&format!(
                    "Turn {turn} done; remaining members are judging whether to claim…"
                )),
                Some(judge_meta),
            );

            let (claims, relinquished, cancelled) = {
                let prior_description = match role.as_deref() {
                    Some(role) => format!("{label} {role}"),
                    None => label.clone(),
                };
                let section = format!(
                    "Output of {prior_description}:\n{}",
                    truncate(&output, CONTEXT_OUTPUT_MAX_LEN)
                );
                self.collect_claims(ctx, space, &candidates, &section)
                    .await
            };
            if cancelled {
                self.set_status(ctx, STATE_CANCELED, Some("Task canceled"), None);
                return;
            }
            if claims.is_empty() {
                self.set_status(
                    ctx,
                    STATE_WORKING,
                    Some("Nobody claimed; collaboration ends."),
                    None,
                );
                break;
            }

            let next = self.pick_claim(space, &claims, &resolution, voluntary.priority_order.as_deref());
            let next_label = self.member_label(space, &next.member_id);
            let mut next_meta = self.turn_meta(space, &next.member_id, turn);
            next_meta["turn"] = json!(turn);
            self.set_status(
                ctx,
                STATE_WORKING,
                Some(&format!(
                    "Turn {turn}: {next_label} claimed{}…",
                    if claims.len() > 1 {
                        format!(" ({} competing)", claims.len())
                    } else {
                        String::new()
                    }
                )),
                Some(next_meta),
            );

            current = next.member_id.clone();
            current_prompt = build_handoff_prompt(role.as_deref(), &output, Some(&next.reason));
            pending_meta = json!({
                "claimReason": next.reason,
                "relinquishedBy": relinquished,
            });
        }

        self.set_status(
            ctx,
            STATE_COMPLETED,
            Some("Voluntary-claim collaboration task finished"),
            None,
        );
    }

    /// Runs the claim-judgement prompt for one candidate and returns its claim
    /// reason, or `None` when it passes.
    async fn ask_claim(
        &self,
        ctx: &RunContext,
        space: &CollabSpace,
        candidate_id: &str,
        task_section: &str,
    ) -> Option<String> {
        let session_id = space.session_of(candidate_id)?.clone();
        let info = space.member(candidate_id);
        let role = info
            .and_then(|info| info.role.clone())
            .unwrap_or_else(|| "Collaborator".to_string());
        let responsibility = info
            .and_then(|info| info.responsibility.clone())
            .unwrap_or_else(|| "Judge according to your responsibilities".to_string());
        let prompt = [
            format!("You are \"{role}\". Your responsibility: {responsibility}."),
            String::new(),
            task_section.to_string(),
            String::new(),
            "Judge: do you need to take over and continue processing?".to_string(),
            "- If yes, reply with ONLY: Claim: <reason>".to_string(),
            "- If no, reply with ONLY: relinquish".to_string(),
        ]
        .join("\n");

        let reply = self
            .ask_raw(&ctx.run, &session_id, &prompt, self.route_timeout)
            .await;
        parse_claim_verdict(reply.as_deref())
    }

    /// Polls every candidate in declaration order and collects claims / passes.
    ///
    /// `task_section` is the material each candidate judges against (the user
    /// task or the previous session's output).
    async fn collect_claims(
        &self,
        ctx: &RunContext,
        space: &CollabSpace,
        candidate_ids: &[String],
        task_section: &str,
    ) -> (Vec<MemberClaim>, Vec<String>, bool) {
        let mut claims = Vec::new();
        let mut relinquished = Vec::new();
        for candidate_id in candidate_ids {
            let reason = self
                .ask_claim(ctx, space, candidate_id, task_section)
                .await;
            if ctx.run.is_cancelled() {
                return (claims, relinquished, true);
            }
            match reason {
                Some(reason) => claims.push(MemberClaim {
                    member_id: candidate_id.clone(),
                    reason,
                }),
                None => relinquished.push(candidate_id.clone()),
            }
        }
        (claims, relinquished, false)
    }

    /// Applies the configured conflict-resolution rule to pick one claimer.
    fn pick_claim(
        &self,
        space: &CollabSpace,
        claims: &[MemberClaim],
        resolution: &str,
        priority_order: Option<&[String]>,
    ) -> MemberClaim {
        if resolution == "priority"
            && let Some(priority_order) = priority_order
        {
            for reference in priority_order {
                let Some(wanted) = resolve_member_id(space, Some(reference)) else {
                    continue;
                };
                if let Some(hit) = claims.iter().find(|claim| claim.member_id == wanted) {
                    return hit.clone();
                }
            }
        }
        if resolution == "random" && claims.len() > 1 {
            let bytes = uuid::Uuid::new_v4();
            let index = bytes.as_bytes()[0] as usize % claims.len();
            return claims[index].clone();
        }
        // first-come: candidates were polled in member order.
        claims[0].clone()
    }

    // ==========================================================================
    // Shared ACP plumbing
    // ==========================================================================

    /// Runs one member prompt, streaming `agent_message_chunk` deltas as
    /// appending artifact updates and returning the accumulated text.
    #[allow(clippy::too_many_arguments)]
    async fn prompt_member(
        &self,
        ctx: &RunContext,
        space: &CollabSpace,
        member_id: &str,
        prompt_text: &str,
        artifact_id: &str,
        metadata: Value,
    ) -> Result<(String, bool), PromptFailure> {
        let Some(session_id) = space.session_of(member_id).cloned() else {
            return Ok((String::new(), false));
        };
        let label = self.member_label(space, member_id);
        let mut artifact_meta = metadata;
        artifact_meta["participantId"] = json!(member_id);
        if let Some(info) = space.member(member_id) {
            artifact_meta["agentId"] = json!(info.agent_id);
            if let Some(role) = &info.role {
                artifact_meta["role"] = json!(role);
            }
        }
        artifact_meta["sessionId"] = json!(session_id);
        let description = format!("{label}'s reply");

        let lock = self.session_lock(&session_id);
        let _guard = lock.lock().await;

        if ctx.run.is_cancelled() {
            return Ok((String::new(), true));
        }
        ctx.run.set_session(Some(&session_id));

        let output = Arc::new(Mutex::new(String::new()));
        let chunk_published = Arc::new(AtomicBool::new(false));
        let callback = {
            let output = Arc::clone(&output);
            let chunk_published = Arc::clone(&chunk_published);
            let sink = ctx.sink.clone();
            let task_id = ctx.task_id.clone();
            let context_id = ctx.context_id.clone();
            let artifact_id = artifact_id.to_string();
            let artifact_meta = artifact_meta.clone();
            let description = description.clone();
            Arc::new(move |event: Value| {
                let Some(delta) = extract_agent_chunk(&event) else {
                    return;
                };
                if let Ok(mut output) = output.lock() {
                    output.push_str(&delta);
                }
                let append = chunk_published.swap(true, Ordering::SeqCst);
                if let Some(sink) = &sink {
                    let payload = artifact_event(
                        &task_id,
                        &context_id,
                        &artifact_id,
                        "AgentReply",
                        &description,
                        vec![text_part(delta)],
                        artifact_meta.clone(),
                        append,
                        false,
                    );
                    let _ = sink.send(payload);
                }
            })
        };

        let content = json!([{ "type": "text", "text": prompt_text }]);
        let result = tokio::time::timeout(
            self.timeout,
            self.sessions
                .prompt_and_wait(&session_id, content, Some(callback)),
        )
        .await;

        ctx.run.set_session(None);

        let output_text = output
            .lock()
            .map(|output| output.clone())
            .unwrap_or_default();
        let published = chunk_published.load(Ordering::SeqCst);

        match result {
            Ok(Ok(value)) => {
                let stop_reason = value
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn");
                let cancelled = ctx.run.is_cancelled() || stop_reason == "cancelled";
                if published && !cancelled {
                    let payload = artifact_event(
                        &ctx.task_id,
                        &ctx.context_id,
                        artifact_id,
                        "AgentReply",
                        &description,
                        Vec::new(),
                        artifact_meta.clone(),
                        true,
                        true,
                    );
                    ctx.publish(payload);
                    if let Ok(mut artifacts) = ctx.artifacts.lock() {
                        artifacts.push(json!({
                            "artifactId": artifact_id,
                            "name": "AgentReply",
                            "description": description,
                            "parts": [text_part(output_text.clone())],
                            "metadata": artifact_meta,
                        }));
                    }
                }
                Ok((output_text, cancelled))
            }
            Ok(Err(error)) => Err(PromptFailure::Failed(error)),
            Err(_) => {
                self.sessions.dispatch_cancel(&session_id);
                Err(PromptFailure::Timeout)
            }
        }
    }

    /// Runs an internal (non-streamed) prompt, e.g. orchestrator routing or a
    /// voluntary-claim judgement. Returns `None` on failure / cancel so callers
    /// fall back to rules.
    async fn ask_raw(
        &self,
        run: &RunState,
        session_id: &str,
        prompt_text: &str,
        timeout: Duration,
    ) -> Option<String> {
        let reply = Arc::new(Mutex::new(String::new()));

        let lock = self.session_lock(session_id);
        let _guard = lock.lock().await;
        if run.is_cancelled() {
            return None;
        }
        run.set_session(Some(session_id));

        let callback = {
            let reply = Arc::clone(&reply);
            Arc::new(move |event: Value| {
                if let Some(delta) = extract_agent_chunk(&event)
                    && let Ok(mut reply) = reply.lock()
                {
                    reply.push_str(&delta);
                }
            })
        };

        let content = json!([{ "type": "text", "text": prompt_text }]);
        let result = tokio::time::timeout(
            timeout,
            self.sessions
                .prompt_and_wait(session_id, content, Some(callback)),
        )
        .await;
        run.set_session(None);

        match result {
            Ok(Ok(_)) => {
                if run.is_cancelled() {
                    return None;
                }
                reply.lock().ok().map(|reply| reply.clone())
            }
            Ok(Err(error)) => {
                tracing::warn!("[A2A Collab] Internal prompt failed (session: {session_id}): {error}");
                None
            }
            Err(_) => {
                self.sessions.dispatch_cancel(session_id);
                tracing::warn!("[A2A Collab] Internal prompt timed out (session: {session_id})");
                None
            }
        }
    }

    fn session_lock(&self, session_id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self
            .locks
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        Arc::clone(
            locks
                .entry(session_id.to_string())
                .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
        )
    }
}

// ==========================================================================
// Metadata / routing helpers
// ==========================================================================

fn read_collab_metadata(input: &RunInput) -> Option<CollabMetadata> {
    let from_request = input
        .request_metadata
        .as_ref()
        .and_then(|metadata| metadata.get("collab"));
    let from_message = input
        .user_message
        .get("metadata")
        .and_then(|metadata| metadata.get("collab"));
    let raw = from_request.or(from_message)?;
    serde_json::from_value(raw.clone()).ok()
}

/// Deterministic first tier: explicit member reference or a forced agent.
fn explicit_target(
    space: &CollabSpace,
    collab: &CollabMetadata,
    forced_agent_id: Option<&str>,
) -> Option<String> {
    if let Some(forced) = forced_agent_id
        && let Some(member_id) = resolve_member_id(space, Some(forced))
    {
        return Some(member_id);
    }
    resolve_member_id(space, collab.target_participant_id.as_deref())
        .or_else(|| resolve_member_id(space, collab.target_agent_id.as_deref()))
}

/// Session-role routing tier.
fn role_target(space: &CollabSpace, target_role: Option<&str>) -> Option<String> {
    let wanted = target_role.map(str::trim).unwrap_or_default();
    if wanted.is_empty() {
        return None;
    }
    space
        .members
        .values()
        .find(|member| member.role.as_deref() == Some(wanted))
        .map(|member| member.id.clone())
}

/// Fallback tier: keyword match against participantId / agentId / name / role /
/// capabilities, else the first member.
fn keyword_target(registry: &AgentRegistry, space: &CollabSpace, prompt_text: &str) -> Option<String> {
    let ids = space.member_ids();
    if ids.is_empty() {
        return None;
    }
    let normalized = prompt_text.to_lowercase();
    for member_id in &ids {
        let Some(info) = space.member(member_id) else {
            continue;
        };
        let mut keys: Vec<String> = vec![member_id.clone(), info.agent_id.clone()];
        if let Some(config) = registry.get_agent_config(&info.agent_id) {
            keys.push(config.name);
        }
        if let Some(role) = &info.role {
            keys.push(role.clone());
        }
        if let Some(capabilities) = &info.capabilities {
            keys.extend(capabilities.iter().cloned());
        }
        if keys
            .iter()
            .filter(|key| !key.is_empty())
            .any(|key| normalized.contains(&key.to_lowercase()))
        {
            return Some(member_id.clone());
        }
    }
    ids.first().cloned()
}

fn build_member_catalog(
    registry: &AgentRegistry,
    space: &CollabSpace,
    exclude_member_id: Option<&str>,
) -> String {
    space
        .member_ids()
        .into_iter()
        .filter(|member_id| Some(member_id.as_str()) != exclude_member_id)
        .map(|member_id| {
            let info = space.member(&member_id);
            let name = info
                .map(|info| {
                    registry
                        .get_agent_config(&info.agent_id)
                        .map(|config| config.name)
                        .unwrap_or_else(|| info.agent_id.clone())
                })
                .unwrap_or_else(|| member_id.clone());
            let mut line = format!("- {member_id}: {name}");
            if let Some(info) = info {
                line.push_str(&format!(", agent: {}", info.agent_id));
                if let Some(role) = &info.role {
                    line.push_str(&format!(", role: {role}"));
                }
                if let Some(responsibility) = &info.responsibility {
                    line.push_str(&format!(", responsibility: {responsibility}"));
                }
            }
            line
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn build_routing_prompt(registry: &AgentRegistry, space: &CollabSpace, question: &str) -> String {
    let ids = space.member_ids();
    [
        "You are the orchestrator of a multi-agent collaboration.".to_string(),
        "Decide which single session should answer the user question below.".to_string(),
        String::new(),
        "Available sessions:".to_string(),
        build_member_catalog(registry, space, None),
        String::new(),
        "Rules:".to_string(),
        "- Reply with ONLY a JSON object, no markdown fences and no explanation:".to_string(),
        "  {\"memberId\":\"<id>\"}".to_string(),
        format!("- memberId must be exactly one of: {}", ids.join(", ")),
        "- You may pick yourself if you are the best fit.".to_string(),
        "- Pick the single best fit; never list multiple sessions.".to_string(),
        String::new(),
        "User question:".to_string(),
        question.to_string(),
    ]
    .join("\n")
}

fn build_pipeline_decision_prompt(
    registry: &AgentRegistry,
    space: &CollabSpace,
    current_member_id: &str,
    prior_output: &str,
) -> String {
    let role = space
        .member(current_member_id)
        .and_then(|info| info.role.clone());
    let current_line = match role {
        Some(role) => format!("- {current_member_id} (role: {role})"),
        None => format!("- {current_member_id}"),
    };
    let remaining = build_member_catalog(registry, space, Some(current_member_id));
    [
        "You are the orchestrator of a sequential (pipeline) multi-agent collaboration.".to_string(),
        "The current session just finished a step. Decide who should handle the next step.".to_string(),
        String::new(),
        "Current session:".to_string(),
        current_line,
        String::new(),
        "Remaining sessions:".to_string(),
        if remaining.is_empty() {
            "- (none)".to_string()
        } else {
            remaining
        },
        String::new(),
        "Rules:".to_string(),
        "- Reply with ONLY a JSON object, no markdown fences and no explanation.".to_string(),
        "- To continue, reply: {\"memberId\":\"<id>\"} where <id> is one of the remaining sessions."
            .to_string(),
        "- If the task is complete, reply: {\"done\":true}".to_string(),
        String::new(),
        "Output of the current step:".to_string(),
        prior_output.to_string(),
    ]
    .join("\n")
}

/// Builds the known-reference → memberId map used to parse routing replies.
fn member_aliases(
    registry: &AgentRegistry,
    space: &CollabSpace,
    ids: &[String],
) -> HashMap<String, String> {
    let mut known = HashMap::new();
    for member_id in ids {
        known.insert(member_id.to_lowercase(), member_id.clone());
        let Some(info) = space.member(member_id) else {
            continue;
        };
        known.insert(info.agent_id.to_lowercase(), member_id.clone());
        if let Some(config) = registry.get_agent_config(&info.agent_id)
            && !config.name.is_empty()
        {
            known.insert(config.name.to_lowercase(), member_id.clone());
        }
        if let Some(role) = &info.role {
            known.insert(role.to_lowercase(), member_id.clone());
        }
    }
    known
}

/// Extracts a quoted JSON string field (`"memberId": "..."`) case-insensitively.
fn extract_quoted_field(text: &str, name: &str) -> Option<String> {
    let lower = text.to_ascii_lowercase();
    let needle = format!("\"{}\"", name.to_ascii_lowercase());
    let mut start = 0;
    while let Some(index) = lower[start..].find(&needle) {
        let after = start + index + needle.len();
        let rest = text[after..].trim_start();
        if let Some(rest) = rest.strip_prefix(':') {
            let rest = rest.trim_start();
            if let Some(rest) = rest.strip_prefix('"')
                && let Some(end) = rest.find('"')
            {
                return Some(rest[..end].to_string());
            }
        }
        start = after;
    }
    None
}

/// Extracts a target member from a routing reply.
fn parse_routing_reply(
    registry: &AgentRegistry,
    reply: &str,
    space: &CollabSpace,
    ids: &[String],
) -> Option<String> {
    let text = reply.trim();
    if text.is_empty() {
        return None;
    }
    let known = member_aliases(registry, space, ids);

    if let Some(field) =
        extract_quoted_field(text, "memberId").or_else(|| extract_quoted_field(text, "agentId"))
        && let Some(hit) = known.get(&field.trim().to_lowercase())
    {
        return Some(hit.clone());
    }

    let lower = text.to_lowercase();
    let found: HashSet<String> = known
        .iter()
        .filter(|(key, _)| !key.is_empty() && lower.contains(key.as_str()))
        .map(|(_, member_id)| member_id.clone())
        .collect();
    (found.len() == 1).then(|| found.into_iter().next().unwrap())
}

/// Pipeline decision reply → next memberId, or `None` when done.
fn parse_pipeline_decision(reply: &str, candidate_ids: &[String]) -> Option<String> {
    let text = reply.trim();
    if text.is_empty() {
        return None;
    }
    if has_json_true(text, "done") {
        return None;
    }
    if let Some(field) =
        extract_quoted_field(text, "memberId").or_else(|| extract_quoted_field(text, "agentId"))
    {
        let reference = field.trim();
        return candidate_ids
            .iter()
            .find(|candidate| candidate.as_str() == reference)
            .cloned();
    }
    let lower = text.to_lowercase();
    let found: Vec<&String> = candidate_ids
        .iter()
        .filter(|candidate| lower.contains(&candidate.to_lowercase()))
        .collect();
    (found.len() == 1).then(|| found[0].clone())
}

/// `"done"\s*:\s*true` (case-insensitive).
fn has_json_true(text: &str, name: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let needle = format!("\"{}\"", name.to_ascii_lowercase());
    let mut start = 0;
    while let Some(index) = lower[start..].find(&needle) {
        let after = start + index + needle.len();
        let rest = text[after..].trim_start();
        if let Some(rest) = rest.strip_prefix(':') {
            let rest = rest.trim_start();
            if rest.to_ascii_lowercase().starts_with("true") {
                return true;
            }
        }
        start = after;
    }
    false
}

/// Parses a voluntary-claim verdict; a non-empty string means "claim".
fn parse_claim_verdict(reply: Option<&str>) -> Option<String> {
    let reply = reply?;
    // ASCII-only lowercasing keeps byte offsets aligned with `reply`.
    let lower: String = reply
        .chars()
        .map(|ch| ch.to_ascii_lowercase())
        .collect();
    let index = find_word(&lower, "claim")?;
    let after = reply[index + "claim".len()..].trim_start();
    // Only a `claim: <reason>` prefix is stripped; otherwise the whole reply is
    // the reason (same as the TS regex, which requires the colon).
    let reason = after
        .strip_prefix(':')
        .or_else(|| after.strip_prefix('：'))
        .map(str::trim)
        .unwrap_or_default();
    let text = if reason.is_empty() {
        reply.trim()
    } else {
        reason
    };
    Some(text.chars().take(200).collect())
}

/// Finds `word` in `haystack` (already lowercased) on a word boundary.
fn find_word(haystack: &str, word: &str) -> Option<usize> {
    let mut start = 0;
    while let Some(index) = haystack[start..].find(word) {
        let begin = start + index;
        let end = begin + word.len();
        let before_ok = haystack[..begin]
            .chars()
            .next_back()
            .map(|ch| !ch.is_alphanumeric() && ch != '_')
            .unwrap_or(true);
        let after_ok = haystack[end..]
            .chars()
            .next()
            .map(|ch| !ch.is_alphanumeric() && ch != '_')
            .unwrap_or(true);
        if before_ok && after_ok {
            return Some(begin);
        }
        start = end;
    }
    None
}

fn build_handoff_prompt(role: Option<&str>, prior_output: &str, claim_reason: Option<&str>) -> String {
    let role_label = role
        .map(|role| format!(" (role: {role})"))
        .unwrap_or_default();
    let claim = claim_reason
        .map(|reason| format!("You have claimed to continue. Claim reason: {reason}\n\n"))
        .unwrap_or_default();
    format!(
        "{claim}Output from the previous session{role_label}:\n{}\n\nContinue working from it, following your role and responsibilities.",
        truncate(prior_output, CONTEXT_OUTPUT_MAX_LEN)
    )
}

/// Builds the aggregator prompt for parallel mode.
fn build_summary_prompt(results: &[SubTaskResult], label_of: impl Fn(&str) -> String) -> String {
    let sections: Vec<String> = results
        .iter()
        .map(|result| {
            let label = if result.member_id.is_empty() {
                "Unknown session".to_string()
            } else {
                label_of(&result.member_id)
            };
            if result.ok {
                format!(
                    "## Sub-task {} (session: {} / {label})\n{}",
                    result.sub_task_id,
                    result.member_id,
                    truncate(&result.output, CONTEXT_OUTPUT_MAX_LEN)
                )
            } else {
                format!(
                    "## Sub-task {} (session: {} / {label})\n[FAILED] {}",
                    result.sub_task_id,
                    result.member_id,
                    result.error.as_deref().unwrap_or("unknown error")
                )
            }
        })
        .collect();
    let mut parts = vec![
        "The following are sub-task results completed in parallel by multiple sessions. Aggregate them into one complete, well-organized conclusion.".to_string(),
        "Keep the key information of each result, point out conflicts, and give a final recommendation.".to_string(),
        String::new(),
    ];
    parts.extend(sections);
    parts.join("\n\n")
}

fn clamp_turns(value: Option<&Value>) -> i64 {
    let parsed = value.and_then(value_to_f64).unwrap_or(0.0);
    if !parsed.is_finite() || parsed <= 0.0 {
        return DEFAULT_MAX_TURNS;
    }
    (parsed.floor() as i64).clamp(1, HARD_MAX_TURNS)
}

fn clamp_concurrency(value: Option<&Value>) -> usize {
    let parsed = value.and_then(value_to_f64).unwrap_or(0.0);
    if !parsed.is_finite() || parsed <= 0.0 {
        return DEFAULT_MAX_CONCURRENCY;
    }
    (parsed.floor() as i64).clamp(1, HARD_MAX_CONCURRENCY as i64) as usize
}

/// `Number(value)`: accepts numbers and numeric strings.
fn value_to_f64(value: &Value) -> Option<f64> {
    match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn truncate(text: &str, max: usize) -> String {
    let length = text.chars().count();
    if length <= max {
        return text.to_string();
    }
    format!(
        "{}\n…(output truncated, total {length} chars)",
        text.chars().take(max).collect::<String>()
    )
}

fn env_millis(key: &str, default: u64) -> Duration {
    let millis = std::env::var(key)
        .ok()
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| value as u64)
        .unwrap_or(default);
    Duration::from_millis(millis)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::a2a::spaces::CollabMember;

    fn space() -> CollabSpace {
        let mut members = IndexMap::new();
        members.insert(
            "p1".to_string(),
            CollabMember {
                id: "p1".to_string(),
                agent_id: "opencode".to_string(),
                role: Some("reviewer".to_string()),
                responsibility: Some("review code".to_string()),
                capabilities: Some(vec!["code_review".to_string()]),
            },
        );
        members.insert(
            "p2".to_string(),
            CollabMember {
                id: "p2".to_string(),
                agent_id: "claude".to_string(),
                role: Some("writer".to_string()),
                responsibility: None,
                capabilities: None,
            },
        );
        let mut sessions = HashMap::new();
        sessions.insert("p1".to_string(), "acp-1".to_string());
        sessions.insert("p2".to_string(), "acp-2".to_string());
        CollabSpace {
            id: "space-1".to_string(),
            cwd: "/tmp".to_string(),
            members,
            sessions,
            config_options: HashMap::new(),
            orchestrator_id: Some("p1".to_string()),
            created_at: 0,
        }
    }

    fn registry() -> Arc<AgentRegistry> {
        AgentRegistry::new(
            vec![
                crate::acp::AgentConfig {
                    id: "opencode".to_string(),
                    name: "OpenCode".to_string(),
                    command: "opencode".to_string(),
                    ..Default::default()
                },
                crate::acp::AgentConfig {
                    id: "claude".to_string(),
                    name: "Claude".to_string(),
                    command: "claude".to_string(),
                    ..Default::default()
                },
            ],
            Arc::new(crate::events::EventSink::default()),
        )
    }

    #[test]
    fn metadata_parses_the_frontend_contract() {
        let input = RunInput {
            task_id: "t".to_string(),
            context_id: "c".to_string(),
            user_message: json!({
                "parts": [{ "text": "hello" }],
                "metadata": {
                    "collab": {
                        "spaceId": "space-1",
                        "participantIds": ["p1"],
                        "pipeline": { "mode": "static", "order": ["p1", "p2"], "maxTurns": "4" },
                        "parallel": {
                            "enabled": true,
                            "subTasks": [{ "id": "s1", "prompt": "go", "targetRole": "reviewer" }],
                            "maxConcurrency": 2
                        },
                        "voluntary": { "enabled": true, "conflictResolution": "priority" }
                    }
                }
            }),
            request_metadata: None,
            forced_agent_id: None,
            sink: None,
        };
        let collab = read_collab_metadata(&input).expect("collab");
        assert_eq!(collab.space_id.as_deref(), Some("space-1"));
        assert_eq!(collab.pipeline.as_ref().map(|p| p.mode.as_str()), Some("static"));
        assert_eq!(clamp_turns(collab.pipeline.as_ref().unwrap().max_turns.as_ref()), 4);
        let parallel = collab.parallel.expect("parallel");
        assert!(parallel.enabled);
        assert_eq!(parallel.sub_tasks.expect("sub tasks")[0].prompt, "go");
        assert_eq!(clamp_concurrency(parallel.max_concurrency.as_ref()), 2);
        assert_eq!(
            collab.voluntary.expect("voluntary").conflict_resolution.as_deref(),
            Some("priority")
        );

        let missing = RunInput {
            task_id: "t".to_string(),
            context_id: "c".to_string(),
            user_message: json!({ "parts": [] }),
            request_metadata: None,
            forced_agent_id: None,
            sink: None,
        };
        assert!(read_collab_metadata(&missing).is_none());
    }

    #[test]
    fn turns_and_concurrency_are_clamped() {
        assert_eq!(clamp_turns(None), DEFAULT_MAX_TURNS);
        assert_eq!(clamp_turns(Some(&json!(0))), DEFAULT_MAX_TURNS);
        assert_eq!(clamp_turns(Some(&json!(-3))), DEFAULT_MAX_TURNS);
        assert_eq!(clamp_turns(Some(&json!(2.9))), 2);
        assert_eq!(clamp_turns(Some(&json!(999))), HARD_MAX_TURNS);
        assert_eq!(clamp_turns(Some(&json!("7"))), 7);

        assert_eq!(clamp_concurrency(None), DEFAULT_MAX_CONCURRENCY);
        assert_eq!(clamp_concurrency(Some(&json!(99))), HARD_MAX_CONCURRENCY);
        assert_eq!(clamp_concurrency(Some(&json!(3))), 3);
    }

    #[test]
    fn routing_replies_are_parsed() {
        let registry = registry();
        let space = space();
        let ids = space.member_ids();

        assert_eq!(
            parse_routing_reply(&registry, "{\"memberId\":\"p2\"}", &space, &ids).as_deref(),
            Some("p2")
        );
        assert_eq!(
            parse_routing_reply(&registry, "I pick Claude.", &space, &ids).as_deref(),
            Some("p2")
        );
        // Both known names mentioned → ambiguous.
        assert!(parse_routing_reply(&registry, "OpenCode or Claude?", &space, &ids).is_none());
        assert!(parse_routing_reply(&registry, "   ", &space, &ids).is_none());
        assert!(parse_routing_reply(&registry, "nobody", &space, &ids).is_none());
    }

    #[test]
    fn pipeline_decisions_are_parsed() {
        let candidates = vec!["p1".to_string(), "p2".to_string()];
        assert_eq!(
            parse_pipeline_decision("{\"memberId\":\"p2\"}", &candidates).as_deref(),
            Some("p2")
        );
        assert!(parse_pipeline_decision("{\"done\": true}", &candidates).is_none());
        assert!(parse_pipeline_decision("{\"done\":true}", &candidates).is_none());
        assert_eq!(
            parse_pipeline_decision("next: p1 please", &candidates).as_deref(),
            Some("p1")
        );
        assert!(parse_pipeline_decision("p1 and p2", &candidates).is_none());
        assert!(parse_pipeline_decision("", &candidates).is_none());
    }

    #[test]
    fn claim_verdicts_are_parsed() {
        assert_eq!(
            parse_claim_verdict(Some("Claim: I own the API layer")).as_deref(),
            Some("I own the API layer")
        );
        assert_eq!(
            parse_claim_verdict(Some("claim：需要继续")).as_deref(),
            Some("需要继续")
        );
        assert_eq!(parse_claim_verdict(Some("relinquish")), None);
        // "claim" without a verdict prefix still counts (same as TS).
        assert_eq!(
            parse_claim_verdict(Some("no claim here")).as_deref(),
            Some("no claim here")
        );
        assert_eq!(parse_claim_verdict(None), None);
        // "claim" in a word must not count.
        assert_eq!(parse_claim_verdict(Some("reclaim it")), None);
        assert_eq!(
            parse_claim_verdict(Some("Claim:")).as_deref(),
            Some("Claim:")
        );
    }

    #[test]
    fn handoff_and_summary_prompts_include_context() {
        let handoff = build_handoff_prompt(Some("reviewer"), "previous output", Some("api"));
        assert!(handoff.starts_with("You have claimed to continue. Claim reason: api\n\n"));
        assert!(handoff.contains("Output from the previous session (role: reviewer):\nprevious output"));

        let results = vec![
            SubTaskResult {
                sub_task_id: "s1".to_string(),
                member_id: "p1".to_string(),
                output: "ok".to_string(),
                ok: true,
                error: None,
            },
            SubTaskResult {
                sub_task_id: "s2".to_string(),
                member_id: "p2".to_string(),
                output: String::new(),
                ok: false,
                error: Some("boom".to_string()),
            },
        ];
        let summary = build_summary_prompt(&results, |member_id| member_id.to_uppercase());
        assert!(summary.contains("## Sub-task s1 (session: p1 / P1)\nok"));
        assert!(summary.contains("## Sub-task s2 (session: p2 / P2)\n[FAILED] boom"));
    }

    #[test]
    fn truncation_marks_the_original_length() {
        let short = truncate("abc", 8);
        assert_eq!(short, "abc");
        let long = truncate(&"x".repeat(20), 5);
        assert!(long.starts_with("xxxxx\n"));
        assert!(long.contains("total 20 chars"));
    }

    #[test]
    fn keyword_routing_prefers_a_mention_else_first_member() {
        let registry = registry();
        let space = space();
        assert_eq!(
            keyword_target(&registry, &space, "ask claude to write").as_deref(),
            Some("p2")
        );
        assert_eq!(
            keyword_target(&registry, &space, "do some code_review").as_deref(),
            Some("p1")
        );
        assert_eq!(
            keyword_target(&registry, &space, "something unrelated").as_deref(),
            Some("p1")
        );
    }

    #[test]
    fn role_and_explicit_targets_resolve() {
        let space = space();
        let collab = CollabMetadata {
            target_role: Some("writer".to_string()),
            ..Default::default()
        };
        assert_eq!(role_target(&space, collab.target_role.as_deref()).as_deref(), Some("p2"));
        assert_eq!(explicit_target(&space, &collab, None), None);

        let collab = CollabMetadata {
            target_participant_id: Some("p1".to_string()),
            ..Default::default()
        };
        assert_eq!(explicit_target(&space, &collab, None).as_deref(), Some("p1"));
        assert_eq!(explicit_target(&space, &collab, Some("claude")).as_deref(), Some("p2"));
    }

    #[test]
    fn catalogs_list_every_member() {
        let registry = registry();
        let space = space();
        let catalog = build_member_catalog(&registry, &space, None);
        assert!(catalog.contains("- p1: OpenCode, agent: opencode, role: reviewer, responsibility: review code"));
        assert!(catalog.contains("- p2: Claude, agent: claude, role: writer"));

        let excluded = build_member_catalog(&registry, &space, Some("p2"));
        assert!(!excluded.contains("p2"));

        let prompt = build_routing_prompt(&registry, &space, "question?");
        assert!(prompt.contains("memberId must be exactly one of: p1, p2"));
        assert!(prompt.ends_with("User question:\nquestion?"));

        let decision = build_pipeline_decision_prompt(&registry, &space, "p1", "step output");
        assert!(decision.contains("- p1 (role: reviewer)"));
        assert!(decision.contains("- p2: Claude"));
        assert!(decision.ends_with("Output of the current step:\nstep output"));
    }
}