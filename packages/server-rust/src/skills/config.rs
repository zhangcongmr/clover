//! `opencode.json(c)` skill configuration parsing.
//!
//! Only user-level configuration is read: the global
//! `~/.config/opencode/opencode.json(c)` plus explicitly passed files. Project
//! configuration is deliberately ignored, matching the TS implementation.

use std::path::{Path, PathBuf};

use serde_json::Value;

pub const CONFIG_FILE_NAMES: [&str; 2] = ["opencode.json", "opencode.jsonc"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigSkillEntryKind {
    Path,
    Url,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigSkillEntry {
    pub kind: ConfigSkillEntryKind,
    /// Raw configured value (path or URL).
    pub value: String,
    /// File that contributed this entry.
    pub file: String,
}

#[derive(Debug, Clone, Default)]
pub struct ConfigScanResult {
    pub entries: Vec<ConfigSkillEntry>,
    /// Files that were actually read.
    pub files: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ConfigScanOptions {
    pub home: PathBuf,
    pub include_global: Option<bool>,
    pub config_files: Vec<String>,
}

impl ConfigScanOptions {
    pub fn new(home: impl Into<PathBuf>) -> Self {
        Self {
            home: home.into(),
            include_global: None,
            config_files: Vec::new(),
        }
    }
}

/// Read the configured files and collect their `skills` entries.
pub fn collect_config_skill_entries(options: &ConfigScanOptions) -> ConfigScanResult {
    let mut result = ConfigScanResult::default();

    if options.include_global != Some(false) {
        let global_dir = options.home.join(".config").join("opencode");
        for name in CONFIG_FILE_NAMES {
            add_file(&mut result.files, &global_dir.join(name));
        }
    }
    for path in &options.config_files {
        add_file(&mut result.files, Path::new(path));
    }

    for file in &result.files {
        let raw = match crate::paths::read_text(file) {
            Ok(raw) => raw,
            Err(error) => {
                result
                    .errors
                    .push(format!("Failed to read config {file}: {error}"));
                continue;
            }
        };

        let parsed = match parse_opencode_config(&raw) {
            Ok(parsed) => parsed,
            Err(error) => {
                result
                    .errors
                    .push(format!("Failed to parse config {file}: {error}"));
                continue;
            }
        };

        let Some(skills) = parsed.get("skills") else {
            continue;
        };
        if skills.is_null() {
            continue;
        }

        let raw_values: Vec<&Value> = if let Some(array) = skills.as_array() {
            array.iter().collect()
        } else if let Some(object) = skills.as_object() {
            let mut values = Vec::new();
            values.extend(as_unknown_array(
                object.get("paths"),
                &format!("{file}: \"skills.paths\" must be an array"),
                &mut result.errors,
            ));
            values.extend(as_unknown_array(
                object.get("urls"),
                &format!("{file}: \"skills.urls\" must be an array"),
                &mut result.errors,
            ));
            values
        } else {
            result.errors.push(format!(
                "Config {file}: \"skills\" must be an array or an object with \"paths\"/\"urls\""
            ));
            continue;
        };

        for item in raw_values {
            let Some(raw_value) = item.as_str() else {
                result
                    .errors
                    .push(format!("Config {file}: non-string entry in \"skills\" skipped"));
                continue;
            };
            let value = raw_value.trim();
            if value.is_empty() {
                result
                    .errors
                    .push(format!("Config {file}: empty entry in \"skills\" skipped"));
                continue;
            }

            if looks_like_url(value) {
                result.entries.push(ConfigSkillEntry {
                    kind: ConfigSkillEntryKind::Url,
                    value: value.to_string(),
                    file: file.clone(),
                });
            } else if looks_like_other_scheme(value) {
                result.errors.push(format!(
                    "Config {file}: unsupported skills entry scheme \"{value}\" (only http/https and paths)"
                ));
            } else {
                result.entries.push(ConfigSkillEntry {
                    kind: ConfigSkillEntryKind::Path,
                    value: value.to_string(),
                    file: file.clone(),
                });
            }
        }
    }

    result
}

fn add_file(files: &mut Vec<String>, path: &Path) {
    if !path.exists() {
        return;
    }
    let text = path.to_string_lossy().to_string();
    if files.contains(&text) {
        return;
    }
    files.push(text);
}

fn as_unknown_array<'a>(
    value: Option<&'a Value>,
    error_message: &str,
    errors: &mut Vec<String>,
) -> Vec<&'a Value> {
    match value {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items.iter().collect(),
        Some(_) => {
            errors.push(error_message.to_string());
            Vec::new()
        }
    }
}

fn looks_like_url(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

/// Any other `scheme://` value is reported and skipped.
fn looks_like_other_scheme(value: &str) -> bool {
    let Some(scheme_end) = value.find("://") else {
        return false;
    };
    let scheme = &value[..scheme_end];
    let mut chars = scheme.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphabetic()
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
}

/// Parse JSONC: comments removed, trailing commas dropped.
pub fn parse_opencode_config(raw: &str) -> Result<Value, serde_json::Error> {
    let without_comments = strip_json_comments(raw);
    let without_trailing = strip_trailing_commas(&without_comments);
    serde_json::from_str(&without_trailing)
}

/// Remove `//` and `/* */` comments while preserving string literals.
pub fn strip_json_comments(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;

    while index < chars.len() {
        let current = chars[index];

        if in_string {
            out.push(current);
            if escaped {
                escaped = false;
            } else if current == '\\' {
                escaped = true;
            } else if current == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }

        if current == '"' {
            in_string = true;
            out.push(current);
            index += 1;
            continue;
        }

        if current == '/' && chars.get(index + 1) == Some(&'/') {
            while index < chars.len() && chars[index] != '\n' {
                index += 1;
            }
            out.push('\n');
            index += 1; // skip the newline itself
            continue;
        }

        if current == '/' && chars.get(index + 1) == Some(&'*') {
            index += 2;
            while index < chars.len()
                && !(chars[index] == '*' && chars.get(index + 1) == Some(&'/'))
            {
                if chars[index] == '\n' {
                    out.push('\n');
                }
                index += 1;
            }
            index += 2; // skip `*` and `/`
            continue;
        }

        out.push(current);
        index += 1;
    }

    out
}

/// Drop trailing commas before `}` / `]`.
pub fn strip_trailing_commas(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut index = 0;
    let mut in_string = false;
    let mut escaped = false;

    while index < chars.len() {
        let current = chars[index];

        if in_string {
            out.push(current);
            if escaped {
                escaped = false;
            } else if current == '\\' {
                escaped = true;
            } else if current == '"' {
                in_string = false;
            }
            index += 1;
            continue;
        }

        if current == '"' {
            in_string = true;
            out.push(current);
            index += 1;
            continue;
        }

        if current == ',' {
            let mut lookahead = index + 1;
            while lookahead < chars.len() && chars[lookahead].is_whitespace() {
                lookahead += 1;
            }
            if matches!(chars.get(lookahead), Some('}') | Some(']')) {
                index += 1;
                continue;
            }
        }

        out.push(current);
        index += 1;
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!(
                "clover-skills-{tag}-{}",
                uuid::Uuid::new_v4().simple()
            ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    #[test]
    fn strips_comments_but_keeps_strings() {
        let raw = r#"{
            // line comment
            "url": "https://example.test//x", /* block */
            "n": 1,
        }"#;
        let parsed = parse_opencode_config(raw).expect("parse");
        assert_eq!(parsed["url"], "https://example.test//x");
        assert_eq!(parsed["n"], 1);
    }

    #[test]
    fn strips_trailing_commas() {
        let parsed = parse_opencode_config(r#"{"a": [1, 2,], "b": {"c": 1,},}"#).expect("parse");
        assert_eq!(parsed, json!({"a": [1, 2], "b": {"c": 1}}));
    }

    #[test]
    fn collects_array_and_object_forms() {
        let dir = temp_dir("config");
        let file = dir.join("opencode.json");
        std::fs::write(
            &file,
            r#"{
                // comment
                "skills": ["./local", "https://catalog.test/skills", "ftp://nope"],
            }"#,
        )
        .expect("write config");

        let result = collect_config_skill_entries(&ConfigScanOptions {
            home: dir.clone(),
            include_global: Some(false),
            config_files: vec![file.to_string_lossy().to_string()],
        });

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].value, "./local");
        assert_eq!(result.entries[0].kind, ConfigSkillEntryKind::Path);
        assert_eq!(result.entries[1].value, "https://catalog.test/skills");
        assert_eq!(result.entries[1].kind, ConfigSkillEntryKind::Url);
        assert!(
            result.errors[0].contains("unsupported skills entry scheme"),
            "{:?}",
            result.errors
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn object_form_with_paths_and_urls() {
        let dir = temp_dir("object");
        let file = dir.join("opencode.jsonc");
        std::fs::write(
            &file,
            r#"{ "skills": { "paths": ["~/skills-a"], "urls": ["https://x.test/c"] } }"#,
        )
        .expect("write config");

        let result = collect_config_skill_entries(&ConfigScanOptions {
            home: dir.clone(),
            include_global: Some(false),
            config_files: vec![file.to_string_lossy().to_string()],
        });

        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].kind, ConfigSkillEntryKind::Path);
        assert_eq!(result.entries[1].kind, ConfigSkillEntryKind::Url);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn malformed_config_is_reported_not_fatal() {
        let dir = temp_dir("broken");
        let file = dir.join("opencode.json");
        std::fs::write(&file, "{ \"skills\": ").expect("write config");

        let result = collect_config_skill_entries(&ConfigScanOptions {
            home: dir.clone(),
            include_global: Some(false),
            config_files: vec![file.to_string_lossy().to_string()],
        });

        assert!(result.entries.is_empty());
        assert!(result.errors[0].starts_with("Failed to parse config"));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn non_array_paths_entry_is_reported() {
        let dir = temp_dir("badtype");
        let file = dir.join("opencode.json");
        std::fs::write(&file, r#"{ "skills": { "paths": "./one" } }"#).expect("write");

        let result = collect_config_skill_entries(&ConfigScanOptions {
            home: dir.clone(),
            include_global: Some(false),
            config_files: vec![file.to_string_lossy().to_string()],
        });

        assert!(result.entries.is_empty());
        assert!(result.errors[0].contains("must be an array"));

        let _ = std::fs::remove_dir_all(&dir);
    }
}