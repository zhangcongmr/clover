//! Skill catalog: discovery across user-level sources + writable directory
//! store, exposed through `/api/skills`.

pub mod config;
pub mod discovery;
pub mod paths;
pub mod registry;
pub mod types;

pub use registry::{is_valid_skill_name, validate_skill_files, SkillRegistry, SkillRegistryOptions};
pub use types::{Skill, SkillsStore};