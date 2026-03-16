# Claude Code Instructions

## Project

OpenClaw plugin for the memex skill/memory/rule router. Core engine lives in `@jim80net/memex-core`. Ships as an OpenClaw plugin (TypeScript, loaded at runtime).

## Development

```bash
pnpm install --ignore-scripts   # skip onnxruntime postinstall
pnpm test                       # run vitest
pnpm tsc --noEmit               # type check
pnpm check                      # lint + typecheck + test
```

## Architecture

- `@jim80net/memex-core` — Shared engine (separate repo): embeddings (ONNX + OpenAI), skill-index, cache, config, session, telemetry, traces, types
- `src/config.ts` — Extends `MemexCoreConfig` with openclaw-specific defaults and `resolveConfig()` for plugin config
- `src/router.ts` — Graduated disclosure logic: rules (full then reminder), memories (always full), skills (teaser only)
- `src/index.ts` — Plugin entry point: constructs core objects, defines openclaw-specific paths, registers hooks (before_prompt_build, before_tool_call, agent_end)
- `src/prompt-extractor.ts` — Strips OpenClaw/Discord envelope metadata for clean embedding input
- `test/` — Vitest tests for router and prompt-extractor

### Scan sources

| Source | Workspace path | Global path | Config path |
|--------|---------------|-------------|-------------|
| Skills | `<workspace>/skills/*/SKILL.md` | `~/.openclaw/workspace/skills/*/SKILL.md` | `config.skillDirs` |
| Memory | — | — | `config.memoryDirs` |

### Disclosure model

- **Rules**: full content on first match in session, one-liner reminder on subsequent matches
- **Skills/workflows**: description teaser only; agent reads the SKILL.md if it chooses to use it
- **Memory**: full content always (they're short)

### Cache paths

All openclaw-specific state lives under `~/.openclaw/cache/`:
- `skill-router.json` — embedding cache
- `skill-router-telemetry.json` — match telemetry
- `skill-router-traces/` — execution traces
- `models/` — ONNX model cache

## Conventions

- Core engine (`@jim80net/memex-core`) is a separate npm package — all shared types, embeddings, indexing, caching live there
- Tests mock `SkillIndex` methods to avoid filesystem/embedding side effects in router tests
- Prompt extractor tests use realistic OpenClaw/Discord envelope fixtures
- All openclaw-specific paths are centralized as constants in `src/index.ts`
