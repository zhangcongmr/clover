//! Skill discovery.
//!
//! Port of `packages/server/src/skills/discovery.ts`. Each source is a
//! directory that may contain:
//!
//! - plain markdown at the root: `<source>/review.md` gives id `review`
//! - `SKILL.md` at any depth: `<source>/team/release/SKILL.md` gives `release`
//!
//! Only user-level sources are scanned (global compat directories, the writable
//! `~/.clover/skills` store, extra roots and `opencode.json(c)` path entries).
//! Project-level directories and config are never read.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use indexmap::IndexMap;

use crate::skills::config::{
    collect_config_skill_entries, ConfigScanOptions, ConfigSkillEntryKind,
};
use crate::skills::paths::{canonical_key, directory_exists, resolve_user_path};
use crate::skills::types::Skill;

/// Label of the writable directory store.
pub const DIR_STORE_LABEL: &str = "~/.clover/skills";
/// Default scan depth cap per source.
const DEFAULT_MAX_DEPTH: usize = 6;
/// Directory names skipped while walking.
const IGNORED_DIRS: [&str; 6] = ["node_modules", "dist", "build", "out", "coverage", "vendor"];

#[derive(Debug, Clone)]
pub struct SkillSource {
    pub dir: PathBuf,
    /// Label used in the UI (`~/.claude/skills`, raw config value, ...).
    pub label: String,
    pub max_depth: usize,
}

#[derive(Debug, Clone, Default)]
pub struct DiscoverOptions {
    /// Legacy `skills.json` contents (lowest precedence).
    pub store: Option<IndexMap<String, Skill>>,
    pub cwd: Option<PathBuf>,
    pub home: Option<PathBuf>,
    /// Writable directory store (defaults to `<home>/.clover/skills`).
    pub store_dir: Option<PathBuf>,
    /// Path reported for legacy entries (defaults to `<home>/.clover/skills.json`).
    pub store_file: Option<PathBuf>,
    pub extra_roots: Vec<String>,
    pub include_global: Option<bool>,
    pub include_config: Option<bool>,
    pub config_files: Vec<String>,
    pub max_depth: Option<usize>,
}

#[derive(Debug, Clone, Default)]
pub struct SkillDiscovery {
    /// Aggregated skills keyed by id; later sources overwrite earlier ones.
    pub skills: IndexMap<String, Skill>,
    /// Ids that can be edited through the API.
    pub writable: HashSet<String>,
    /// Directories actually scanned (absolute, low to high precedence).
    pub sources: Vec<String>,
    pub config_files: Vec<String>,
    pub catalogs: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Default)]
pub struct SourceReport {
    pub errors: Vec<String>,
    pub config_files: Vec<String>,
    pub catalogs: Vec<String>,
}

// ==========================================================================
// Front matter
// ==========================================================================

#[derive(Debug, Default, PartialEq, Eq)]
pub struct FrontMatter {
    pub name: Option<String>,
    pub description: Option<String>,
    /// `None` = not declared, `Some(false)` = model invocation disabled.
    pub autoinvoke: Option<bool>,
}

/// `---` delimited header + body.
pub fn parse_front_matter(raw: &str) -> (FrontMatter, &str) {
    let Some((header, body)) = split_front_matter(raw) else {
        return (FrontMatter::default(), raw);
    };

    let mut attributes = FrontMatter::default();
    let mut in_metadata = false;

    for line in header.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }

        let Some(colon) = line.find(':') else {
            continue;
        };
        let key = line[..colon].trim();
        let value = strip_quotes(line[colon + 1..].trim());
        let nested = line.starts_with(char::is_whitespace);

        if !nested {
            in_metadata = key == "metadata";
            if in_metadata {
                continue;
            }
        } else if !in_metadata {
            continue;
        }

        match key {
            "name" if attributes.name.is_none() => attributes.name = Some(value.to_string()),
            "description" if attributes.description.is_none() => {
                attributes.description = Some(value.to_string());
            }
            "disable-model-invocation" if value == "true" => {
                attributes.autoinvoke = Some(false);
            }
            "opencode/autoinvoke" if !value.is_empty() => {
                attributes.autoinvoke = Some(value != "false");
            }
            _ => {}
        }
    }

    (attributes, body)
}

/// Split `---\n...\n---\n` from the body; mirrors the TS regex
/// `^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?`.
fn split_front_matter(raw: &str) -> Option<(&str, &str)> {
    let text = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let rest = text.strip_prefix("---")?;
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))?;

    let mut line_start = 0;
    loop {
        let line_end = rest[line_start..]
            .find('\n')
            .map(|offset| line_start + offset)
            .unwrap_or(rest.len());
        let line = &rest[line_start..line_end];
        let line = line.strip_suffix('\r').unwrap_or(line);

        if line == "---" {
            let header = rest[..line_start]
                .strip_suffix("\r\n")
                .or_else(|| rest[..line_start].strip_suffix('\n'))
                .unwrap_or(&rest[..line_start]);
            let body_start = if line_end < rest.len() {
                line_end + 1
            } else {
                line_end
            };
            return Some((header, &rest[body_start..]));
        }

        if line_end >= rest.len() {
            return None;
        }
        line_start = line_end + 1;
    }
}

fn strip_quotes(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2
        && (bytes[0] == b'"' || bytes[0] == b'\'')
        && bytes[bytes.len() - 1] == bytes[0]
    {
        return &value[1..value.len() - 1];
    }
    value
}

// ==========================================================================
// File classification
// ==========================================================================

/// Root-level markdown file (`review.md`).
pub fn is_root_skill_file(file_name: &str) -> bool {
    let lower = file_name.to_ascii_lowercase();
    (lower.ends_with(".md") || lower.ends_with(".markdown")) && !file_name.starts_with('.')
}

/// Nested entry file: exactly `SKILL.md` (case-insensitive).
pub fn is_nested_skill_file(file_name: &str) -> bool {
    file_name.eq_ignore_ascii_case("skill.md")
}

/// Id from the entry file: parent directory name, or the file stem at the root.
pub fn derive_skill_id(entry_file: &Path, source_dir: &Path) -> String {
    let parent = entry_file.parent().unwrap_or(Path::new(""));
    if parent == source_dir {
        return file_stem(entry_file);
    }
    parent
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn file_stem(path: &Path) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let lower = name.to_ascii_lowercase();
    for extension in [".markdown", ".md"] {
        if lower.ends_with(extension) {
            return name[..name.len() - extension.len()].to_string();
        }
    }
    name
}

// ==========================================================================
// Scan
// ==========================================================================

/// Scan one source: root markdown + `SKILL.md` at any depth (bounded).
pub fn scan_skill_source(source: &SkillSource) -> (Vec<Skill>, Vec<String>) {
    let mut entries = Vec::new();
    let mut errors = Vec::new();
    walk(source, &source.dir, 0, &mut entries, &mut errors);
    (entries, errors)
}

fn walk(
    source: &SkillSource,
    dir: &Path,
    depth: usize,
    entries: &mut Vec<Skill>,
    errors: &mut Vec<String>,
) {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        errors.push(format!(
            "Failed to read skill directory {}: permission denied or missing",
            dir.display()
        ));
        return;
    };

    for entry in read_dir.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let full = dir.join(&name);
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                errors.push(format!("Failed to stat {}: {error}", full.display()));
                continue;
            }
        };

        if file_type.is_dir() {
            if depth >= source.max_depth {
                continue;
            }
            if name.starts_with('.') || is_ignored_dir(&name) {
                continue;
            }
            walk(source, &full, depth + 1, entries, errors);
            continue;
        }

        let matches = if depth == 0 {
            is_root_skill_file(&name)
        } else {
            is_nested_skill_file(&name)
        };
        if !matches {
            continue;
        }

        // Symlinks must resolve to a regular file.
        let is_file = if file_type.is_symlink() {
            std::fs::metadata(&full)
                .map(|meta| meta.is_file())
                .unwrap_or(false)
        } else {
            file_type.is_file()
        };
        if !is_file {
            continue;
        }

        let id = derive_skill_id(&full, &source.dir);
        if id.is_empty() {
            continue;
        }

        match read_skill_file(&full, &id, &source.label) {
            Ok(skill) => entries.push(skill),
            Err(error) => errors.push(format!(
                "Failed to read skill file {}: {error}",
                full.display()
            )),
        }
    }
}

fn is_ignored_dir(name: &str) -> bool {
    IGNORED_DIRS.contains(&name)
}

fn read_skill_file(entry_file: &Path, id: &str, source_label: &str) -> std::io::Result<Skill> {
    let bytes = std::fs::read(entry_file)?;
    let raw = String::from_utf8_lossy(&bytes);
    let (attributes, body) = parse_front_matter(&raw);

    let display_name = attributes
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(id)
        .to_string();

    Ok(Skill {
        name: id.to_string(),
        description: attributes
            .description
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_string(),
        content: body.trim().to_string(),
        display_name: Some(display_name),
        source: Some(source_label.to_string()),
        path: Some(entry_file.to_string_lossy().to_string()),
        autoinvoke: Some(attributes.autoinvoke != Some(false)),
    })
}

// ==========================================================================
// Sources
// ==========================================================================

pub fn collect_skill_sources(
    options: &DiscoverOptions,
    report: &mut SourceReport,
) -> Vec<SkillSource> {
    let cwd = options
        .cwd
        .clone()
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    let home = options
        .home
        .clone()
        .unwrap_or_else(crate::paths::home_dir);
    let store_dir = options
        .store_dir
        .clone()
        .unwrap_or_else(|| home.join(".clover").join("skills"));
    let max_depth = options.max_depth.unwrap_or(DEFAULT_MAX_DEPTH);
    let include_global = options.include_global != Some(false);

    let mut sources: Vec<SkillSource> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    let mut push = |dir: PathBuf, label: String| {
        let key = canonical_key(&dir);
        if !seen.insert(key) {
            return;
        }
        sources.push(SkillSource {
            dir,
            label,
            max_depth,
        });
    };

    if include_global {
        push(
            home.join(".claude").join("skills"),
            "~/.claude/skills".to_string(),
        );
        push(
            home.join(".agents").join("skills"),
            "~/.agents/skills".to_string(),
        );
        push(
            home.join(".config").join("opencode").join("skills"),
            "~/.config/opencode/skills".to_string(),
        );
        push(store_dir, DIR_STORE_LABEL.to_string());
    }

    for root in &options.extra_roots {
        let trimmed = root.trim();
        if trimmed.is_empty() {
            continue;
        }
        push(resolve_user_path(trimmed, &cwd, &home), trimmed.to_string());
    }

    if options.include_config != Some(false) {
        let config = collect_config_skill_entries(&ConfigScanOptions {
            home: home.clone(),
            include_global: options.include_global,
            config_files: options.config_files.clone(),
        });
        report.errors.extend(config.errors);
        report.config_files.extend(config.files);

        for entry in config.entries {
            match entry.kind {
                ConfigSkillEntryKind::Path => push(
                    resolve_user_path(&entry.value, &cwd, &home),
                    entry.value.clone(),
                ),
                ConfigSkillEntryKind::Url => {
                    if !report.catalogs.contains(&entry.value) {
                        report.catalogs.push(entry.value.clone());
                    }
                }
            }
        }
    }

    sources
}

// ==========================================================================
// Aggregation
// ==========================================================================

pub fn discover_skills(options: &DiscoverOptions) -> SkillDiscovery {
    let home = options
        .home
        .clone()
        .unwrap_or_else(crate::paths::home_dir);
    let store_file = options
        .store_file
        .clone()
        .unwrap_or_else(|| home.join(".clover").join("skills.json"));

    let mut discovery = SkillDiscovery::default();
    let mut skills: IndexMap<String, Skill> = IndexMap::new();

    // 1. Lowest precedence: the legacy JSON store (defaults filled in).
    for (id, value) in options.store.clone().unwrap_or_default() {
        if id.is_empty() {
            continue;
        }
        skills.insert(
            id.clone(),
            Skill {
                name: id.clone(),
                description: value.description,
                content: value.content,
                display_name: Some(value.display_name.unwrap_or_else(|| id.clone())),
                source: Some(value.source.unwrap_or_else(|| "store".to_string())),
                path: Some(
                    value
                        .path
                        .unwrap_or_else(|| store_file.to_string_lossy().to_string()),
                ),
                autoinvoke: Some(value.autoinvoke.unwrap_or(true)),
            },
        );
    }
    let store_ids: HashSet<String> = skills.keys().cloned().collect();

    // 2. Disk sources, increasing precedence.
    let mut report = SourceReport::default();
    let sources = collect_skill_sources(options, &mut report);
    discovery.errors.extend(report.errors);

    let scanned: Vec<PathBuf> = sources
        .iter()
        .filter(|source| directory_exists(&source.dir))
        .map(|source| source.dir.clone())
        .collect();

    for source in &sources {
        if !directory_exists(&source.dir) {
            continue;
        }
        let (entries, errors) = scan_skill_source(source);
        discovery.errors.extend(errors);
        for entry in entries {
            skills.insert(entry.name.clone(), entry);
        }
    }

    // 3. Writable = legacy-only entries that no disk source shadows.
    for id in &store_ids {
        if skills.contains_key(id) && !is_from_disk(id, &sources) {
            discovery.writable.insert(id.clone());
        }
    }

    discovery.sources = scanned
        .iter()
        .map(|dir| dir.to_string_lossy().to_string())
        .collect();
    discovery.config_files = report.config_files;
    discovery.catalogs = report.catalogs;
    discovery.skills = skills;
    discovery
}

/// Whether any existing source provides this id on disk (so it is read-only).
fn is_from_disk(id: &str, sources: &[SkillSource]) -> bool {
    for source in sources {
        if !directory_exists(&source.dir) {
            continue;
        }
        let direct = source.dir.join(id);
        if direct.is_dir() && direct.join("SKILL.md").exists() {
            return true;
        }
        let flat = source.dir.join(format!("{id}.md"));
        if flat.is_file() {
            return true;
        }
    }
    false
}

/// Convenience for the registry: map directory -> source label for diagnostics.
pub fn source_labels(sources: &[SkillSource]) -> HashMap<String, String> {
    sources
        .iter()
        .map(|source| (source.dir.to_string_lossy().to_string(), source.label.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(tag: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!(
                "clover-discovery-{tag}-{}",
                uuid::Uuid::new_v4().simple()
            ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("mkdir");
        }
        std::fs::write(path, content).expect("write");
    }

    #[test]
    fn parses_front_matter_fields() {
        let raw = "\u{feff}---\r\nname: \"Review\"\r\ndescription: 'Checks code'\r\nopencode/autoinvoke: false\r\n---\r\n\r\nBody line\r\n";
        let (attributes, body) = parse_front_matter(raw);
        assert_eq!(attributes.name.as_deref(), Some("Review"));
        assert_eq!(attributes.description.as_deref(), Some("Checks code"));
        assert_eq!(attributes.autoinvoke, Some(false));
        assert_eq!(body.trim(), "Body line");
    }

    #[test]
    fn reads_nested_metadata_and_disable_flag() {
        let raw =
            "---\nname: a\nmetadata:\n  owner: me\ndisable-model-invocation: true\n---\nbody";
        let (attributes, _) = parse_front_matter(raw);
        assert_eq!(attributes.name.as_deref(), Some("a"));
        assert_eq!(attributes.autoinvoke, Some(false));
    }

    #[test]
    fn missing_front_matter_keeps_the_whole_file() {
        let (attributes, body) = parse_front_matter("# Title\ncontent");
        assert_eq!(attributes, FrontMatter::default());
        assert_eq!(body, "# Title\ncontent");
    }

    #[test]
    fn derives_ids_from_root_and_nested_files() {
        let source = PathBuf::from("/skills");
        assert_eq!(
            derive_skill_id(&source.join("review.md"), &source),
            "review"
        );
        assert_eq!(
            derive_skill_id(&source.join("team").join("release").join("SKILL.md"), &source),
            "release"
        );
    }

    #[test]
    fn classifies_entry_files() {
        assert!(is_root_skill_file("review.md"));
        assert!(is_root_skill_file("REVIEW.MARKDOWN"));
        assert!(!is_root_skill_file(".hidden.md"));
        assert!(is_nested_skill_file("skill.md"));
        assert!(is_nested_skill_file("SKILL.MD"));
        assert!(!is_nested_skill_file("other.md"));
    }

    #[test]
    fn scans_root_markdown_and_nested_skill_files() {
        let dir = temp_dir("scan");
        write(
            &dir.join("review.md"),
            "---\nname: Reviewer\n---\n\nroot body\n",
        );
        write(
            &dir.join("team").join("release").join("SKILL.md"),
            "nested body",
        );
        write(&dir.join("team").join("notes.md"), "ignored");
        write(&dir.join(".hidden").join("SKILL.md"), "ignored");
        write(
            &dir.join("node_modules").join("pkg").join("SKILL.md"),
            "ignored",
        );

        let (entries, errors) = scan_skill_source(&SkillSource {
            dir: dir.clone(),
            label: "test".to_string(),
            max_depth: DEFAULT_MAX_DEPTH,
        });

        assert!(errors.is_empty(), "{errors:?}");
        let ids: Vec<&str> = entries.iter().map(|entry| entry.name.as_str()).collect();
        assert!(ids.contains(&"review"));
        assert!(ids.contains(&"release"));
        assert_eq!(ids.len(), 2);

        let review = entries
            .iter()
            .find(|entry| entry.name == "review")
            .expect("review");
        assert_eq!(review.display_name.as_deref(), Some("Reviewer"));
        assert_eq!(review.content, "root body");
        assert_eq!(review.autoinvoke, Some(true));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn later_sources_override_earlier_ones() {
        let home = temp_dir("precedence");
        write(
            &home.join(".claude").join("skills").join("review.md"),
            "claude body",
        );
        write(
            &home
                .join(".clover")
                .join("skills")
                .join("review")
                .join("SKILL.md"),
            "store body",
        );

        let discovery = discover_skills(&DiscoverOptions {
            home: Some(home.clone()),
            cwd: Some(home.clone()),
            include_config: Some(false),
            ..Default::default()
        });

        assert_eq!(discovery.skills["review"].content, "store body");
        assert_eq!(discovery.sources.len(), 2);

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn legacy_store_entries_are_writable_only_without_disk_copy() {
        let home = temp_dir("writable");
        write(
            &home
                .join(".clover")
                .join("skills")
                .join("disk-only")
                .join("SKILL.md"),
            "disk",
        );

        let mut store = IndexMap::new();
        store.insert(
            "legacy-only".to_string(),
            Skill {
                name: "legacy-only".to_string(),
                description: "d".to_string(),
                content: "c".to_string(),
                ..Default::default()
            },
        );
        store.insert(
            "disk-only".to_string(),
            Skill {
                name: "disk-only".to_string(),
                description: "d".to_string(),
                content: "c".to_string(),
                ..Default::default()
            },
        );

        let discovery = discover_skills(&DiscoverOptions {
            store: Some(store),
            home: Some(home.clone()),
            cwd: Some(home.clone()),
            include_config: Some(false),
            ..Default::default()
        });

        assert!(discovery.writable.contains("legacy-only"));
        assert!(!discovery.writable.contains("disk-only"));
        // Disk entry won the id conflict.
        assert_eq!(discovery.skills["disk-only"].content, "disk");

        let _ = std::fs::remove_dir_all(&home);
    }
}