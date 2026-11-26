//! Helpers for subprocesses started by the local server.
//!
//! The desktop shell is a Windows GUI subsystem binary
//! (`#![windows_subsystem = "windows"]`), so it owns no console. Windows
//! allocates a fresh console window for every console program spawned from such
//! a process — which used to pop one window per ACP agent (plus one for the
//! `cmd.exe` shim in front of `npx`/`uvx`) when the agent list initialised.
//!
//! [`HideConsole`] starts children without a console window instead; their own
//! descendants inherit the console-less session, so `cmd.exe` → `node` chains
//! stay hidden too. On other platforms it is a no-op.

/// Start the child without a visible console window on Windows.
pub(crate) trait HideConsole {
    fn hide_console(&mut self) -> &mut Self;
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

macro_rules! impl_hide_console {
    ($command:ty) => {
        impl HideConsole for $command {
            fn hide_console(&mut self) -> &mut Self {
                #[cfg(windows)]
                self.creation_flags(CREATE_NO_WINDOW);
                self
            }
        }
    };
}

impl_hide_console!(std::process::Command);
impl_hide_console!(tokio::process::Command);

#[cfg(all(test, windows))]
mod tests {
    use super::HideConsole;

    #[tokio::test]
    async fn a_hidden_child_still_runs_and_pipes_output() {
        let mut command = tokio::process::Command::new("cmd.exe");
        command
            .hide_console()
            .args(["/C", "echo hidden"])
            .stdout(std::process::Stdio::piped());
        let output = command.output().await.expect("spawn hidden child");
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("hidden"));
    }
}