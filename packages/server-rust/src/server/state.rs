//! Shared request state.

use std::path::PathBuf;
use std::sync::Arc;

use crate::acp::AgentInstaller;
use crate::acp::AgentRegistry;
use crate::acp::SessionActivityHub;
use crate::acp::SessionManager;
use crate::acp::SessionStreamManager;
use crate::a2a::A2aService;
use crate::events::EventSink;
use crate::local::{FileService, PtyManager};
use crate::mcp::McpRegistry;
use crate::server::auth::TokenManager;
use crate::skills::SkillRegistry;

/// Everything the route handlers need. Grows batch by batch.
#[derive(Clone)]
pub struct AppState {
    pub token: Arc<TokenManager>,
    /// `CLOVER_READONLY=true` — write actions are rejected.
    pub readonly: bool,
    pub files: Arc<FileService>,
    pub pty: Arc<PtyManager>,
    pub mcp: Arc<McpRegistry>,
    pub skills: Arc<SkillRegistry>,
    pub agents: Arc<AgentRegistry>,
    /// ACP agent install jobs (`P6`).
    pub installs: Arc<AgentInstaller>,
    pub sessions: Arc<SessionManager>,
    pub sse: Arc<SessionStreamManager>,
    pub activity: Arc<SessionActivityHub>,
    /// A2A collaboration spaces + bridge (`P8`).
    pub a2a: Arc<A2aService>,
    pub events: Arc<EventSink>,
    /// `~/.clover` (or the configured state directory).
    pub state_dir: PathBuf,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("readonly", &self.readonly)
            .finish_non_exhaustive()
    }
}