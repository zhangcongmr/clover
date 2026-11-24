//! Path helpers.
//!
//! `Node`'s `path.resolve` makes a path absolute against the process working
//! directory and normalises `.` / `..` lexically, without touching the
//! filesystem (no symlink resolution). `std::path::absolute` does the first
//! half only, so the lexical pass is added here.

use std::path::{Component, Path, PathBuf};

/// Absolute, lexically normalised path.
pub fn resolve_path(input: &str) -> PathBuf {
    let abs = std::path::absolute(input).unwrap_or_else(|_| PathBuf::from(input));
    normalize(&abs)
}

/// Remove `.` components and fold `..` into the preceding component.
pub fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                let can_pop = matches!(
                    out.components().next_back(),
                    Some(Component::Normal(_))
                );
                if can_pop {
                    out.pop();
                } else if !path.is_absolute() {
                    out.push("..");
                }
            }
            other => out.push(other.as_os_str()),
        }
    }
    if out.as_os_str().is_empty() {
        out.push(".");
    }
    out
}

/// True when `target` is `base` itself or sits below it.
///
/// Ported from the TS `isPathInside`; unused by the HTTP layer there too, but
/// kept for the batches that need a sandbox (agent install, skills store).
pub fn is_path_inside(base: &str, target: &str) -> bool {
    let base = resolve_path(base);
    let target = resolve_path(target);
    target.starts_with(&base)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_dot_segments() {
        assert_eq!(normalize(Path::new("/a/./b/../c")), PathBuf::from("/a/c"));
    }

    #[test]
    fn resolves_relative_against_cwd() {
        let resolved = resolve_path(".");
        assert!(resolved.is_absolute());
    }

    #[test]
    fn detects_descendants() {
        let base = if cfg!(windows) { r"C:\tmp" } else { "/tmp" };
        assert!(is_path_inside(base, base));
        assert!(is_path_inside(
            base,
            &format!("{base}{}child", std::path::MAIN_SEPARATOR)
        ));
        assert!(!is_path_inside(base, &format!("{base}2")));
    }
}