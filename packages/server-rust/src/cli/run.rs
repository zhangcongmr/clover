//! `clover run <prompt>`
//!
//! One task with an installed agent, without starting the HTTP server.
//!
//! Mirrors `packages/server/src/cli/commands/run.ts`:
//!
//! - agents come from `~/.clover/acp.json` (the CLI never installs/registers);
//! - agent text output goes to **stdout** (NDJSON with `--json`), every hint,
//!   permission notice and error goes to **stderr**;
//! - permission requests are answered by the CLI (no UI): approve with
//!   `--approve`, otherwise reject;
//! - exit codes: `0` success, `1` usage/ACP error, `130` interrupted.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use clap::Args;
use serde_json::{json, Value};

use crate::acp::types::{AgentConfig, AgentRuntimeStatus};
use crate::acp::{AgentRegistry, SessionActivityHub, SessionManager};
use crate::events::EventSink;

/// Upper bound on waiting for the agent to settle after Ctrl-C.
const INTERRUPT_GRACE: Duration = Duration::from_secs(5);

#[derive(Debug, Default, Args)]
pub struct RunArgs {
    /// Prompt handed to the agent (`--` ends option parsing)
    #[arg(value_name = "prompt", num_args = 0..)]
    pub prompt: Vec<String>,

    /// Run with this agent id (it must be installed)
    #[arg(long, value_name = "ID")]
    pub agent: Option<String>,

    /// Workspace directory (default: current directory)
    #[arg(long, value_name = "DIR")]
    pub root: Option<String>,

    /// Print raw session events as NDJSON
    #[arg(long)]
    pub json: bool,

    /// Approve permission requests automatically
    #[arg(long)]
    pub approve: bool,
}

impl RunArgs {
    /// Joined positional prompt, matching the TS CLI (`positionals.join(' ')`).
    pub fn prompt_text(&self) -> String {
        self.prompt.join(" ").trim().to_string()
    }
}

pub async fn execute(args: RunArgs) -> u8 {
    let prompt = args.prompt_text();
    if prompt.is_empty() {
        eprintln!("Missing prompt. Usage: clover run \"<prompt>\" [options]");
        return 1;
    }

    // Agent selection + workspace resolution are usage errors (exit 1).
    let agents = crate::acp::stores::read_acp_config(&crate::paths::clover_dir()).agents;
    let agent_id = match resolve_agent_id(&agents, args.agent.as_deref()) {
        Ok(agent_id) => agent_id,
        Err(message) => {
            eprintln!("{message}");
            return 1;
        }
    };
    let cwd = resolve_cwd(args.root.as_deref());

    let sink = Arc::new(EventSink::default());
    let registry = AgentRegistry::new(agents, Arc::clone(&sink));
    let activity = Arc::new(SessionActivityHub::new());
    let sessions = SessionManager::new(Arc::clone(&registry), sink, activity);

    let options = Options {
        prompt,
        json: args.json,
        approve: args.approve,
    };
    let code = run_prompt(&sessions, &registry, &agent_id, &cwd, &options).await;

    // The agent subprocess must be torn down or the CLI would never exit.
    sessions.destroy();
    registry.destroy().await;
    let _ = std::io::stdout().flush();
    code
}

struct Options {
    prompt: String,
    json: bool,
    approve: bool,
}

async fn run_prompt(
    sessions: &Arc<SessionManager>,
    registry: &Arc<AgentRegistry>,
    agent_id: &str,
    cwd: &str,
    options: &Options,
) -> u8 {
    let started = Instant::now();

    // Pre-flight: probe + connect first so a broken install reports a readable
    // reason instead of an `initialize` timeout.
    let status = match registry.check_now(agent_id).await {
        Ok(status) => status,
        Err(error) => {
            eprintln!("✗ {error}");
            return 1;
        }
    };
    if matches!(
        status.status,
        AgentRuntimeStatus::Unavailable | AgentRuntimeStatus::Offline
    ) {
        let message = status
            .error
            .clone()
            .filter(|error| !error.is_empty())
            .unwrap_or_else(|| format!("Agent \"{agent_id}\" is not available"));
        eprintln!("✗ {message}");
        return 1;
    }

    let created = match sessions.create(agent_id, cwd.to_string(), json!([])).await {
        Ok(created) => created,
        Err(error) => {
            eprintln!("✗ {error}");
            return 1;
        }
    };
    let Some(session_id) = created
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_string)
    else {
        eprintln!("✗ agent did not return a sessionId");
        return 1;
    };

    if !options.json {
        eprintln!("→ agent      {agent_id}");
        eprintln!("→ workspace  {cwd}");
    }

    let callback = event_callback(sessions, &session_id, options);
    let content = json!([{ "type": "text", "text": options.prompt.clone() }]);
    let prompt = sessions.prompt_and_wait(&session_id, content, Some(callback));
    tokio::pin!(prompt);

    let mut interrupted = false;
    let result = tokio::select! {
        result = &mut prompt => result,
        _ = tokio::signal::ctrl_c() => {
            interrupted = true;
            // Ask the agent to stop; give it a bounded grace period to settle.
            sessions.dispatch_cancel(&session_id);
            match tokio::time::timeout(INTERRUPT_GRACE, &mut prompt).await {
                Ok(settled) => settled,
                Err(_) => Err("interrupted".to_string()),
            }
        }
    };

    if interrupted {
        eprintln!("Interrupted.");
        return 130;
    }

    match result {
        Ok(value) => {
            if !options.json {
                let stop_reason = value
                    .get("stopReason")
                    .and_then(Value::as_str)
                    .unwrap_or("end_turn");
                eprintln!(
                    "✓ done in {} ({stop_reason})",
                    format_duration(started.elapsed().as_millis())
                );
            }
            0
        }
        Err(error) => {
            eprintln!("✗ {error}");
            1
        }
    }
}

/// Event handler: agent text → stdout, everything else → stderr.
fn event_callback(
    sessions: &Arc<SessionManager>,
    session_id: &str,
    options: &Options,
) -> Arc<dyn Fn(Value) + Send + Sync> {
    let sessions = Arc::clone(sessions);
    let session_id = session_id.to_string();
    let approve = options.approve;
    let json_mode = options.json;
    Arc::new(move |event: Value| {
        handle_event(&event, json_mode, approve, &sessions, &session_id)
    })
}

fn handle_event(
    event: &Value,
    json_mode: bool,
    approve: bool,
    sessions: &Arc<SessionManager>,
    session_id: &str,
) {
    if event.get("type").and_then(Value::as_str) == Some("permission_request") {
        // There is no UI in the CLI: answer here or the agent waits for the
        // five-minute ceiling.
        let payload = &event["payload"];
        if let Some(request_id) = payload.get("requestId").and_then(Value::as_str) {
            let options = payload
                .get("options")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let outcome = pick_permission_outcome(&options, approve);
            if !json_mode {
                let label = if approve { "approved" } else { "denied" };
                eprintln!(
                    "⚠ permission {label}: {}",
                    describe_permission(&options, &outcome)
                );
            }
            sessions.dispatch_permission_response(session_id, request_id, outcome);
        }
    }

    if json_mode {
        println!("{}", serde_json::to_string(event).unwrap_or_default());
        let _ = std::io::stdout().flush();
        return;
    }

    if event.get("type").and_then(Value::as_str) == Some("session_update") {
        let update = &event["payload"]["update"];
        if update.get("sessionUpdate").and_then(Value::as_str) == Some("agent_message_chunk")
            && update["content"].get("type").and_then(Value::as_str) == Some("text")
            && let Some(text) = update["content"].get("text").and_then(Value::as_str)
        {
            print!("{text}");
            let _ = std::io::stdout().flush();
        }
        return;
    }

    if event.get("type").and_then(Value::as_str) == Some("error") {
        let message = event["payload"]
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("unknown error");
        eprintln!("✗ {message}");
    }
}

/// Pick the outcome for a permission request.
///
/// ACP only has two result shapes: `cancelled` or `selected`. Approval prefers
/// `allow_once` then `allow_always`; rejection prefers `reject_once` then
/// `reject_always`; neither present falls back to `cancelled`.
fn pick_permission_outcome(options: &[Value], approve: bool) -> Value {
    let wanted = if approve {
        ["allow_once", "allow_always"]
    } else {
        ["reject_once", "reject_always"]
    };
    for kind in wanted {
        if let Some(option) = options
            .iter()
            .find(|option| option.get("kind").and_then(Value::as_str) == Some(kind))
            && let Some(option_id) = option.get("optionId").and_then(Value::as_str)
        {
            return json!({ "outcome": "selected", "optionId": option_id });
        }
    }
    json!({ "outcome": "cancelled" })
}

fn describe_permission(options: &[Value], outcome: &Value) -> String {
    if outcome.get("outcome").and_then(Value::as_str) != Some("selected") {
        return "cancelled".to_string();
    }
    let option_id = outcome
        .get("optionId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    options
        .iter()
        .find(|option| option.get("optionId").and_then(Value::as_str) == Some(option_id))
        .and_then(|option| option.get("kind").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| option_id.to_string())
}

/// Resolve the agent id: `--agent` must be installed; a lone installed agent is
/// used automatically; several require an explicit choice.
fn resolve_agent_id(agents: &[AgentConfig], requested: Option<&str>) -> Result<String, String> {
    if agents.is_empty() {
        return Err(
            "No agents installed. Add one from the Clover web UI (Settings → Agents) first."
                .to_string(),
        );
    }

    if let Some(requested) = requested {
        if agents.iter().any(|agent| agent.id == requested) {
            return Ok(requested.to_string());
        }
        let known = agents
            .iter()
            .map(|agent| agent.id.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        let suffix = if known.is_empty() {
            String::new()
        } else {
            format!(" Installed agents: {known}")
        };
        return Err(format!(
            "Unknown agent: {requested}. Install it from the Clover web UI (Settings → Agents) first.{suffix}"
        ));
    }

    if agents.len() == 1 {
        return Ok(agents[0].id.clone());
    }

    let known = agents
        .iter()
        .map(|agent| agent.id.as_str())
        .collect::<Vec<_>>()
        .join(", ");
    Err(format!(
        "Multiple agents installed. Pass --agent <id> to choose one. Installed agents: {known}"
    ))
}

/// Workspace root: `--root` resolved against the current directory.
fn resolve_cwd(root: Option<&str>) -> String {
    match root {
        Some(root) => std::path::absolute(PathBuf::from(root))
            .unwrap_or_else(|_| PathBuf::from(root))
            .to_string_lossy()
            .to_string(),
        None => std::env::current_dir()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|_| ".".to_string()),
    }
}

/// `123ms` / `1.2s` / `2m 5s` (same thresholds as the TS CLI).
fn format_duration(millis: u128) -> String {
    if millis < 1000 {
        return format!("{millis}ms");
    }
    let seconds = millis as f64 / 1000.0;
    if seconds < 60.0 {
        return format!("{seconds:.1}s");
    }
    let minutes = (seconds / 60.0).floor();
    let rest = (seconds - minutes * 60.0).round();
    format!("{}m {}s", minutes as u64, rest as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn agents(ids: &[&str]) -> Vec<AgentConfig> {
        ids.iter()
            .map(|id| AgentConfig {
                id: (*id).to_string(),
                name: (*id).to_string(),
                command: "agent".to_string(),
                ..Default::default()
            })
            .collect()
    }

    #[test]
    fn agent_selection_matches_the_ts_cli() {
        let empty = agents(&[]);
        assert!(resolve_agent_id(&empty, None).expect_err("empty").starts_with("No agents installed"));

        let single = agents(&["codex"]);
        assert_eq!(resolve_agent_id(&single, None).expect("single"), "codex");
        assert_eq!(
            resolve_agent_id(&single, Some("codex")).expect("requested"),
            "codex"
        );

        let unknown = resolve_agent_id(&single, Some("claude")).expect_err("unknown");
        assert_eq!(
            unknown,
            "Unknown agent: claude. Install it from the Clover web UI (Settings → Agents) first. Installed agents: codex"
        );

        let many = agents(&["codex", "claude"]);
        assert_eq!(
            resolve_agent_id(&many, None).expect_err("ambiguous"),
            "Multiple agents installed. Pass --agent <id> to choose one. Installed agents: codex, claude"
        );
        assert_eq!(
            resolve_agent_id(&many, Some("claude")).expect("selected"),
            "claude"
        );
    }

    #[test]
    fn durations_are_human_readable() {
        assert_eq!(format_duration(0), "0ms");
        assert_eq!(format_duration(999), "999ms");
        assert_eq!(format_duration(1_000), "1.0s");
        assert_eq!(format_duration(12_340), "12.3s");
        assert_eq!(format_duration(60_000), "1m 0s");
        assert_eq!(format_duration(125_000), "2m 5s");
    }

    #[test]
    fn permission_outcomes_prefer_once_variants() {
        let options = vec![
            json!({ "optionId": "always-allow", "kind": "allow_always" }),
            json!({ "optionId": "allow", "kind": "allow_once" }),
            json!({ "optionId": "reject", "kind": "reject_once" }),
        ];
        assert_eq!(
            pick_permission_outcome(&options, true),
            json!({ "outcome": "selected", "optionId": "allow" })
        );
        assert_eq!(
            pick_permission_outcome(&options, false),
            json!({ "outcome": "selected", "optionId": "reject" })
        );
        assert_eq!(
            describe_permission(&options, &pick_permission_outcome(&options, true)),
            "allow_once"
        );

        let only_always = vec![
            json!({ "optionId": "always", "kind": "allow_always" }),
            json!({ "optionId": "never", "kind": "reject_always" }),
        ];
        assert_eq!(
            pick_permission_outcome(&only_always, true),
            json!({ "outcome": "selected", "optionId": "always" })
        );
        assert_eq!(
            pick_permission_outcome(&only_always, false),
            json!({ "outcome": "selected", "optionId": "never" })
        );

        // No usable option → cancelled.
        let unknown = vec![json!({ "optionId": "x", "kind": "weird" })];
        let outcome = pick_permission_outcome(&unknown, true);
        assert_eq!(outcome, json!({ "outcome": "cancelled" }));
        assert_eq!(describe_permission(&unknown, &outcome), "cancelled");
        assert_eq!(
            pick_permission_outcome(&[], true),
            json!({ "outcome": "cancelled" })
        );
    }

    #[test]
    fn missing_root_uses_the_current_directory() {
        let cwd = std::env::current_dir().expect("cwd");
        assert_eq!(resolve_cwd(None), cwd.to_string_lossy().to_string());
        let absolute = resolve_cwd(Some("."));
        assert!(PathBuf::from(absolute).is_absolute());
    }
}