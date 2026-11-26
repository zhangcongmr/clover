//! A2A surface (P8).
//!
//! - [`spaces`] — collaboration spaces (one ACP session per participant);
//! - [`bridge`] — A2A task ⇄ ACP prompt bridge (single / pipeline / parallel /
//!   voluntary modes);
//! - [`cards`]  — A2A v1.0 agent cards for the orchestrator and per-agent
//!   bridges;
//! - [`proxy`]  — the public `/a2a` middleware that forwards to an external
//!   A2A agent (the A2UI demo client);
//! - [`events`] — A2A wire shapes.

pub mod bridge;
pub mod cards;
pub mod events;
pub mod proxy;
pub mod spaces;

use std::sync::Arc;

pub use bridge::{BridgeRunner, RunInput};
pub use spaces::{CollabSpace, CollabSpaceStore};

use crate::acp::{AgentRegistry, SessionManager};

/// Everything the A2A routes need.
pub struct A2aService {
    pub spaces: Arc<CollabSpaceStore>,
    pub bridge: Arc<BridgeRunner>,
    /// `A2A_BASE_URL` override for the absolute URLs baked into agent cards.
    pub base_url_override: Option<String>,
}

impl A2aService {
    pub fn new(sessions: Arc<SessionManager>, registry: Arc<AgentRegistry>) -> Arc<Self> {
        let spaces = CollabSpaceStore::new(Arc::clone(&sessions), Arc::clone(&registry));
        let bridge = BridgeRunner::from_env(Arc::clone(&sessions), Arc::clone(&spaces), registry);
        let base_url_override = std::env::var("A2A_BASE_URL")
            .ok()
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty());
        Arc::new(Self {
            spaces,
            bridge,
            base_url_override,
        })
    }
}