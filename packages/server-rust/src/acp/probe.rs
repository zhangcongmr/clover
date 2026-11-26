//! Agent probing and launch resolution.
//!
//! Port of `packages/server/src/acp/agent-probe.ts`. It answers three questions:
//!
//! 1. is the configured command installed (`probe_path_command`)?
//! 2. what should actually be spawned (`resolve_for_spawn`, Windows shims go
//!    through `cmd.exe`)?
//! 3. which version is installed (`probe_agent_version` / `probe_package_version`)?

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::process::Command;

use crate::subprocess::HideConsole;

const PROBE_TIMEOUT: Duration = Duration::from_secs(5);
const VERSION_TIMEOUT: Duration = Duration::from_secs(10);
const PACKAGE_PROBE_TIMEOUT: Duration = Duration::from_secs(3 * 60);
const PACKAGE_CACHE_TTL: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PathCommandProbe {
    pub found: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpawnTarget {
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct PackageProbeResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct CliCheck {
    // Kept for the installer (P6), which reports the failure detail.
    #[allow(dead_code)]
    ok: bool,
    #[allow(dead_code)]
    error: Option<String>,
    version: Option<String>,
}

static CLI_CACHE: OnceLock<Mutex<HashMap<String, CliCheck>>> = OnceLock::new();
static PACKAGE_CACHE: OnceLock<Mutex<HashMap<String, (PackageProbeResult, Instant)>>> =
    OnceLock::new();

fn cli_cache() -> &'static Mutex<HashMap<String, CliCheck>> {
    CLI_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn package_cache() -> &'static Mutex<HashMap<String, (PackageProbeResult, Instant)>> {
    PACKAGE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Drop cached probes so a freshly installed CLI is picked up.
pub fn invalidate_agent_command_cache() {
    if let Ok(mut cache) = cli_cache().lock() {
        cache.clear();
    }
    if let Ok(mut cache) = package_cache().lock() {
        cache.clear();
    }
}

// ==========================================================================
// PATH lookup
// ==========================================================================

/// Look a CLI up on PATH (or directly on disk when the command is a path).
pub async fn probe_path_command(command: &str) -> PathCommandProbe {
    if command.contains('/') || command.contains('\\') {
        return PathCommandProbe {
            found: Path::new(command).exists(),
            path: Path::new(command)
                .exists()
                .then(|| command.to_string()),
        };
    }

    let candidates = where_paths(command).await;

    #[cfg(windows)]
    {
        let resolved = resolve_cli_windows(command, &candidates, &global_bin_dirs_windows());
        PathCommandProbe {
            found: resolved.is_some(),
            path: resolved,
        }
    }

    #[cfg(not(windows))]
    {
        let mut pools = candidates;
        if let Some(exe_dir) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(Path::to_path_buf))
        {
            pools.push(exe_dir.join(command).to_string_lossy().to_string());
        }
        pools.push(format!("/usr/local/bin/{command}"));

        for candidate in pools {
            if !candidate.is_empty() && Path::new(&candidate).exists() {
                return PathCommandProbe {
                    found: true,
                    path: Some(candidate),
                };
            }
        }
        PathCommandProbe::default()
    }
}

/// Resolve the process that should be spawned for an agent command.
pub async fn resolve_for_spawn(command: &str, args: &[String]) -> SpawnTarget {
    #[cfg(not(windows))]
    {
        SpawnTarget {
            program: command.to_string(),
            args: args.to_vec(),
        }
    }

    #[cfg(windows)]
    {
        let is_shim = command.to_ascii_lowercase().ends_with(".cmd")
            || command.to_ascii_lowercase().ends_with(".bat");

        if is_shim {
            return cmd_wrapper(command, args);
        }
        if command.contains('/') || command.contains('\\') {
            return SpawnTarget {
                program: command.to_string(),
                args: args.to_vec(),
            };
        }

        let candidates = where_paths(command).await;
        let resolved = resolve_cli_windows(command, &candidates, &global_bin_dirs_windows());
        match resolved {
            // Native binary: spawn directly, no shell.
            Some(path)
                if path.to_ascii_lowercase().ends_with(".exe")
                    || path.to_ascii_lowercase().ends_with(".com") =>
            {
                SpawnTarget {
                    program: path,
                    args: args.to_vec(),
                }
            }
            // Shim (or nothing found): let cmd.exe resolve it.
            Some(path) => cmd_wrapper(&path, args),
            None => cmd_wrapper(command, args),
        }
    }
}

#[cfg(windows)]
fn cmd_wrapper(program: &str, args: &[String]) -> SpawnTarget {
    let mut command_line = quote_arg(program);
    for arg in args {
        command_line.push(' ');
        command_line.push_str(&quote_arg(arg));
    }
    // `cmd /C "<line>"`: when the line itself starts with a quote, cmd strips
    // the outer pair, so wrap it once more.
    let command_line = if command_line.starts_with('"') {
        format!("\"{command_line}\"")
    } else {
        command_line
    };
    SpawnTarget {
        program: "cmd.exe".to_string(),
        args: vec!["/C".to_string(), command_line],
    }
}

#[cfg(windows)]
fn quote_arg(value: &str) -> String {
    if value.contains(' ') || value.contains('\t') {
        format!("\"{value}\"")
    } else {
        value.to_string()
    }
}

/// Absolute paths reported by `where` (Windows) / `command -v` (POSIX).
async fn where_paths(command: &str) -> Vec<String> {
    let mut command_builder = if cfg!(windows) {
        let mut builder = Command::new("where");
        builder.arg(command);
        builder
    } else {
        let mut builder = Command::new("sh");
        builder.arg("-c").arg(format!("command -v \"{command}\""));
        builder
    };

    command_builder
        .hide_console()
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);

    let Ok(child) = command_builder.spawn() else {
        return Vec::new();
    };
    let Ok(output) = tokio::time::timeout(PROBE_TIMEOUT, child.wait_with_output()).await else {
        return Vec::new();
    };
    let Ok(output) = output else {
        return Vec::new();
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect()
}

#[cfg(windows)]
fn global_bin_dirs_windows() -> Vec<String> {
    let mut dirs: Vec<String> = Vec::new();
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
    {
        dirs.push(exe_dir.to_string_lossy().to_string());
    }
    for (key, suffix) in [
        ("APPDATA", "npm"),
        ("LOCALAPPDATA", "pnpm"),
        ("ProgramFiles", "nodejs"),
    ] {
        if let Ok(base) = std::env::var(key) {
            dirs.push(
                PathBuf::from(base)
                    .join(suffix)
                    .to_string_lossy()
                    .to_string(),
            );
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        dirs.push(
            PathBuf::from(home)
                .join(".local")
                .join("bin")
                .to_string_lossy()
                .to_string(),
        );
    }
    dirs.retain(|dir| !dir.is_empty());
    dirs
}

/// Prefer a native `.exe`, then whatever a shim executes, then the shim itself.
#[cfg(windows)]
fn resolve_cli_windows(command: &str, candidates: &[String], fallback_dirs: &[String]) -> Option<String> {
    let is_shim = |path: &str| {
        let lower = path.to_ascii_lowercase();
        lower.ends_with(".cmd") || lower.ends_with(".bat")
    };

    let mut shims: Vec<String> = candidates
        .iter()
        .filter(|path| is_shim(path))
        .cloned()
        .collect();
    for dir in fallback_dirs {
        let candidate = PathBuf::from(dir)
            .join(format!("{command}.cmd"))
            .to_string_lossy()
            .to_string();
        if Path::new(&candidate).exists() {
            shims.push(candidate);
        }
    }

    let mut native: Vec<String> = candidates
        .iter()
        .filter(|path| path.to_ascii_lowercase().ends_with(".exe"))
        .cloned()
        .collect();
    for dir in fallback_dirs {
        native.push(
            PathBuf::from(dir)
                .join(format!("{command}.exe"))
                .to_string_lossy()
                .to_string(),
        );
    }
    for shim in &shims {
        native.extend(shim_targets(shim));
    }

    if let Some(found) = native
        .into_iter()
        .find(|candidate| !candidate.is_empty() && Path::new(candidate).exists())
    {
        return Some(found);
    }

    shims.into_iter().next()
}

/// Executables referenced by an npm/pnpm `.cmd` shim (lines forwarding `%*`).
#[cfg(windows)]
fn shim_targets(shim_path: &str) -> Vec<String> {
    let lower = shim_path.to_ascii_lowercase();
    if !(lower.ends_with(".cmd") || lower.ends_with(".bat")) {
        return Vec::new();
    }
    let Ok(content) = std::fs::read_to_string(shim_path) else {
        return Vec::new();
    };
    let shim_dir = Path::new(shim_path)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();

    let mut targets: Vec<String> = Vec::new();
    for line in content.lines() {
        if !line.contains("%*") {
            continue;
        }
        for quoted in quoted_segments(line) {
            let lower = quoted.to_ascii_lowercase();
            if !(lower.ends_with(".exe") || lower.ends_with(".com")) {
                continue;
            }
            let resolved = if let Some(rest) = quoted
                .strip_prefix("%~dp0%\\")
                .or_else(|| quoted.strip_prefix("%dp0%\\"))
            {
                shim_dir.join(rest).to_string_lossy().to_string()
            } else if quoted.len() > 2 && quoted.as_bytes()[1] == b':' {
                quoted.to_string()
            } else {
                continue;
            };
            if !targets.contains(&resolved) {
                targets.push(resolved);
            }
        }
    }
    targets
}

#[cfg(windows)]
fn quoted_segments(line: &str) -> Vec<&str> {
    let mut segments = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find('"') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('"') else {
            break;
        };
        segments.push(&after[..end]);
        rest = &after[end + 1..];
    }
    segments
}

// ==========================================================================
// Version probes
// ==========================================================================

/// Run `<cli> --version` and return the parsed version (cached).
pub async fn probe_agent_version(cli_path: &str) -> Option<String> {
    if let Ok(cache) = cli_cache().lock()
        && let Some(cached) = cache.get(cli_path)
    {
        return cached.version.clone();
    }

    let result = check_cli(cli_path).await;
    let version = result.version.clone();
    if let Ok(mut cache) = cli_cache().lock() {
        cache.insert(cli_path.to_string(), result);
    }
    version
}

async fn check_cli(cli_path: &str) -> CliCheck {
    let target = resolve_for_spawn(cli_path, &["--version".to_string()]).await;
    match run_capture(&target.program, &target.args, VERSION_TIMEOUT).await {
        Ok(output) => {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            if output.status_success {
                CliCheck {
                    ok: true,
                    error: None,
                    version: parse_version(&combined),
                }
            } else {
                CliCheck {
                    ok: false,
                    error: Some(first_line(&combined).unwrap_or_else(|| {
                        format!("exit code {}", output.code.unwrap_or(-1))
                    })),
                    version: parse_version(&combined),
                }
            }
        }
        Err(error) => CliCheck {
            ok: false,
            error: Some(error),
            version: None,
        },
    }
}

/// Verify an `npx` / `uvx` package actually runs (`... --version`).
pub async fn probe_package_version(runner: &str, package: &str) -> PackageProbeResult {
    let cache_key = format!("{runner}:{package}");
    if let Ok(cache) = package_cache().lock()
        && let Some((result, at)) = cache.get(&cache_key)
        && at.elapsed() < PACKAGE_CACHE_TTL
    {
        return result.clone();
    }

    let args: Vec<String> = if runner == "npx" {
        vec![
            "-y".to_string(),
            package.to_string(),
            "--version".to_string(),
        ]
    } else {
        vec![package.to_string(), "--version".to_string()]
    };
    let target = resolve_for_spawn(runner, &args).await;

    let result = match run_capture(&target.program, &target.args, PACKAGE_PROBE_TIMEOUT).await {
        Ok(output) => {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            match parse_version(&combined) {
                Some(version) if output.status_success => PackageProbeResult {
                    ok: true,
                    version: Some(version),
                    error: None,
                },
                _ => PackageProbeResult {
                    ok: false,
                    version: None,
                    error: Some(last_line(&combined).unwrap_or_else(|| {
                        format!(
                            "{runner} {package} --version exited with code {}",
                            output
                                .code
                                .map(|code| code.to_string())
                                .unwrap_or_else(|| "error".to_string())
                        )
                    })),
                },
            }
        }
        Err(error) => PackageProbeResult {
            ok: false,
            version: None,
            error: Some(format!("{runner}: {error}")),
        },
    };

    if let Ok(mut cache) = package_cache().lock() {
        cache.insert(cache_key, (result.clone(), Instant::now()));
    }
    result
}

struct CapturedOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    code: Option<i32>,
    status_success: bool,
}

async fn run_capture(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<CapturedOutput, String> {
    let mut command = Command::new(program);
    command
        .hide_console()
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    let child = command
        .spawn()
        .map_err(|error| error.to_string())?;

    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => Ok(CapturedOutput {
            stdout: output.stdout,
            stderr: output.stderr,
            code: output.status.code(),
            status_success: output.status.success(),
        }),
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err(format!("timed out after {}s", timeout.as_secs())),
    }
}

fn first_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

fn last_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .rfind(|line| !line.is_empty())
        .map(str::to_string)
}

/// First semver-like token, optionally `v`-prefixed
/// (`1.2.3`, `v0.18.0-beta.1`). Mirrors the TS regex.
pub fn parse_version(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut index = 0;

    while index < bytes.len() {
        if !bytes[index].is_ascii_digit() {
            index += 1;
            continue;
        }

        let start = index;
        let mut cursor = index;
        while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
            cursor += 1;
        }
        if cursor >= bytes.len() || bytes[cursor] != b'.' {
            index = cursor.max(index + 1);
            continue;
        }
        cursor += 1;

        let minor_start = cursor;
        while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
            cursor += 1;
        }
        if cursor == minor_start {
            index = cursor.max(index + 1);
            continue;
        }

        if cursor < bytes.len() && bytes[cursor] == b'.' {
            let patch_start = cursor + 1;
            let mut patch_end = patch_start;
            while patch_end < bytes.len() && bytes[patch_end].is_ascii_digit() {
                patch_end += 1;
            }
            if patch_end > patch_start {
                cursor = patch_end;
            }
        }

        if cursor < bytes.len() && (bytes[cursor] == b'-' || bytes[cursor] == b'+') {
            let suffix_start = cursor + 1;
            let mut suffix_end = suffix_start;
            while suffix_end < bytes.len() {
                let byte = bytes[suffix_end];
                if byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'-' || byte == b'+' {
                    suffix_end += 1;
                } else {
                    break;
                }
            }
            if suffix_end > suffix_start {
                cursor = suffix_end;
            }
        }

        return Some(text[start..cursor].to_string());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_common_version_strings() {
        assert_eq!(parse_version("1.2.3").as_deref(), Some("1.2.3"));
        assert_eq!(parse_version("v0.18.0-beta.1").as_deref(), Some("0.18.0-beta.1"));
        assert_eq!(
            parse_version("my-agent version 2.5").as_deref(),
            Some("2.5")
        );
        assert_eq!(parse_version("no version here"), None);
        assert_eq!(parse_version(""), None);
    }

    #[tokio::test]
    async fn finds_a_command_on_path() {
        let command = if cfg!(windows) { "cmd" } else { "sh" };
        let probe = probe_path_command(command).await;
        assert!(probe.found, "{command} should be on PATH");
        assert!(probe.path.is_some());
    }

    #[tokio::test]
    async fn reports_missing_commands() {
        let probe = probe_path_command("clover-definitely-not-installed-xyz").await;
        assert!(!probe.found);
        assert!(probe.path.is_none());
    }

    #[tokio::test]
    async fn resolves_direct_paths_without_a_shell() {
        let target = resolve_for_spawn(
            if cfg!(windows) { r"C:\Windows\System32\cmd.exe" } else { "/bin/sh" },
            &["--version".to_string()],
        )
        .await;
        assert!(!target.program.contains("cmd.exe /C"), "{target:?}");
    }

    #[test]
    fn cache_invalidation_is_idempotent() {
        invalidate_agent_command_cache();
        invalidate_agent_command_cache();
    }
}