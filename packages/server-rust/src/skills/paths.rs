//! Path resolution for skill sources.
//!
//! Follows the OpenCode sources rule: `~/…` is relative to the user home,
//! absolute paths are used as-is, everything else resolves against the active
//! working directory (not the config file that mentioned it).

use std::path::{Path, PathBuf};

use crate::local::resolve::{is_path_inside, resolve_path};

pub fn resolve_user_path(input: &str, cwd: &Path, home: &Path) -> PathBuf {
    if input == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = input.strip_prefix("~/").or_else(|| input.strip_prefix("~\\")) {
        return home.join(rest);
    }
    if Path::new(input).is_absolute() {
        PathBuf::from(input)
    } else {
        cwd.join(input)
    }
}

pub fn directory_exists(dir: &Path) -> bool {
    dir.is_dir()
}

/// Guard against writing outside the skill root (kept for the registry).
pub fn inside(base: &Path, target: &Path) -> bool {
    is_path_inside(&base.to_string_lossy(), &target.to_string_lossy())
}

/// Normalised absolute form used when de-duplicating sources.
pub fn canonical_key(path: &Path) -> String {
    let resolved = resolve_path(&path.to_string_lossy());
    let text = resolved.to_string_lossy().to_string();
    if cfg!(windows) {
        text.to_lowercase()
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_tilde_and_relative_paths() {
        let home = PathBuf::from(if cfg!(windows) { r"C:\Users\t" } else { "/home/t" });
        let cwd = PathBuf::from(if cfg!(windows) { r"C:\work" } else { "/work" });

        assert_eq!(resolve_user_path("~", &cwd, &home), home);
        assert_eq!(resolve_user_path("~/x", &cwd, &home), home.join("x"));
        assert_eq!(resolve_user_path("./rel", &cwd, &home), cwd.join("./rel"));
    }
}