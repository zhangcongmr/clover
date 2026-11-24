//! `~/.clover` state layout.
//!
//! Every path here mirrors what the TypeScript server used, so an existing
//! installation keeps working without a migration step.

use std::path::PathBuf;

/// `~/.clover`
///
/// `CLOVER_STATE_DIR` overrides the root (tests and portable installs); the
/// default stays byte-identical to the TypeScript server.
pub fn clover_dir() -> PathBuf {
    match std::env::var("CLOVER_STATE_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => home_dir().join(".clover"),
    }
}

/// `~/.clover/acp.json` — installed ACP agents.
pub fn acp_config_file() -> PathBuf {
    clover_dir().join("acp.json")
}

/// `~/.clover/agent-config.json` — per-agent config option overrides.
pub fn agent_options_file() -> PathBuf {
    clover_dir().join("agent-config.json")
}

/// `~/.clover/projects.json`
pub fn projects_file() -> PathBuf {
    clover_dir().join("projects.json")
}

/// `~/.clover/tasks.json`
pub fn tasks_file() -> PathBuf {
    clover_dir().join("tasks.json")
}

/// `~/.clover/selected-project.json`
pub fn selected_project_file() -> PathBuf {
    clover_dir().join("selected-project.json")
}

/// `~/.clover/mcp-servers.json`
pub fn mcp_file() -> PathBuf {
    clover_dir().join("mcp-servers.json")
}

/// `~/.clover/skills.json` — legacy skill store.
pub fn skills_file() -> PathBuf {
    clover_dir().join("skills.json")
}

/// `~/.clover/skills` — directory skill store (the only writable source).
pub fn skills_dir() -> PathBuf {
    clover_dir().join("skills")
}

/// `~/.clover/agents` — managed binary agent installs.
pub fn agents_dir() -> PathBuf {
    clover_dir().join("agents")
}

/// Log directory, honoring `CLOVER_LOG_DIR`.
pub fn log_dir() -> PathBuf {
    match std::env::var("CLOVER_LOG_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => clover_dir().join("logs"),
    }
}

/// Home directory, resolved the same way Node's `os.homedir()` does.
///
/// `CLOVER_HOME_DIR` overrides it so the parity harness and portable installs
/// can point every home-based source (`~/…` paths, global skill directories)
/// at a sandbox. Node honours `USERPROFILE`; `dirs::home_dir()` on Windows
/// reads the known folder instead, so the two servers need a shared switch.
pub fn home_dir() -> PathBuf {
    match std::env::var("CLOVER_HOME_DIR") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")),
    }
}

/// Create a directory (and parents) if missing.
pub fn ensure_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)
}

/// Read a UTF-8 text file, dropping a leading BOM.
///
/// Editors on Windows (older Notepad, PowerShell `Set-Content -Encoding UTF8`)
/// prepend `U+FEFF`, which makes `serde_json`/`JSON.parse` fail on a file that
/// is otherwise valid.
pub fn read_text(file: impl AsRef<std::path::Path>) -> std::io::Result<String> {
    let text = std::fs::read_to_string(file)?;
    Ok(match text.strip_prefix('\u{feff}') {
        Some(stripped) => stripped.to_string(),
        None => text,
    })
}

/// Expand a leading `~` the way the TypeScript skill scanner did.
pub fn expand_home(input: &str) -> PathBuf {
    if input == "~" {
        return home_dir();
    }
    if let Some(rest) = input.strip_prefix("~/").or_else(|| input.strip_prefix("~\\")) {
        return home_dir().join(rest);
    }
    PathBuf::from(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_tilde() {
        assert_eq!(expand_home("~"), home_dir());
        assert_eq!(expand_home("~/a/b"), home_dir().join("a").join("b"));
        assert_eq!(expand_home("/abs"), PathBuf::from("/abs"));
    }

    #[test]
    fn read_text_strips_a_bom() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!("clover-paths-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("with-bom.json");
        std::fs::write(&file, "\u{feff}{\"ok\":true}").expect("write");

        assert_eq!(read_text(&file).expect("read"), "{\"ok\":true}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}