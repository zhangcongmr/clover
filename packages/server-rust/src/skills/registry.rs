//! Writable skill registry.
//!
//! Port of `packages/server/src/skills/registry.ts`:
//!
//! - the aggregated view is the legacy `skills.json` store overlaid with every
//!   discovered directory source;
//! - writes always go to the directory store `<state_dir>/skills/<name>/`
//!   (`SKILL.md` + supporting files), which is itself a discovery source;
//! - only directory-store skills (and legacy-only entries) are writable.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use indexmap::IndexMap;
use serde_json::Value;

use crate::skills::discovery::{discover_skills, DiscoverOptions, SkillDiscovery, DIR_STORE_LABEL};
use crate::skills::types::{Skill, SkillsStore};

/// Maximum supporting files per skill.
pub const MAX_FILES_PER_SKILL: usize = 100;
/// Maximum size of a single supporting file (512 KiB).
pub const MAX_FILE_BYTES: usize = 512 * 1024;
/// Maximum total size of supporting files (4 MiB).
pub const MAX_TOTAL_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct SkillRegistryOptions {
    /// User home (global compat directories).
    pub home: PathBuf,
    /// State root (`~/.clover`): holds `skills.json` and `skills/`.
    pub state_dir: PathBuf,
    pub cwd: Option<PathBuf>,
    pub extra_roots: Vec<String>,
    pub config_files: Vec<String>,
    /// `false` reads only the legacy store (no disk scan).
    pub discovery: bool,
}

impl SkillRegistryOptions {
    pub fn new(home: impl Into<PathBuf>, state_dir: impl Into<PathBuf>) -> Self {
        Self {
            home: home.into(),
            state_dir: state_dir.into(),
            cwd: None,
            extra_roots: Vec::new(),
            config_files: Vec::new(),
            discovery: true,
        }
    }
}

#[derive(Debug, Default)]
struct RegistryState {
    /// Legacy `skills.json` (read fallback, rewritten only on delete).
    persisted: SkillsStore,
    /// Aggregated view exposed through the API.
    store: IndexMap<String, Skill>,
    writable: HashSet<String>,
    discovery: Option<SkillDiscovery>,
}

#[derive(Debug)]
pub struct SkillRegistry {
    options: SkillRegistryOptions,
    store_file: PathBuf,
    store_root: PathBuf,
    state: Mutex<RegistryState>,
}

impl SkillRegistry {
    pub fn open(options: SkillRegistryOptions) -> Self {
        let store_file = options.state_dir.join("skills.json");
        let store_root = options.state_dir.join("skills");
        let registry = Self {
            options,
            store_file,
            store_root,
            state: Mutex::new(RegistryState::default()),
        };
        registry.load();
        registry
    }

    fn load(&self) {
        let persisted = read_store(&self.store_file);
        let mut state = self.state.lock().expect("skill registry poisoned");

        if !self.options.discovery {
            let mut writable = HashSet::new();
            for id in persisted.skills.keys() {
                writable.insert(id.clone());
            }
            state.store = persisted.skills.clone();
            state.writable = writable;
            state.discovery = None;
            state.persisted = persisted;
            return;
        }

        let discovery = discover_skills(&DiscoverOptions {
            store: Some(persisted.skills.clone()),
            cwd: self.options.cwd.clone(),
            home: Some(self.options.home.clone()),
            store_dir: Some(self.store_root.clone()),
            store_file: Some(self.store_file.clone()),
            extra_roots: self.options.extra_roots.clone(),
            include_global: None,
            include_config: None,
            config_files: self.options.config_files.clone(),
            max_depth: None,
        });

        for error in &discovery.errors {
            tracing::error!("[Skill Registry] Discovery warning: {error}");
        }

        let mut writable = discovery.writable.clone();
        for (id, skill) in &discovery.skills {
            if skill.source.as_deref() == Some(DIR_STORE_LABEL) {
                writable.insert(id.clone());
            }
        }

        tracing::info!(
            "[Skill Registry] Aggregated {} skill(s) from {} source(s)",
            discovery.skills.len(),
            discovery.sources.len()
        );

        state.store = discovery.skills.clone();
        state.writable = writable;
        state.discovery = Some(discovery);
        state.persisted = persisted;
    }

    /// Re-read the store and every disk source.
    pub fn reload(&self) -> Option<SkillDiscovery> {
        self.load();
        self.discovery()
    }

    pub fn discovery(&self) -> Option<SkillDiscovery> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.discovery.clone())
    }

    pub fn can_modify(&self, name: &str) -> bool {
        self.state
            .lock()
            .map(|state| state.writable.contains(name))
            .unwrap_or(false)
    }

    pub fn get(&self, name: &str) -> Option<Skill> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.store.get(name).cloned())
    }

    pub fn list(&self) -> Vec<Skill> {
        self.state
            .lock()
            .map(|state| state.store.values().cloned().collect())
            .unwrap_or_default()
    }

    pub fn count(&self) -> usize {
        self.state
            .lock()
            .map(|state| state.store.len())
            .unwrap_or(0)
    }

    /// Number of supporting files (excluding `SKILL.md`).
    pub fn file_count(&self, name: &str) -> usize {
        self.list_skill_files(name).len()
    }

    /// Supporting files of the directory-store skill: relative path → content.
    pub fn list_skill_files(&self, name: &str) -> IndexMap<String, String> {
        let mut files = IndexMap::new();
        if !is_valid_skill_name(name) {
            return files;
        }
        let dir = self.store_root.join(name);
        if !dir.is_dir() {
            return files;
        }
        collect_files(&dir, "", &mut files);
        files
    }

    /// Create or replace `<state_dir>/skills/<name>/SKILL.md` (+ files).
    pub fn upsert(
        &self,
        name: &str,
        description: &str,
        content: &str,
        files: Option<IndexMap<String, String>>,
    ) -> Result<(), String> {
        let clean = name.trim();
        if !is_valid_skill_name(clean) {
            return Err(
                "name may only contain letters, numbers, hyphens and underscores".to_string(),
            );
        }
        if let Some(files) = &files
            && let Some(error) = validate_skill_files(files)
        {
            return Err(error);
        }

        let dir = self.store_root.join(clean);
        std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;

        let markdown = render_skill_markdown(clean, description, content);
        std::fs::write(dir.join("SKILL.md"), markdown).map_err(|error| error.to_string())?;

        for (relative, body) in files.unwrap_or_default() {
            if relative == "SKILL.md" {
                continue; // the body always comes from `content`
            }
            let target = join_relative(&dir, &relative);
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            std::fs::write(&target, body).map_err(|error| error.to_string())?;
        }

        let mut state = self.state.lock().expect("skill registry poisoned");
        state.store.insert(
            clean.to_string(),
            Skill {
                name: clean.to_string(),
                description: description.to_string(),
                content: content.to_string(),
                display_name: Some(clean.to_string()),
                source: Some(DIR_STORE_LABEL.to_string()),
                path: Some(dir.join("SKILL.md").to_string_lossy().to_string()),
                autoinvoke: Some(true),
            },
        );
        state.writable.insert(clean.to_string());
        Ok(())
    }

    /// Delete the directory and any legacy entry with the same id.
    pub fn remove(&self, name: &str) -> bool {
        if !is_valid_skill_name(name) {
            return false;
        }
        let mut state = self.state.lock().expect("skill registry poisoned");
        if !state.store.contains_key(name) {
            return false;
        }

        if state.persisted.skills.shift_remove(name).is_some() {
            let persisted = state.persisted.clone();
            drop(state);
            save_store(&self.store_file, &persisted);
            state = self.state.lock().expect("skill registry poisoned");
        }

        let _ = std::fs::remove_dir_all(self.store_root.join(name));

        state.writable.remove(name);
        state.store.shift_remove(name);
        true
    }

    /// Copy a skill (`<name>-copy`, `<name>-copy-2`, …) right after the source.
    pub fn duplicate(&self, name: &str) -> Result<Option<Skill>, String> {
        let source = match self.get(name) {
            Some(skill) if is_valid_skill_name(name) => skill,
            _ => return Ok(None),
        };

        let new_name = self.unique_copy_name(name);
        let files = self.list_skill_files(name);
        self.upsert(
            &new_name,
            &source.description,
            &source.content,
            Some(files),
        )?;

        let mut state = self.state.lock().expect("skill registry poisoned");
        let Some(copy) = state.store.shift_remove(&new_name) else {
            return Ok(None);
        };

        // Re-insert directly after the original, preserving visible order.
        let mut next: IndexMap<String, Skill> = IndexMap::new();
        let mut inserted = false;
        for (key, value) in state.store.clone() {
            next.insert(key.clone(), value);
            if key == name {
                next.insert(new_name.clone(), copy.clone());
                inserted = true;
            }
        }
        if !inserted {
            next.insert(new_name.clone(), copy.clone());
        }
        state.store = next;

        Ok(Some(copy))
    }

    fn unique_copy_name(&self, base: &str) -> String {
        let mut candidate = format!("{base}-copy");
        let mut counter = 2;
        let state = self.state.lock().expect("skill registry poisoned");
        while state.store.contains_key(&candidate) {
            candidate = format!("{base}-copy-{counter}");
            counter += 1;
        }
        candidate
    }
}

/// `^[a-zA-Z0-9_-]+$`
pub fn is_valid_skill_name(name: &str) -> bool {
    !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Validate the supporting-file map; returns the first problem found.
pub fn validate_skill_files(files: &IndexMap<String, String>) -> Option<String> {
    if files.len() > MAX_FILES_PER_SKILL {
        return Some(format!(
            "too many supporting files (>{MAX_FILES_PER_SKILL})"
        ));
    }

    let mut total = 0usize;
    for (path, content) in files {
        if !is_safe_relative_path(path) {
            return Some(format!("unsafe supporting file path \"{path}\""));
        }
        let bytes = content.len();
        if bytes > MAX_FILE_BYTES {
            return Some(format!(
                "supporting file \"{path}\" too large (>{MAX_FILE_BYTES} bytes)"
            ));
        }
        total += bytes;
    }
    if total > MAX_TOTAL_BYTES {
        return Some(format!(
            "supporting files too large in total (>{MAX_TOTAL_BYTES} bytes)"
        ));
    }
    None
}

fn is_safe_relative_path(path: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return false;
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return false;
    }
    path.split('/').all(|segment| {
        !segment.is_empty() && segment != "." && segment != ".." && !segment.starts_with('.')
    })
}

fn join_relative(base: &Path, relative: &str) -> PathBuf {
    let mut path = base.to_path_buf();
    for segment in relative.split('/') {
        path.push(segment);
    }
    path
}

/// YAML double-quoted scalar (newlines collapse, quotes/backslashes escape).
fn yaml_quote(value: &str) -> String {
    let mut collapsed = String::with_capacity(value.len());
    let mut last_was_newline = false;
    for ch in value.chars() {
        if ch == '\r' || ch == '\n' {
            if !last_was_newline {
                collapsed.push(' ');
                last_was_newline = true;
            }
        } else {
            collapsed.push(ch);
            last_was_newline = false;
        }
    }
    format!(
        "\"{}\"",
        collapsed.replace('\\', "\\\\").replace('"', "\\\"")
    )
}

fn render_skill_markdown(name: &str, description: &str, body: &str) -> String {
    format!(
        "---\nname: {}\ndescription: {}\n---\n\n{}\n",
        yaml_quote(name),
        yaml_quote(description),
        body.trim()
    )
}

fn collect_files(dir: &Path, prefix: &str, out: &mut IndexMap<String, String>) {
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        if out.len() >= MAX_FILES_PER_SKILL {
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let relative = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}/{name}")
        };
        let full = dir.join(&name);

        match entry.file_type() {
            Ok(file_type) if file_type.is_dir() => collect_files(&full, &relative, out),
            Ok(file_type) if file_type.is_file() && relative != "SKILL.md" => {
                if let Ok(bytes) = std::fs::read(&full) {
                    out.insert(relative, String::from_utf8_lossy(&bytes).to_string());
                }
            }
            _ => {}
        }
    }
}

fn read_store(file: &Path) -> SkillsStore {
    match crate::paths::read_text(file) {
        Ok(raw) => match serde_json::from_str::<SkillsStore>(&raw) {
            Ok(store) => store,
            Err(error) => {
                tracing::error!("[Skill Registry] Failed to parse {}: {error}", file.display());
                SkillsStore::default()
            }
        },
        Err(_) => SkillsStore::default(),
    }
}

fn save_store(file: &Path, store: &SkillsStore) {
    let Some(parent) = file.parent() else {
        return;
    };
    if std::fs::create_dir_all(parent).is_err() {
        return;
    }
    let Ok(json) = serde_json::to_string_pretty(store) else {
        return;
    };
    let temp = file.with_extension("json.tmp");
    if std::fs::write(&temp, json).is_ok() {
        let _ = std::fs::rename(&temp, file);
    }
}

/// Helper for the route layer: JSON object of a skill plus `fileCount`.
pub fn skill_json(skill: &Skill, file_count: usize) -> Value {
    let mut value = serde_json::to_value(skill).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut value {
        map.insert("fileCount".to_string(), Value::from(file_count));
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_home(tag: &str) -> PathBuf {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("target")
            .join("test-tmp")
            .join(format!(
                "clover-registry-{tag}-{}",
                uuid::Uuid::new_v4().simple()
            ));
        std::fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    fn registry(home: &Path) -> SkillRegistry {
        let mut options = SkillRegistryOptions::new(home, home.join(".clover"));
        options.cwd = Some(home.to_path_buf());
        SkillRegistry::open(options)
    }

    #[test]
    fn writes_skill_markdown_with_front_matter() {
        let home = temp_home("upsert");
        let registry = registry(&home);

        registry
            .upsert(
                "review",
                "Checks \"code\"\nand more",
                "Body text",
                None,
            )
            .expect("upsert");

        let raw = std::fs::read_to_string(
            home.join(".clover")
                .join("skills")
                .join("review")
                .join("SKILL.md"),
        )
        .expect("read");
        assert!(raw.starts_with("---\nname: \"review\"\ndescription: \"Checks \\\"code\\\" and more\"\n---\n\nBody text\n"), "{raw}");

        let skill = registry.get("review").expect("visible immediately");
        assert_eq!(skill.source.as_deref(), Some(DIR_STORE_LABEL));
        assert!(registry.can_modify("review"));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn rejects_invalid_names_and_unsafe_files() {
        let home = temp_home("validation");
        let registry = registry(&home);

        assert!(registry.upsert("../escape", "", "", None).is_err());
        assert!(registry.upsert("bad name", "", "", None).is_err());

        let mut files = IndexMap::new();
        files.insert("../evil.txt".to_string(), "x".to_string());
        assert!(registry.upsert("ok", "", "", Some(files)).is_err());

        let mut many = IndexMap::new();
        for index in 0..(MAX_FILES_PER_SKILL + 1) {
            many.insert(format!("f{index}.txt"), "x".to_string());
        }
        assert!(validate_skill_files(&many).is_some());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn supporting_files_round_trip_and_duplicate() {
        let home = temp_home("duplicate");
        let registry = registry(&home);

        let mut files = IndexMap::new();
        files.insert("references/api.md".to_string(), "API".to_string());
        registry
            .upsert("review", "desc", "body", Some(files))
            .expect("upsert");

        assert_eq!(registry.file_count("review"), 1);
        let listed = registry.list_skill_files("review");
        assert_eq!(listed["references/api.md"], "API");

        let copy = registry.duplicate("review").expect("duplicate").expect("copy");
        assert_eq!(copy.name, "review-copy");
        assert_eq!(copy.content, "body");
        assert_eq!(registry.file_count("review-copy"), 1);

        // Inserted right after the original.
        let order: Vec<String> = registry.list().into_iter().map(|s| s.name).collect();
        assert_eq!(order, vec!["review".to_string(), "review-copy".to_string()]);

        let again = registry.duplicate("review").expect("duplicate").expect("copy");
        assert_eq!(again.name, "review-copy-2");

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn remove_deletes_the_directory_and_legacy_entry() {
        let home = temp_home("remove");
        std::fs::create_dir_all(home.join(".clover")).expect("state");
        std::fs::write(
            home.join(".clover").join("skills.json"),
            r#"{"skills":{"legacy":{"name":"legacy","description":"d","content":"c"}}}"#,
        )
        .expect("seed legacy");

        let registry = registry(&home);
        assert!(registry.get("legacy").is_some());

        registry
            .upsert("review", "d", "c", None)
            .expect("upsert");
        assert!(registry.remove("review"));
        assert!(registry.get("review").is_none());
        assert!(!home
            .join(".clover")
            .join("skills")
            .join("review")
            .exists());

        assert!(registry.remove("legacy"));
        let raw = std::fs::read_to_string(home.join(".clover").join("skills.json")).expect("read");
        let parsed: Value = serde_json::from_str(&raw).expect("json");
        assert!(parsed["skills"].get("legacy").is_none());

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn reload_picks_up_external_changes() {
        let home = temp_home("reload");
        let registry = registry(&home);
        assert!(registry.list().is_empty());

        let external = home
            .join(".claude")
            .join("skills")
            .join("external")
            .join("SKILL.md");
        std::fs::create_dir_all(external.parent().expect("parent")).expect("mkdir");
        std::fs::write(&external, "---\nname: External\n---\nbody").expect("write");

        let discovery = registry.reload().expect("discovery");
        assert!(discovery.skills.contains_key("external"));
        assert!(registry.get("external").is_some());
        // Discovered on disk ⇒ read-only.
        assert!(!registry.can_modify("external"));

        let _ = std::fs::remove_dir_all(&home);
    }
}