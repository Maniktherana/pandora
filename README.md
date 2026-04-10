# Pandora ADE

## Prerequisites

- [Bun](https://bun.sh) (see root `packageManager` in `package.json` for the pinned version)
- [Rust](https://rustup.rs) stable
- Xcode Command Line Tools: `xcode-select --install`

## Running Pandora

```bash
git clone https://github.com/Maniktherana/pandora.git
cd pandora
bun install
bun run desktop:build
```

open the binary located in apps/desktop/src-tauri/target/release/bundle/dmg