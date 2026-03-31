#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
mod macos;
#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub use macos::*;

#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
mod stub;
#[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
pub use stub::*;
