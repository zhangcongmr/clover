//! `clover run` CLI tests (P7).
//!
//! These spawn the real `clover` binary against the mock ACP agent, so the
//! whole path is covered: argument parsing → `acp.json` lookup → probe/spawn →
//! session create → prompt → stdout/stderr split → exit code.
//!
//! `CLOVER_STATE_DIR` points the CLI at a temp state root; nothing touches the
//! developer's `~/.clover`.

use std::path::{Path, PathBuf};
use std::process::{Output, Stdio};
use std::time::Duration;

use clover_server::acp::probe::probe_path_command;
use serde_json::{json, Value};

struct TestHome(PathBuf);

impl TestHome {
    fn new() -> Self {
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("clover-cli-run-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(path.join(".clover").join("agents")).expect("create temp home");
        Self(path)
    }

    fn state_dir(&self) -> PathBuf {
        self.0.join(".clover")
    }

    fn workspace(&self) -> PathBuf {
        let path = self.0.join("workspace");
        std::fs::create_dir_all(&path).expect("workspace");
        path
    }

    fn write_acp_config(&self, agents: Value) {
        let config = json!({ "version": "1.0.0", "agents": agents });
        std::fs::write(
            self.state_dir().join("acp.json"),
            serde_json::to_string_pretty(&config).expect("json"),
        )
        .expect("write acp.json");
    }

    fn write_mock_agent(&self) {
        self.write_acp_config(json!([mock_agent()]));
    }
}

impl Drop for TestHome {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn mock_agent() -> Value {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("mock-acp-agent.mjs");
    json!({
        "id": "mock",
        "name": "Mock Agent",
        "command": "node",
        "args": [fixture.to_string_lossy()],
        "source": "disk",
        "installed": true,
    })
}

/// Run `clover run ...` with an isolated state root.
async fn clover(home: &TestHome, args: &[&str]) -> Output {
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_clover"));
    command
        .args(["run"])
        .args(args)
        .env("CLOVER_STATE_DIR", home.state_dir())
        .env("CLOVER_LOG_TO_FILE", "false")
        .env("RUST_LOG", "warn")
        .current_dir(home.workspace())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    tokio::time::timeout(Duration::from_secs(60), command.output())
        .await
        .unwrap_or_else(|_| panic!("clover run {args:?} did not finish"))
        .expect("run clover")
}

fn stdout_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).to_string()
}

fn stderr_text(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).to_string()
}

async fn require_node() -> bool {
    probe_path_command("node").await.found
}

#[tokio::test]
async fn prints_agent_output_on_stdout_and_hints_on_stderr() {
    if !require_node().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();
    let workspace = home.workspace();

    let output = clover(&home, &["hello"]).await;
    assert_eq!(output.status.code(), Some(0), "{}", stderr_text(&output));

    // Only the agent's text lands on stdout.
    assert_eq!(stdout_text(&output), "hello from mock");

    let stderr = stderr_text(&output);
    assert!(stderr.contains("→ agent      mock"), "{stderr}");
    assert!(
        stderr.contains(&format!("→ workspace  {}", workspace.to_string_lossy())),
        "{stderr}"
    );
    assert!(stderr.contains("✓ done in "), "{stderr}");
    assert!(stderr.contains("(end_turn)"), "{stderr}");
}

#[tokio::test]
async fn json_mode_streams_ndjson_events() {
    if !require_node().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();

    let output = clover(&home, &["hello", "--json"]).await;
    assert_eq!(output.status.code(), Some(0), "{}", stderr_text(&output));

    let stdout = stdout_text(&output);
    let events: Vec<Value> = stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str(line).unwrap_or_else(|_| panic!("not NDJSON: {line}")))
        .collect();
    assert!(!events.is_empty(), "no events printed");

    let types: Vec<&str> = events
        .iter()
        .filter_map(|event| event["type"].as_str())
        .collect();
    assert!(types.contains(&"prompt_processing"), "{types:?}");
    assert!(types.contains(&"session_update"), "{types:?}");
    assert!(types.contains(&"prompt_complete"), "{types:?}");
    // The turn's terminal event is the last line: `prompt_and_wait` drains the
    // listener before returning, so nothing is lost to process exit.
    assert_eq!(
        events.last().map(|event| event["type"].clone()),
        Some(json!("prompt_complete"))
    );

    let chunk = events
        .iter()
        .find(|event| {
            event["type"] == "session_update"
                && event["payload"]["update"]["sessionUpdate"] == "agent_message_chunk"
        })
        .expect("agent message chunk");
    assert_eq!(
        chunk["payload"]["update"]["content"]["text"],
        "hello from mock"
    );

    // JSON mode keeps stderr free of hints (and stdout free of logs).
    let stderr = stderr_text(&output);
    assert!(!stderr.contains("→ agent"), "{stderr}");
    assert!(!stdout.contains("→ agent"), "{stdout}");
}

#[tokio::test]
async fn permission_requests_are_denied_without_approve() {
    if !require_node().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();

    let output = clover(&home, &["permission please"]).await;
    assert_eq!(output.status.code(), Some(0), "{}", stderr_text(&output));
    // A rejection still selects the `reject_once` option (only a request
    // without any matching option falls back to `cancelled`).
    assert_eq!(stdout_text(&output), "permission:selected:reject");

    let stderr = stderr_text(&output);
    assert!(stderr.contains("⚠ permission denied: reject_once"), "{stderr}");
}

#[tokio::test]
async fn permission_requests_are_approved_with_approve() {
    if !require_node().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();

    let output = clover(&home, &["permission please", "--approve"]).await;
    assert_eq!(output.status.code(), Some(0), "{}", stderr_text(&output));
    assert_eq!(stdout_text(&output), "permission:selected:allow");

    let stderr = stderr_text(&output);
    assert!(stderr.contains("⚠ permission approved: allow_once"), "{stderr}");
}

#[tokio::test]
async fn options_may_precede_or_follow_the_prompt() {
    if !require_node().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();

    // Option before the prompt.
    let output = clover(&home, &["--agent", "mock", "hello"]).await;
    assert_eq!(output.status.code(), Some(0), "{}", stderr_text(&output));
    assert_eq!(stdout_text(&output), "hello from mock");

    // `--` keeps hyphenated text as prompt (not parsed as a flag).
    let output = clover(&home, &["--", "--json"]).await;
    assert_eq!(output.status.code(), Some(0), "{}", stderr_text(&output));
    assert_eq!(stdout_text(&output), "hello from mock");
    assert!(
        stderr_text(&output).contains("→ agent      mock"),
        "{}",
        stderr_text(&output)
    );
}

#[tokio::test]
async fn root_option_sets_the_workspace() {
    if !require_node().await {
        eprintln!("skipping: node is not on PATH");
        return;
    }

    let home = TestHome::new();
    home.write_mock_agent();
    let workspace = home.workspace();

    let output = clover(
        &home,
        &[
            "hello",
            "--root",
            &workspace.to_string_lossy(),
            "--agent",
            "mock",
        ],
    )
    .await;
    assert_eq!(output.status.code(), Some(0), "{}", stderr_text(&output));
    assert!(
        stderr_text(&output).contains(&format!("→ workspace  {}", workspace.to_string_lossy())),
        "{}",
        stderr_text(&output)
    );
}

#[tokio::test]
async fn usage_errors_exit_with_one() {
    let home = TestHome::new();

    // No prompt.
    let output = clover(&home, &[]).await;
    assert_eq!(output.status.code(), Some(1));
    assert!(stderr_text(&output).contains("Missing prompt."));

    // No installed agents.
    let output = clover(&home, &["hello"]).await;
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        stderr_text(&output).trim(),
        "No agents installed. Add one from the Clover web UI (Settings → Agents) first."
    );

    // Several agents, no --agent.
    home.write_acp_config(json!([
        mock_agent(),
        { "id": "other", "name": "Other", "command": "node", "installed": true }
    ]));
    let output = clover(&home, &["hello"]).await;
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr_text(&output).contains(
            "Multiple agents installed. Pass --agent <id> to choose one. Installed agents: mock, other"
        ),
        "{}",
        stderr_text(&output)
    );

    // Unknown --agent id.
    let output = clover(&home, &["hello", "--agent", "nope"]).await;
    assert_eq!(output.status.code(), Some(1));
    assert!(
        stderr_text(&output).contains(
            "Unknown agent: nope. Install it from the Clover web UI (Settings → Agents) first. Installed agents: mock, other"
        ),
        "{}",
        stderr_text(&output)
    );
}

#[tokio::test]
async fn unavailable_agents_report_a_readable_error() {
    let home = TestHome::new();
    home.write_acp_config(json!([{
        "id": "broken",
        "name": "Broken",
        "command": "clover-definitely-missing-binary",
        "installed": true
    }]));

    let output = clover(&home, &["hello"]).await;
    assert_eq!(output.status.code(), Some(1));
    let stderr = stderr_text(&output);
    assert!(stderr.contains("✗ "), "{stderr}");
    assert!(
        stderr.contains("clover-definitely-missing-binary"),
        "{stderr}"
    );
}