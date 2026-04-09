use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

use super::constants::AGENT_SOCKET_NAME;

pub(super) fn pandora_home() -> PathBuf {
    PathBuf::from(crate::git::pandora_home())
}

pub(super) fn user_home() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/tmp"))
}

pub(super) fn agent_socket_path() -> PathBuf {
    pandora_home().join(AGENT_SOCKET_NAME)
}

pub(super) fn scripts_dir() -> PathBuf {
    pandora_home().join("bin")
}

pub(super) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

pub(super) fn write_executable(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, contents).map_err(|error| error.to_string())?;
    let mut perms = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .permissions();
    perms.set_mode(0o755);
    fs::set_permissions(path, perms).map_err(|error| error.to_string())
}
