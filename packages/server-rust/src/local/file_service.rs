//! Filesystem service.
//!
//! Port of `packages/server/src/local/file-service.ts`. Every action returns
//! the `{ type: "file-service", success, data | message }` envelope, and the
//! HTTP layer answers `200` even for failures — exactly like the TS version
//! (only a missing `path` yields `400`).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::local::resolve::normalize;

/// Actions rejected while the server runs in read-only mode.
const WRITE_ACTIONS: [&str; 5] = [
    "writeFile",
    "deleteFile",
    "createFile",
    "createDir",
    "rename",
];

/// How long a single Windows drive probe may take.
const DRIVE_PROBE_TIMEOUT: Duration = Duration::from_millis(1000);

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRequest {
    pub action: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub new_name: Option<String>,
    #[serde(default)]
    pub depth: Option<i64>,
    #[serde(default)]
    pub ignore: Option<Vec<String>>,
    #[serde(default)]
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileResponse {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub success: bool,
    #[serde(rename = "requestId", skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl FileResponse {
    fn ok(data: Value) -> Self {
        Self {
            kind: "file-service",
            success: true,
            request_id: None,
            data: Some(data),
            message: None,
        }
    }

    fn failed(message: impl Into<String>) -> Self {
        Self {
            kind: "file-service",
            success: false,
            request_id: None,
            data: None,
            message: Some(message.into()),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct FileService {
    readonly: bool,
}

impl FileService {
    pub fn new(readonly: bool) -> Self {
        Self { readonly }
    }

    pub fn readonly(&self) -> bool {
        self.readonly
    }

    /// Never fails: errors travel inside the envelope, like the TS version.
    pub async fn handle(&self, request: FileRequest) -> FileResponse {
        let request_id = request.request_id.clone();
        let mut response = match self.execute(&request).await {
            Ok(data) => FileResponse::ok(data),
            Err(error) => FileResponse::failed(error.to_string()),
        };
        response.request_id = request_id;
        response
    }

    async fn execute(&self, request: &FileRequest) -> anyhow::Result<Value> {
        let action = request.action.as_str();

        if self.readonly && WRITE_ACTIONS.contains(&action) {
            anyhow::bail!("Server is running in read-only mode");
        }

        let path = request.path.as_str();
        match action {
            "listDir" => self.list_dir(path).await,
            "readFile" => self.read_file(path).await,
            "writeFile" => {
                self.write_file(path, request.content.as_deref().unwrap_or(""))
                    .await
            }
            "deleteFile" => self.delete_file(path).await,
            "createFile" => self.create_file(path).await,
            "createDir" => self.create_dir(path).await,
            "rename" => {
                let new_name = request
                    .new_name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .ok_or_else(|| anyhow::anyhow!("newName is required for rename"))?;
                self.rename(path, new_name).await
            }
            "stat" => self.stat(path).await,
            "exists" => Ok(json!({ "exists": self.exists(path).await })),
            "scan" => {
                let depth = request.depth.unwrap_or(1);
                let ignore = request.ignore.clone().unwrap_or_default();
                Self::scan(path, depth, ignore).await
            }
            "roots" => Self::roots().await,
            "openInFileExplorer" => self.open_in_file_explorer(path).await,
            other => anyhow::bail!("Unknown action: {other}"),
        }
    }

    // ------------------------------------------------------------------
    // Read operations
    // ------------------------------------------------------------------

    async fn list_dir(&self, dir_path: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(dir_path)?);
        let mut items = Vec::new();

        // `readdir` on a file reports ENOTDIR, on a missing path ENOENT; the
        // Windows OS messages differ, so name the operations like Node does.
        match tokio::fs::metadata(&resolved).await {
            Ok(metadata) if !metadata.is_dir() => {
                anyhow::bail!(
                    "ENOTDIR: not a directory, scandir '{}'",
                    resolved.display()
                );
            }
            Ok(_) => {}
            Err(error) => return Err(node_fs_error("scandir", &resolved, &error)),
        }

        let mut entries = tokio::fs::read_dir(&resolved)
            .await
            .map_err(|error| node_fs_error("scandir", &resolved, &error))?;
        while let Some(entry) = entries
            .next_entry()
            .await
            .map_err(|error| node_fs_error("scandir", &resolved, &error))?
        {
            let name = entry.file_name().to_string_lossy().to_string();
            let full_path = resolved.join(&name);
            let metadata = tokio::fs::metadata(&full_path).await.ok();

            items.push(json!({
                "name": name,
                "kind": if metadata.as_ref().is_some_and(|m| m.is_dir()) { "directory" } else { "file" },
                "size": metadata.as_ref().map(|m| m.len()).unwrap_or(0),
                "mtime": metadata
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(iso_millis),
            }));
        }

        items.sort_by(compare_entries);
        Ok(Value::Array(items))
    }

    async fn read_file(&self, file_path: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(file_path)?);
        let metadata = tokio::fs::metadata(&resolved)
            .await
            .map_err(|error| node_fs_error("open", &resolved, &error))?;
        if metadata.is_dir() {
            // Node's `fs.readFile` on a directory fails with EISDIR.
            anyhow::bail!("EISDIR: illegal operation on a directory, read");
        }
        let bytes = tokio::fs::read(&resolved)
            .await
            .map_err(|error| node_fs_error("open", &resolved, &error))?;
        Ok(json!({
            "content": String::from_utf8_lossy(&bytes),
            "size": metadata.len(),
            "contentType": "text/plain",
        }))
    }

    async fn stat(&self, file_path: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(file_path)?);
        let metadata = tokio::fs::metadata(&resolved)
            .await
            .map_err(|error| node_fs_error("stat", &resolved, &error))?;
        Ok(json!({
            "name": file_name_of(&resolved),
            "kind": if metadata.is_dir() { "directory" } else { "file" },
            "size": metadata.len(),
            "mtime": metadata.modified().ok().map(iso_millis),
        }))
    }

    async fn exists(&self, file_path: &str) -> bool {
        match std::path::absolute(file_path) {
            Ok(resolved) => normalize(&resolved).exists(),
            Err(_) => false,
        }
    }

    // ------------------------------------------------------------------
    // Write operations (read-only mode already rejected above)
    // ------------------------------------------------------------------

    async fn write_file(&self, file_path: &str, content: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(file_path)?);
        tokio::fs::write(&resolved, content)
            .await
            .map_err(|error| node_fs_error("open", &resolved, &error))?;
        let metadata = tokio::fs::metadata(&resolved)
            .await
            .map_err(|error| node_fs_error("stat", &resolved, &error))?;
        Ok(json!({ "size": metadata.len() }))
    }

    async fn delete_file(&self, file_path: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(file_path)?);
        let metadata = tokio::fs::metadata(&resolved).await;
        match metadata {
            Ok(meta) if meta.is_dir() => {
                if let Err(error) = tokio::fs::remove_dir_all(&resolved).await
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    return Err(node_fs_error("rm", &resolved, &error));
                }
            }
            _ => {
                if let Err(error) = tokio::fs::remove_file(&resolved).await
                    && error.kind() != std::io::ErrorKind::NotFound
                {
                    return Err(node_fs_error("rm", &resolved, &error));
                }
            }
        }
        Ok(json!({ "deleted": true }))
    }

    async fn create_file(&self, file_path: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(file_path)?);
        tokio::fs::write(&resolved, "")
            .await
            .map_err(|error| node_fs_error("open", &resolved, &error))?;
        Ok(json!({ "created": true }))
    }

    async fn create_dir(&self, dir_path: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(dir_path)?);
        tokio::fs::create_dir_all(&resolved)
            .await
            .map_err(|error| node_fs_error("mkdir", &resolved, &error))?;
        Ok(json!({ "created": true }))
    }

    async fn rename(&self, old_path: &str, new_name: &str) -> anyhow::Result<Value> {
        let resolved_old = normalize(&std::path::absolute(old_path)?);
        let dir = resolved_old
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        // `join` yields the absolute name as-is when `new_name` is absolute,
        // which is what `path.resolve(dir, newName)` does in Node.
        let resolved_new = normalize(&dir.join(new_name));
        tokio::fs::rename(&resolved_old, &resolved_new)
            .await
            .map_err(|error| rename_error(&resolved_old, &resolved_new, &error))?;
        Ok(json!({ "renamed": true, "newPath": resolved_new.to_string_lossy() }))
    }

    async fn open_in_file_explorer(&self, file_path: &str) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(file_path)?);
        let metadata = tokio::fs::metadata(&resolved).await.map_err(|_| {
            anyhow::anyhow!("Path does not exist: {}", resolved.to_string_lossy())
        })?;

        let is_dir = metadata.is_dir();
        let path = resolved.to_string_lossy().to_string();

        #[cfg(target_os = "windows")]
        {
            let mut command = tokio::process::Command::new("explorer.exe");
            if is_dir {
                command.arg(&path);
            } else {
                command.raw_arg(format!("/select,\"{path}\""));
            }
            command.spawn()?;
        }

        #[cfg(target_os = "macos")]
        {
            let mut command = tokio::process::Command::new("open");
            if !is_dir {
                command.arg("-R");
            }
            command.arg(&path).spawn()?;
        }

        #[cfg(all(unix, not(target_os = "macos")))]
        {
            let target = if is_dir {
                path.clone()
            } else {
                resolved
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or(path.clone())
            };
            tokio::process::Command::new("xdg-open")
                .arg(target)
                .spawn()?;
        }

        Ok(json!({ "opened": true, "path": path }))
    }

    // ------------------------------------------------------------------
    // Tree scan / roots
    // ------------------------------------------------------------------

    async fn scan(dir_path: &str, depth: i64, ignore: Vec<String>) -> anyhow::Result<Value> {
        let resolved = normalize(&std::path::absolute(dir_path)?);
        let ignore: HashSet<String> = ignore.into_iter().collect();

        // Directory walking is blocking: keep it off the async workers.
        let mut root = tokio::task::spawn_blocking(move || {
            scan_recursive(&resolved, depth, 0, &ignore)
        })
        .await?;

        root["platform"] = Value::String(node_platform().to_string());
        root["separator"] = Value::String(std::path::MAIN_SEPARATOR.to_string());
        if root["name"].as_str().unwrap_or_default().is_empty() {
            root["name"] = Value::String(root_label(root["absolutePath"].as_str().unwrap_or_default()));
        }
        Ok(root)
    }

    async fn roots() -> anyhow::Result<Value> {
        let mut roots: Vec<Value> = Vec::new();

        #[cfg(target_os = "windows")]
        {
            let mut probes = Vec::new();
            for letter in b'A'..=b'Z' {
                let letter = letter as char;
                let drive = format!("{letter}:\\");
                probes.push(tokio::spawn(async move {
                    let available = tokio::time::timeout(
                        DRIVE_PROBE_TIMEOUT,
                        tokio::fs::metadata(&drive),
                    )
                    .await
                    .map(|result| result.is_ok())
                    .unwrap_or(false);
                    available.then(|| json!({ "name": format!("{letter}:"), "path": drive }))
                }));
            }
            for probe in probes {
                if let Ok(Some(entry)) = probe.await {
                    roots.push(entry);
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            roots.push(json!({ "name": "/", "path": "/" }));
        }

        Ok(json!({
            "platform": node_platform(),
            "separator": std::path::MAIN_SEPARATOR.to_string(),
            "roots": roots,
        }))
    }
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

/// Recursive scan node, mirroring `scanRecursive` in the TS service.
fn scan_recursive(
    dir_path: &Path,
    max_depth: i64,
    current_depth: i64,
    ignore: &HashSet<String>,
) -> Value {
    let metadata = std::fs::metadata(dir_path).ok();
    let is_dir = metadata.as_ref().is_some_and(|m| m.is_dir());

    let mut node = json!({
        "name": file_name_of(dir_path),
        "kind": if is_dir { "directory" } else { "file" },
        "absolutePath": dir_path.to_string_lossy(),
    });

    if !is_dir || current_depth >= max_depth {
        return node;
    }

    let Ok(entries) = std::fs::read_dir(dir_path) else {
        return node;
    };

    let mut children: Vec<Value> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if ignore.contains(&name) {
            continue;
        }
        // Hidden entries are skipped, matching the TS scanner.
        if name.starts_with('.') && name != "." {
            continue;
        }
        children.push(scan_recursive(
            &dir_path.join(&name),
            max_depth,
            current_depth + 1,
            ignore,
        ));
    }

    children.sort_by(compare_nodes);
    node["children"] = Value::Array(children);
    node
}

/// Directories first, then case-insensitive name order.
fn compare_nodes(a: &Value, b: &Value) -> std::cmp::Ordering {
    let a_dir = a["kind"] == "directory";
    let b_dir = b["kind"] == "directory";
    match (a_dir, b_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => compare_names(
            a["name"].as_str().unwrap_or_default(),
            b["name"].as_str().unwrap_or_default(),
        ),
    }
}

fn compare_entries(a: &Value, b: &Value) -> std::cmp::Ordering {
    compare_nodes(a, b)
}

fn compare_names(a: &str, b: &str) -> std::cmp::Ordering {
    // `localeCompare` is locale-aware; a case-insensitive ordinal order is the
    // closest deterministic equivalent and keeps the tree stable.
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| a.cmp(b))
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// Node/`libuv` error code and text for an I/O failure.
fn errno(error: &std::io::Error) -> (&'static str, &'static str) {
    match error.kind() {
        std::io::ErrorKind::NotFound => ("ENOENT", "no such file or directory"),
        std::io::ErrorKind::PermissionDenied => ("EACCES", "permission denied"),
        std::io::ErrorKind::AlreadyExists => ("EEXIST", "file already exists"),
        std::io::ErrorKind::InvalidInput | std::io::ErrorKind::InvalidData => {
            ("EINVAL", "invalid argument")
        }
        std::io::ErrorKind::WouldBlock => ("EBUSY", "resource busy or locked"),
        _ => ("EIO", "i/o error"),
    }
}

/// `ENOENT: no such file or directory, open 'C:\…'` — the shape Node puts in
/// `LocalFileResponse.message`, so frontend toasts read the same on both
/// implementations (Windows' own message is localized).
fn node_fs_error(op: &str, path: &Path, error: &std::io::Error) -> anyhow::Error {
    let (code, text) = errno(error);
    anyhow::anyhow!("{code}: {text}, {op} '{}'", path.display())
}

/// `rename` names both paths, like Node: `ENOENT: … rename 'from' -> 'to'`.
fn rename_error(from: &Path, to: &Path, error: &std::io::Error) -> anyhow::Error {
    let (code, text) = errno(error);
    anyhow::anyhow!(
        "{code}: {text}, rename '{}' -> '{}'",
        from.display(),
        to.display()
    )
}

/// Label for a filesystem root (`C:` on Windows, `/` elsewhere).
fn root_label(absolute: &str) -> String {
    let bytes = absolute.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        return absolute[..2].to_string();
    }
    if cfg!(windows) {
        absolute.to_string()
    } else {
        "/".to_string()
    }
}

/// `process.platform` equivalents, so frontend branches keep working.
pub fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    }
}

/// `Date.prototype.toISOString()` equivalent: `2026-11-24T06:22:56.136Z`.
fn iso_millis(time: SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_millisecond_utc_timestamps() {
        let epoch = SystemTime::UNIX_EPOCH + Duration::from_millis(1_700_000_000_123);
        assert_eq!(iso_millis(epoch), "2023-11-14T22:13:20.123Z");
    }

    #[test]
    fn root_labels() {
        assert_eq!(root_label("C:\\"), "C:");
        assert_eq!(root_label("/"), "/");
    }

    #[tokio::test]
    async fn read_only_mode_rejects_writes() {
        let service = FileService::new(true);
        let response = service
            .handle(FileRequest {
                action: "writeFile".to_string(),
                path: "x.txt".to_string(),
                content: Some("hi".to_string()),
                ..Default::default()
            })
            .await;
        assert!(!response.success);
        assert_eq!(
            response.message.as_deref(),
            Some("Server is running in read-only mode")
        );
        assert_eq!(response.kind, "file-service");
    }
}