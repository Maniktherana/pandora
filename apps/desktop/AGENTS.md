# AGENTS.md

Instructions for AI coding agents working with this codebase.

<!-- opensrc:start -->

## Source Code Reference

Source code for dependencies is available in `opensrc/` for deeper understanding of implementation details.

See `opensrc/sources.json` for the list of available packages and their versions.

Use this source code when you need to understand how a package works internally, not just its types/interface.

### Fetching Additional Source Code

To fetch source code for a package or repository you need to understand, run:

```bash
npx opensrc <package>           # npm package (e.g., npx opensrc zod)
npx opensrc pypi:<package>      # Python package (e.g., npx opensrc pypi:requests)
npx opensrc crates:<package>    # Rust crate (e.g., npx opensrc crates:serde)
npx opensrc <owner>/<repo>      # GitHub repo (e.g., npx opensrc vercel/ai)
```

<!-- opensrc:end -->

## Styling Conventions

- When composing conditional Tailwind classes with `cn(...)`, keep class strings inline and prefer object syntax: `cn("base", { "class-a": condition, "class-b": otherCondition })`.
- Avoid nested ternaries inside `cn(...)` class arguments.
- Avoid extracting `cn(...)` class constants unless reused across multiple elements; prefer keeping class conditions local to the component JSX.

## Component Conventions

- Keep layout UI under `src/components/layout/` and organize by feature area, using shallow feature folders with optional nested sub-features when a feature grows.
- Use `kebab-case` for file names and `CamelCase` for React component names.
- Prefer one primary component per file. If a file grows to multiple substantial components, split them into separate files.
- Distinguish tab item vs tab bar/container:
  - tab item components live in `*-tab.tsx`
  - tab bar/list containers live in `*-tab-bar.tsx` or feature-specific container files.
- Keep shared feature-local types/constants in nearby `*.types.ts` / `*.utils.ts` files.
- If a prop type is used by only one component, keep it in that component file.
- If a type is shared across multiple files in a feature, keep it in that feature's `*.types.ts`.
- Avoid large inline JSX handlers; prefer named handlers (`handle*`) inside the component.
