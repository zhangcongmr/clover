//! Skill data shapes (JSON-compatible with `packages/server/src/skills/types.ts`).

use indexmap::IndexMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub content: String,
    /// Display name: frontmatter `name` when present, else the id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    /// Source label (`store`, `~/.claude/skills`, catalog URL …).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Absolute entry file (`SKILL.md` / `<id>.md` / the legacy JSON file).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// `false` when frontmatter disables model auto-invocation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autoinvoke: Option<bool>,
}

/// Legacy `~/.clover/skills.json` shape.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SkillsStore {
    #[serde(default)]
    pub skills: IndexMap<String, Skill>,
}