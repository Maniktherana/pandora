mod bridge;
mod claude;
mod codex;
mod constants;
mod cursor;
mod gemini;
mod hooks;
mod integration;
mod paths;
mod scripts;
mod types;

#[cfg(test)]
mod tests;

pub use bridge::start_agent_cli_bridge;
pub use integration::ensure_agent_cli_integration;
