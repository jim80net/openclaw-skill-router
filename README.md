# @jim80net/memex-openclaw

Semantic skill, memory, and rule router for [OpenClaw](https://github.com/General-ML/openclaw). Injects relevant knowledge into your agent's session based on what it's actually working on, instead of loading everything at once.

Built on [`@jim80net/memex-core`](https://github.com/jim80net/memex-core) — the shared engine for embedding, indexing, and searching knowledge artifacts.

## Why this exists

AI coding assistants are essentially paint-by-number systems. You start with a canvas (the model) and a system prompt (the outline of the picture). Then you add your own directives — skills, memories, rules — which are like adding more lines to the coloring book before you begin.

This works well at first. But as you accumulate knowledge — git workflows, ticket tracking conventions, deployment procedures, coding standards, domain-specific patterns — the coloring page gets crowded. Every session starts with *all* of this context loaded, whether it's relevant or not. The LLM's attention is split across git rules when you're debugging CSS, and deployment procedures when you're writing tests. Performance degrades as the corpus grows.

The solution is **gradual disclosure**: start with universal principles only, then bring in additional directives at the point of consumption, when the conversation actually turns toward those specific tasks. When you need to trade a ticker, the relevant know-how appears. When you're deploying, the deployment checklist surfaces. When you're just writing code, nothing extra clutters the context.

This is what memex-openclaw does. As skills, memories, and rules are created, they are embedded for semantic retrieval. Each type has a disclosure pattern suited to its nature:

- **Skills** — large procedural checklists — are gradually disclosed: a description teaser first, then the full `SKILL.md` when the agent chooses to use it.
- **Memories** — generally small preferences and facts — are disclosed in full at the moment they become relevant.
- **Rules** — important guidelines — are disclosed in full when first relevant, then reduced to one-line reminders on subsequent matches, keeping them present without dominating the context.

The result is a system that drives the conversation according to the task at hand. Performance stays consistent even as learnings amass, because the context window carries only what's needed right now.

## How it works

```
User message ──→ embed ──→ cosine search ──→ inject top matches into prompt
```

1. **Index** — On startup, the plugin scans your skill directories for `SKILL.md` files and memory directories for `.md` files. Each entry's description is embedded into a vector and cached to disk.
2. **Match** — On every agent turn, the user's message is embedded and compared against the index. Entries above a similarity threshold are selected.
3. **Inject** — Matched entries are prepended to the prompt context so the agent can act on them immediately.

The plugin also hooks into `before_tool_call` to inject tool-specific guidance, and `agent_end` to capture execution traces for later analysis.

## Quick start

```bash
# Install and enable
openclaw plugins install --link /path/to/memex-openclaw
openclaw plugins enable memex-openclaw
openclaw config set plugins.entries.memex-openclaw.config.enabled true
openclaw gateway restart
```

By default, the router uses **local ONNX embeddings** (via `@huggingface/transformers`) — no API key needed, zero cost.

To use OpenAI embeddings instead:

```bash
openclaw config set plugins.entries.memex-openclaw.config.embeddingBackend openai
openclaw config set env.vars.OPENAI_API_KEY "sk-..."
openclaw gateway restart
```

> **Note:** If you run OpenClaw as a systemd service, shell environment variables aren't inherited. Set API keys via `openclaw config set env.vars.*` instead.

## Writing skills

A skill is a folder containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: weather
description: "Get current weather and forecasts for any location"
---
# Weather Skill

You can check the weather using the `get_weather` tool.
Always include the location and whether the user wants Celsius or Fahrenheit.
```

Place skill folders in either location:

| Location | Scope |
|---|---|
| `<workspace>/skills/<name>/SKILL.md` | Per-workspace |
| `~/.openclaw/workspace/skills/<name>/SKILL.md` | Global (all workspaces) |

### Optional frontmatter fields

```yaml
---
name: weather
description: "Get current weather and forecasts for any location"
type: skill          # skill | rule | memory | workflow | session-learning
one-liner: "Weather lookup guidance"   # shown on repeat exposure (rules)
boost: 0.05          # optional float added to similarity score before threshold comparison
queries:             # extra embedding vectors for better matching
  - "what's the weather like"
  - "check the forecast for tomorrow"
---
```

## Multi-agent shared memory

In multi-agent deployments, each agent has its own workspace with local skills and memories. But some knowledge is cross-cutting — market regime changes, macro events, portfolio-wide decisions, active theories. These are **memes** in the original Dawkins sense: units of cultural information that propagate across agents.

The shared memory pattern uses the filesystem as the access control boundary:

```
~/.openclaw/
  workspace/memory/          ← main agent's private memory
  workspace-research/memory/ ← research agent's private memory
  workspace-grandma/memory/  ← grandma's private memory (account numbers stay here)
  shared/                    ← global knowledge (all agents read + write)
```

Configure `memoryDirs` to include both local and shared paths:

```json
{
  "plugins": {
    "entries": {
      "memex-openclaw": {
        "config": {
          "memoryDirs": ["/home/you/.openclaw/shared"]
        }
      }
    }
  }
}
```

Every agent with memex enabled will index and search the shared directory alongside their workspace skills. The key properties:

- **Local by default, shared by address.** Writing to `memory/foo.md` is local. Writing to `~/.openclaw/shared/` requires a deliberate path. You don't accidentally publish.
- **No classification needed.** The directory topology _is_ the access control. Private data stays in workspace-local memory. No rules engine, no content filter, no "is this sensitive?" heuristic.
- **Decoupled in time.** Agent A writes a fact. Agent B finds it via semantic search whenever it becomes relevant — minutes, hours, or days later. No synchronous coordination required.
- **Same index, same search.** Shared entries are just memory entries with a different origin. The embedding/search/inject pipeline doesn't change.

### What belongs in shared

- Market regime state (risk-on/off, volatility regime)
- Macro events affecting multiple agents
- Portfolio-wide decisions ("all flat, no new positions")
- Active high-confidence theories from world models
- Cross-cutting operational decisions

### What stays local

- Account numbers, credentials, personal info
- Agent-specific operational state
- Work in progress
- Anything only one agent needs

## Configuration

All settings live under `plugins.entries.memex-openclaw.config` in your OpenClaw config:

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Master switch |
| `topK` | `3` | Max skills injected per turn |
| `threshold` | `0.35` | Floor score — best match must clear this (0–1) |
| `scoringMode` | `"relative"` | `"relative"` or `"absolute"` scoring |
| `maxDropoff` | `0.1` | In relative mode, drop results scoring too far below the best |
| `embeddingBackend` | `"local"` | `"local"` (ONNX, free) or `"openai"` |
| `embeddingModel` | `"Xenova/all-MiniLM-L6-v2"` | Model name (local) or OpenAI model ID |
| `maxInjectedChars` | `8000` | Character budget per turn |
| `cacheTimeMs` | `300000` | Index rebuild interval (ms) |
| `skillDirs` | `[]` | Additional directories to scan for skills |
| `memoryDirs` | `[]` | Directories to scan for memory `.md` files |
| `types` | all | Knowledge types to route |

## Architecture

- **`@jim80net/memex-core`** — Shared engine: embeddings (ONNX + OpenAI), skill index, cache, session tracking, telemetry, traces
- **`src/config.ts`** — OpenClaw-specific config resolution extending `MemexCoreConfig`
- **`src/router.ts`** — Graduated disclosure logic (rules, memories, skills)
- **`src/index.ts`** — Plugin entry point: constructs core objects, registers hooks
- **`src/prompt-extractor.ts`** — Strips OpenClaw/Discord envelope metadata

## Features

- **Zero-cost by default** — Local ONNX embeddings, no API calls needed
- **Shared core** — Same engine as [memex-claude](https://github.com/jim80net/memex-claude), published as `@jim80net/memex-core`
- **Persistent cache** — Embeddings are cached to disk keyed by model + file mtime; survives restarts
- **Graduated disclosure** — Rules show full text on first exposure, then brief reminders
- **Tool guidance** — Hooks into `before_tool_call` to inject tool-specific instructions
- **Execution traces** — Captures which skills fired and what tools were called for offline analysis
- **Multi-query matching** — Skills can define multiple query vectors for broader recall
- **Prompt extraction** — Strips OpenClaw envelope metadata to match on actual user intent
- **Heartbeat detection** — `isHeartbeatPrompt()` identifies and skips heartbeat prompts so the router avoids telemetry noise from keep-alive messages
- **Query-attributed telemetry** — Telemetry tracks per-query hit counts (`queryHits`) and only records actually injected results, not all search candidates

## Development

```bash
pnpm install          # see note below if onnxruntime postinstall fails
pnpm test             # vitest
pnpm run typecheck    # tsc --noEmit
pnpm check            # lint + typecheck + test
```

> **Note:** If `pnpm install` fails due to `onnxruntime-node` CUDA postinstall errors, run `pnpm install --ignore-scripts` instead. The ONNX runtime is only needed at plugin runtime, not for development.

## License

MIT
