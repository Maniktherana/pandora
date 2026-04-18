# Pandora ADE

<img width="1600" height="996" alt="Screenshot 2026-04-18 at 10 40 48 AM" src="https://github.com/user-attachments/assets/e5fe5a71-7fa2-4c5b-b674-b33fde6c317b" />
<img width="1589" height="982" alt="Screenshot 2026-04-18 at 10 50 41 AM" src="https://github.com/user-attachments/assets/3ee501fe-b00b-493e-95e7-583738a6cd0f" />

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
