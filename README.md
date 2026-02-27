# @openclaw/skill-router

An OpenClaw plugin that implements a vector-based skill router. On each agent turn, it embeds the user message, performs a vector similarity search against skill descriptions, and injects matched skill content into the prompt context.

## How it works

1. On startup (or when stale), the plugin scans `<workspace>/skills/*/SKILL.md` and `~/.openclaw/workspace/skills/*/SKILL.md` for skills with YAML frontmatter containing `name` and `description`.
2. Each skill's description is embedded using OpenAI's `text-embedding-3-small` model and stored in memory.
3. On each agent turn (`before_prompt_build` hook), the user's message is embedded and compared against all indexed skill embeddings using cosine similarity.
4. Skills scoring above the configured threshold are read and prepended to the prompt context.

## Installation

```bash
openclaw plugins install --link /path/to/openclaw-skill-router
openclaw plugins enable skill-router
openclaw config set plugins.entries.skill-router.config.enabled true
openclaw gateway restart
```

## Requirements

An OpenAI API key is required for embeddings. If you run OpenClaw as a gateway service (systemd), the key must be in OpenClaw's env config — shell environment variables are not inherited by the service:

```bash
openclaw config set env.vars.OPENAI_API_KEY "sk-..."
openclaw gateway restart
```

If you run the gateway directly in your shell, setting `OPENAI_API_KEY` in your environment is sufficient.

## Configuration

Add to your OpenClaw config under `plugins.entries.skill-router.config`:

| Key               | Default                   | Description                                           |
|-------------------|---------------------------|-------------------------------------------------------|
| `enabled`         | `false`                   | Enable the skill router                               |
| `topK`            | `3`                       | Maximum number of skills to inject per turn           |
| `threshold`       | `0.65`                    | Minimum cosine similarity score (0–1)                 |
| `embeddingModel`  | `text-embedding-3-small`  | OpenAI embedding model to use                         |
| `maxInjectedChars`| `8000`                    | Maximum total characters to inject per turn           |
| `cacheTimeMs`     | `300000`                  | How long (ms) to cache the skill index before rebuild |
| `skillDirs`       | _(none)_                  | Additional skill directories to scan                  |

## Skill format

Skills must have a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: weather
description: "Get current weather and forecasts for any location"
---
# Weather Skill

Instructions and context for the weather skill...
```

Place skills in either:
- `<workspace>/skills/<name>/SKILL.md` — per-workspace skills
- `~/.openclaw/workspace/skills/<name>/SKILL.md` — global managed skills

## Development

```bash
npm install
npm test          # Run tests with vitest
npm run typecheck # Type-check with tsc
```

## License

MIT
