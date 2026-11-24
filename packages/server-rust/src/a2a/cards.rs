//! A2A agent cards for the collaboration endpoints.

use serde_json::{json, Value};

/// A2A protocol version advertised by the TS server (`A2A_PROTOCOL_VERSION`).
pub const A2A_PROTOCOL_VERSION: &str = "1.0";

/// Builds the A2A v1.0 card for one collab endpoint (JSONRPC binding only).
pub fn build_collab_card(name: &str, description: &str, dial_url: &str, skill: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "supportedInterfaces": [{
            "url": dial_url,
            "protocolBinding": "JSONRPC",
            "tenant": "",
            "protocolVersion": A2A_PROTOCOL_VERSION,
        }],
        "provider": {
            "organization": "Clover",
            "url": "https://github.com/zhangcongmr/clover",
        },
        "version": "1.0.0",
        "documentationUrl": "",
        "capabilities": {
            "streaming": true,
            "pushNotifications": false,
            "extensions": [],
            "extendedAgentCard": false,
        },
        "securitySchemes": {},
        "securityRequirements": [],
        "defaultInputModes": ["text"],
        "defaultOutputModes": ["text", "task-status"],
        "skills": [skill],
        "signatures": [],
    })
}

/// Skill advertised by a per-agent bridge.
pub fn agent_skill(agent_id: &str, name: &str, description: &str) -> Value {
    json!({
        "id": agent_id,
        "name": name,
        "description": description,
        "tags": ["coding", "collab", agent_id],
        "examples": [],
        "inputModes": ["text"],
        "outputModes": ["text", "task-status"],
        "securityRequirements": [],
    })
}

/// Skill advertised by the orchestrator endpoint.
pub fn orchestrator_skill() -> Value {
    json!({
        "id": "multi_agent_collab",
        "name": "Multi-Agent Collaboration",
        "description": "Dispatch a prompt to one of the agents of the current collaboration space (explicit target or keyword routing) and stream its reply.",
        "tags": ["collab", "orchestrator", "multi-agent"],
        "examples": [
            "Ask opencode to analyze this project",
            "Review this code for me",
        ],
        "inputModes": ["text"],
        "outputModes": ["text", "task-status"],
        "securityRequirements": [],
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cards_advertise_the_jsonrpc_interface() {
        let card = build_collab_card(
            "Collaboration Orchestrator",
            "Routes prompts",
            "http://localhost:4200/api/a2a/orchestrator/",
            orchestrator_skill(),
        );
        assert_eq!(card["supportedInterfaces"][0]["protocolBinding"], "JSONRPC");
        assert_eq!(
            card["supportedInterfaces"][0]["url"],
            "http://localhost:4200/api/a2a/orchestrator/"
        );
        assert_eq!(card["supportedInterfaces"][0]["protocolVersion"], "1.0");
        assert_eq!(card["capabilities"]["streaming"], true);
        assert_eq!(card["skills"][0]["id"], "multi_agent_collab");

        let skill = agent_skill("codex", "Codex", "Codex coding agent");
        assert_eq!(skill["id"], "codex");
        assert_eq!(skill["tags"][2], "codex");
    }
}