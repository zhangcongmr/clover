//! Collaboration spaces: one ACP session per participant slot.
//!
//! Port of `packages/server/src/api/a2a-collab/spaces.ts`. Spaces are
//! process-local and ephemeral (never persisted): they live until the frontend
//! closes them or the backend restarts.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use indexmap::IndexMap;
use serde_json::{json, Value};

use crate::acp::{AgentRegistry, SessionManager};

/// Responsibility strings are embedded in prompts; keep them bounded.
const RESPONSIBILITY_MAX_LEN: usize = 200;

#[derive(Debug, Clone)]
pub struct CollabMember {
    /// Participant/session key (primary key of the collaboration).
    pub id: String,
    /// Bound agent implementation (`opencode` / `claude` / …).
    pub agent_id: String,
    pub role: Option<String>,
    pub responsibility: Option<String>,
    pub capabilities: Option<Vec<String>>,
}

#[derive(Debug)]
pub struct CollabSpace {
    pub id: String,
    pub cwd: String,
    /// participantId → member (insertion order = declaration order).
    pub members: IndexMap<String, CollabMember>,
    /// participantId → ACP session id.
    pub sessions: HashMap<String, String>,
    /// participantId → `configOptions` from `session/new`.
    pub config_options: HashMap<String, Vec<Value>>,
    pub orchestrator_id: Option<String>,
    pub created_at: i64,
}

impl CollabSpace {
    pub fn member_ids(&self) -> Vec<String> {
        self.members.keys().cloned().collect()
    }

    pub fn member(&self, member_id: &str) -> Option<&CollabMember> {
        self.members.get(member_id)
    }

    pub fn session_of(&self, member_id: &str) -> Option<&String> {
        self.sessions.get(member_id)
    }
}

/// Resolve a member reference: participant id, then ACP session id, then agent id
/// (first matching member).
pub fn resolve_member_id(space: &CollabSpace, reference: Option<&str>) -> Option<String> {
    let value = reference.map(str::trim).unwrap_or_default();
    if value.is_empty() {
        return None;
    }
    if space.members.contains_key(value) {
        return Some(value.to_string());
    }
    if let Some((member_id, _)) = space
        .sessions
        .iter()
        .find(|(_, session_id)| session_id.as_str() == value)
    {
        return Some(member_id.clone());
    }
    space
        .members
        .values()
        .find(|member| member.agent_id == value)
        .map(|member| member.id.clone())
}

/// Trimmed non-empty string, or `None`.
pub fn clean(value: Option<&Value>) -> Option<String> {
    let text = value
        .map(|value| match value {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        })
        .unwrap_or_default();
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn clean_capabilities(value: Option<&Value>) -> Option<Vec<String>> {
    let items = value?.as_array()?;
    let mut seen = HashSet::new();
    let mut caps = Vec::new();
    for item in items {
        let text = match item {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        let trimmed = text.trim().to_string();
        if !trimmed.is_empty() && seen.insert(trimmed.clone()) {
            caps.push(trimmed);
        }
    }
    (!caps.is_empty()).then_some(caps)
}

/// Parsed participant input.
#[derive(Debug, Clone)]
pub struct CollabMemberInput {
    pub id: Option<String>,
    pub agent_id: String,
    pub role: Option<String>,
    pub responsibility: Option<String>,
    pub capabilities: Option<Vec<String>>,
}

impl CollabMemberInput {
    pub fn from_value(value: &Value) -> Self {
        Self {
            id: clean(value.get("id")),
            agent_id: clean(value.get("agentId")).unwrap_or_default(),
            role: clean(value.get("role")),
            responsibility: clean(value.get("responsibility")).map(|text| {
                text.chars().take(RESPONSIBILITY_MAX_LEN).collect::<String>()
            }),
            capabilities: clean_capabilities(value.get("capabilities")),
        }
    }
}

/// Process-local registry of collaboration spaces.
pub struct CollabSpaceStore {
    spaces: Mutex<HashMap<String, Arc<CollabSpace>>>,
    sessions: Arc<SessionManager>,
    registry: Arc<AgentRegistry>,
}

impl CollabSpaceStore {
    pub fn new(sessions: Arc<SessionManager>, registry: Arc<AgentRegistry>) -> Arc<Self> {
        Arc::new(Self {
            spaces: Mutex::new(HashMap::new()),
            sessions,
            registry,
        })
    }

    pub fn get(&self, space_id: Option<&str>) -> Option<Arc<CollabSpace>> {
        let space_id = space_id?.trim();
        if space_id.is_empty() {
            return None;
        }
        self.spaces
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(space_id)
            .cloned()
    }

    pub fn len(&self) -> usize {
        self.spaces
            .lock()
            .map(|spaces| spaces.len())
            .unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Create a space: validate every participant, then open one ACP session
    /// each (rolling back partially created sessions on failure).
    pub async fn create(
        &self,
        cwd: &str,
        participants: &[Value],
        orchestrator_id: Option<&str>,
    ) -> Result<Arc<CollabSpace>, String> {
        let cwd = cwd.trim().to_string();
        if cwd.is_empty() {
            return Err("cwd is required to create a collaboration space".to_string());
        }
        if participants.is_empty() {
            return Err("participants must contain at least one session".to_string());
        }

        let mut members: IndexMap<String, CollabMember> = IndexMap::new();
        for input in participants {
            let input = CollabMemberInput::from_value(input);
            if input.agent_id.is_empty() {
                return Err("each participant requires an agentId".to_string());
            }
            if self.registry.get_agent_config(&input.agent_id).is_none() {
                return Err(format!("Unknown agent: {}", input.agent_id));
            }
            let participant_id = input
                .id
                .clone()
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
            if members.contains_key(&participant_id) {
                return Err(format!("Duplicate participant id: {participant_id}"));
            }
            members.insert(
                participant_id.clone(),
                CollabMember {
                    id: participant_id,
                    agent_id: input.agent_id,
                    role: input.role,
                    responsibility: input.responsibility,
                    capabilities: input.capabilities,
                },
            );
        }

        let orchestrator_id = orchestrator_id
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(orchestrator_id) = &orchestrator_id
            && !members.contains_key(orchestrator_id)
        {
            return Err(
                "orchestratorId must be a participant of the collaboration space".to_string(),
            );
        }

        let mut sessions = HashMap::new();
        let mut config_options = HashMap::new();
        let mut created: Vec<String> = Vec::new();

        let result = async {
            for (participant_id, info) in &members {
                let created_session = self
                    .sessions
                    .create(&info.agent_id, cwd.clone(), json!([]))
                    .await?;
                let session_id = created_session
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if session_id.is_empty() {
                    return Err(format!(
                        "Agent {} returned no ACP session id",
                        info.agent_id
                    ));
                }
                created.push(session_id.clone());
                sessions.insert(participant_id.clone(), session_id);
                config_options.insert(
                    participant_id.clone(),
                    created_session
                        .get("configOptions")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default(),
                );
            }
            Ok::<(), String>(())
        }
        .await;

        if let Err(error) = result {
            // Roll back partially created sessions.
            for session_id in created {
                self.sessions.remove_session(&session_id);
            }
            return Err(error);
        }

        let space = Arc::new(CollabSpace {
            id: uuid::Uuid::new_v4().to_string(),
            cwd: cwd.clone(),
            members,
            sessions,
            config_options,
            orchestrator_id: orchestrator_id.clone(),
            created_at: crate::server::now_ms(),
        });
        self.spaces
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .insert(space.id.clone(), Arc::clone(&space));

        let summary = space
            .members
            .values()
            .map(|member| match &member.role {
                Some(role) => format!("{}:{}({role})", member.id, member.agent_id),
                None => format!("{}:{}", member.id, member.agent_id),
            })
            .collect::<Vec<_>>()
            .join(", ");
        tracing::info!(
            "[A2A Collab] Space created: {} (sessions: {summary}{}, cwd: {cwd})",
            space.id,
            orchestrator_id
                .as_deref()
                .map(|id| format!(", orchestrator: {id}"))
                .unwrap_or_default()
        );
        Ok(space)
    }

    /// Close a space and release its sessions.
    pub async fn remove(&self, space_id: &str) -> bool {
        let space = self
            .spaces
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .remove(space_id);
        let Some(space) = space else {
            return false;
        };
        for session_id in space.sessions.values() {
            self.sessions.remove_session(session_id);
        }
        tracing::info!("[A2A Collab] Space closed: {space_id}");
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn space() -> CollabSpace {
        let mut members = IndexMap::new();
        for (id, agent) in [("s1", "opencode"), ("s2", "claude")] {
            members.insert(
                id.to_string(),
                CollabMember {
                    id: id.to_string(),
                    agent_id: agent.to_string(),
                    role: None,
                    responsibility: None,
                    capabilities: None,
                },
            );
        }
        let mut sessions = HashMap::new();
        sessions.insert("s1".to_string(), "acp-1".to_string());
        sessions.insert("s2".to_string(), "acp-2".to_string());
        CollabSpace {
            id: "space".to_string(),
            cwd: "/tmp".to_string(),
            members,
            sessions,
            config_options: HashMap::new(),
            orchestrator_id: None,
            created_at: 0,
        }
    }

    #[test]
    fn member_references_resolve_in_order() {
        let space = space();
        assert_eq!(resolve_member_id(&space, Some("s2")).as_deref(), Some("s2"));
        assert_eq!(resolve_member_id(&space, Some("acp-1")).as_deref(), Some("s1"));
        assert_eq!(
            resolve_member_id(&space, Some("claude")).as_deref(),
            Some("s2")
        );
        assert!(resolve_member_id(&space, Some("  ")).is_none());
        assert!(resolve_member_id(&space, Some("nope")).is_none());
        assert_eq!(space.member_ids(), vec!["s1".to_string(), "s2".to_string()]);
    }

    #[test]
    fn member_inputs_are_cleaned() {
        let input = CollabMemberInput::from_value(&json!({
            "id": "  p1 ",
            "agentId": " opencode ",
            "role": "  ",
            "responsibility": "review",
            "capabilities": ["a", " a ", "", 3]
        }));
        assert_eq!(input.id.as_deref(), Some("p1"));
        assert_eq!(input.agent_id, "opencode");
        assert!(input.role.is_none());
        assert_eq!(input.responsibility.as_deref(), Some("review"));
        assert_eq!(
            input.capabilities,
            Some(vec!["a".to_string(), "3".to_string()])
        );
    }
}