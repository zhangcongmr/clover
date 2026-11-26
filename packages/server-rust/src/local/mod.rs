//! Local host services: filesystem, PTY and file watching.
//!
//! Same behaviour and response envelopes as `packages/server/src/local`. One
//! deliberate difference is documented in [`watch`]: watchers are owned by the
//! connection that asked for them, so two clients watching the same file both
//! receive events (the TS version silently served only the first one).

pub mod file_service;
pub mod pty;
pub mod resolve;

pub use file_service::{FileRequest, FileResponse, FileService};
pub use pty::PtyManager;
pub use resolve::{is_path_inside, resolve_path};