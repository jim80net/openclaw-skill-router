# @openclaw/skill-router

**Teach your agent new tricks — without rewriting prompts.**

The skill router is an [OpenClaw](https://github.com/General-ML/openclaw) plugin that gives your agent a long-term knowledge base. Write skills as plain Markdown files, drop them in a folder, and the router automatically surfaces the right ones each turn using vector similarity.

No prompt engineering. No manual tool wiring. Just write what the agent should know, and the router handles the rest.

## How it works

```
User message ──→ embed ──→ cosine search ──→ inject top matches into prompt
```

1. **Index** — On startup, the plugin scans your skill directories for `SKILL.md` files. Each skill's description is embedded into a vector and cached to disk.
2. **Match** — On every agent turn, the user's message is embedded and compared against the index. Skills above a similarity threshold are selected.
3. **Inject** — Matched skills are prepended to the prompt context so the agent can act on them immediately.

The plugin also hooks into `before_tool_call` to inject tool-specific guidance, and `agent_end` to capture execution traces for later analysis.

## Quick start

```bash
# Install and enable
openclaw plugins install --link /path/to/openclaw-skill-router
openclaw plugins enable skill-router
openclaw config set plugins.entries.skill-router.config.enabled true
openclaw gateway restart
```

By default, the router uses **local ONNX embeddings** (via `@huggingface/transformers`) — no API key needed, zero cost.

To use OpenAI embeddings instead:

```bash
openclaw config set plugins.entries.skill-router.config.embeddingBackend openai
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
queries:             # extra embedding vectors for better matching
  - "what's the weather like"
  - "check the forecast for tomorrow"
---
```

## Configuration

All settings live under `plugins.entries.skill-router.config` in your OpenClaw config:

| Key | Default | Description |
|---|---|---|
| `enabled` | `false` | Master switch |
| `topK` | `3` | Max skills injected per turn |
| `threshold` | `0.55` | Min cosine similarity (0–1) |
| `embeddingBackend` | `"local"` | `"local"` (ONNX, free) or `"openai"` |
| `embeddingModel` | `"Xenova/all-MiniLM-L6-v2"` | Model name (local) or OpenAI model ID |
| `maxInjectedChars` | `8000` | Character budget per turn |
| `cacheTimeMs` | `300000` | Index rebuild interval (ms) |
| `skillDirs` | — | Additional directories to scan |
| `types` | all | Knowledge types to route |

## Features

- **Zero-cost by default** — Local ONNX embeddings, no API calls needed
- **Persistent cache** — Embeddings are cached to disk keyed by model + file mtime; survives restarts
- **Graduated disclosure** — Rules show full text on first exposure, then brief reminders
- **Tool guidance** — Hooks into `before_tool_call` to inject tool-specific instructions
- **Execution traces** — Captures which skills fired and what tools were called for offline analysis
- **Multi-query matching** — Skills can define multiple query vectors for broader recall
- **Prompt extraction** — Strips OpenClaw envelope metadata to match on actual user intent

## Development

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
```

## License

MIT
