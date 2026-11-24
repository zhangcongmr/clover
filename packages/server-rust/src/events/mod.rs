//! Session event bus (in-process).

pub mod sink;

pub use sink::{EventSink, Replay, PERMISSION_TIMEOUT};