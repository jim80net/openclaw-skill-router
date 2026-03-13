import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatter, SkillIndex } from "../src/skill-index.ts";
import { cosineSimilarity } from "../src/embeddings.ts";
import type { EmbeddingProvider } from "../src/embeddings.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

// Mock homedir to isolate from real ~/.openclaw/workspace/skills
vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => join(tmpdir(), "skill-router-fake-home"),
  };
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("extracts name and description from YAML frontmatter", () => {
    const content = `---
name: weather
description: Get current weather and forecasts
---
# Weather

Do stuff with weather.`;

    const { meta, body } = parseFrontmatter(content);

    expect(meta.name).toBe("weather");
    expect(meta.description).toBe("Get current weather and forecasts");
    expect(body).toContain("# Weather");
    expect(body).toContain("Do stuff with weather.");
  });

  it("returns raw content as body when no frontmatter exists", () => {
    const content = "Just some content without frontmatter";
    const { meta, body } = parseFrontmatter(content);

    expect(meta.name).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(body).toBe(content);
  });

  it("handles empty body after frontmatter", () => {
    const content = `---\nname: test\ndescription: A test\n---\n`;
    const { meta, body } = parseFrontmatter(content);

    expect(meta.name).toBe("test");
    expect(body.trim()).toBe("");
  });

  it("strips surrounding quotes from values", () => {
    const content = `---\nname: "quoted name"\ndescription: 'single quoted'\n---\nActual content here`;
    const { meta, body } = parseFrontmatter(content);

    expect(meta.name).toBe("quoted name");
    expect(meta.description).toBe("single quoted");
    expect(body).toBe("Actual content here");
    expect(body).not.toContain("---");
  });

  it("parses queries list from frontmatter", () => {
    const content = `---
name: weather
description: Get weather
queries:
  - "What is the weather today?"
  - "Show me the forecast"
  - "Is it going to rain?"
---
# Weather`;
    const { meta } = parseFrontmatter(content);
    expect(meta.queries).toHaveLength(3);
    expect(meta.queries?.[0]).toBe("What is the weather today?");
    expect(meta.queries?.[1]).toBe("Show me the forecast");
    expect(meta.queries?.[2]).toBe("Is it going to rain?");
  });

  it("returns no queries when queries block is absent", () => {
    const content = `---\nname: simple\ndescription: A skill\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.queries).toBeUndefined();
  });

  it("parses type field", () => {
    const content = `---\nname: pnpm-rule\ndescription: Use pnpm\ntype: rule\n---\nAlways use pnpm.`;
    const { meta } = parseFrontmatter(content);
    expect(meta.type).toBe("rule");
  });

  it("parses one-liner field", () => {
    const content = `---\nname: pnpm-rule\ndescription: Use pnpm\ntype: rule\none-liner: Use pnpm, not npm.\n---\nFull body.`;
    const { meta } = parseFrontmatter(content);
    expect(meta.oneLiner).toBe("Use pnpm, not npm.");
  });

  it("defaults type to undefined (caller defaults to skill)", () => {
    const content = `---\nname: test\ndescription: Test skill\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.type).toBeUndefined();
  });

  it("parses paths list from frontmatter", () => {
    const content = `---
name: test
description: Test
paths:
  - "src/**/*.ts"
  - "package.json"
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.paths).toEqual(["src/**/*.ts", "package.json"]);
  });

  it("parses hooks list from frontmatter", () => {
    const content = `---
name: test
description: Test
hooks:
  - UserPromptSubmit
  - PreToolUse
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.hooks).toEqual(["UserPromptSubmit", "PreToolUse"]);
  });

  it("parses keywords list from frontmatter", () => {
    const content = `---
name: test
description: Test
keywords:
  - pnpm
  - "package manager"
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.keywords).toEqual(["pnpm", "package manager"]);
  });
});

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("returns 0 for empty vectors", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
  });

  it("handles non-unit vectors", () => {
    const sim = cosineSimilarity([3, 4], [6, 8]);
    expect(sim).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// SkillIndex
// ---------------------------------------------------------------------------

describe("SkillIndex", () => {
  let workspaceDir: string;

  // Mock embedding provider
  function makeMockProvider(embedFn?: (texts: string[]) => Promise<number[][]>): EmbeddingProvider {
    return {
      embed: embedFn ?? vi.fn(async (texts: string[]) => {
        // Return distinct unit vectors: skill i -> [0,...,1,...,0] at position i%4
        return texts.map((_, i) =>
          Array.from({ length: 4 }, (__, j) => (j === i % 4 ? 1 : 0))
        );
      }),
    };
  }

  beforeEach(async () => {
    workspaceDir = join(tmpdir(), `skill-router-test-${Date.now()}`);
    await mkdir(join(workspaceDir, "skills", "weather"), { recursive: true });
    await mkdir(join(workspaceDir, "skills", "git"), { recursive: true });

    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get current weather and forecasts\n---\n# Weather\n\nFetch weather data.`
    );
    await writeFile(
      join(workspaceDir, "skills", "git", "SKILL.md"),
      `---\nname: git\ndescription: Git version control operations\n---\n# Git\n\nGit commands.`
    );
  });

  afterEach(async () => {
    try {
      await rm(workspaceDir, { recursive: true, force: true });
    } catch {
      // cleanup
    }
  });

  it("builds an index from workspace skills", async () => {
    const provider = makeMockProvider();
    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, provider);
    await index.build(workspaceDir);

    expect(index.skillCount).toBe(2);
    expect(provider.embed).toHaveBeenCalledTimes(1);
  });

  it("uses frontmatter queries when present", async () => {
    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get weather\nqueries:\n  - "What is the weather?"\n  - "Will it rain?"\n  - "Temperature today"\n---\n# Weather`
    );
    const provider = makeMockProvider();
    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, provider);
    await index.build(workspaceDir);

    expect(index.skillCount).toBe(2);
    // 3 queries for weather + 1 description fallback for git = 4
    const calls = (provider.embed as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toHaveLength(4);
  });

  it("parses type from frontmatter and filters by type", async () => {
    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: pnpm-rule\ndescription: Use pnpm\ntype: rule\none-liner: Use pnpm, not npm.\n---\nAlways use pnpm.`
    );
    // weather(rule) + git(skill) = 2 skills, 2 descriptions
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]]) // build
        .mockResolvedValueOnce([[1, 0, 0, 0]]), // search — matches the rule
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("pnpm", 3, 0, ["rule"]);
    expect(results).toHaveLength(1);
    expect(results[0].skill.type).toBe("rule");
    expect(results[0].skill.oneLiner).toBe("Use pnpm, not npm.");
  });

  it("needsRebuild returns true before first build", () => {
    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, makeMockProvider());
    expect(index.needsRebuild()).toBe(true);
  });

  it("needsRebuild returns false immediately after build", async () => {
    const index = new SkillIndex(
      { ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 60_000 },
      makeMockProvider()
    );
    await index.build(workspaceDir);
    expect(index.needsRebuild()).toBe(false);
  });

  it("needsRebuild returns true after cacheTimeMs elapses", async () => {
    const index = new SkillIndex(
      { ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 0 },
      makeMockProvider()
    );
    await index.build(workspaceDir);
    expect(index.needsRebuild()).toBe(true);
  });

  it("second build is a no-op when files unchanged", async () => {
    const provider = makeMockProvider();
    const index = new SkillIndex(
      { ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 60_000 },
      provider
    );
    await index.build(workspaceDir);
    await index.build(workspaceDir);

    expect(provider.embed).toHaveBeenCalledTimes(1);
    expect(index.skillCount).toBe(2);
  });

  it("search returns results above threshold", async () => {
    // Build: 2 skills get embeddings [1,0,0,0] and [0,1,0,0]
    const provider = makeMockProvider();
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]]) // build
        .mockResolvedValueOnce([[1, 0, 0, 0]]), // search — matches skill 0
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("weather", 3, 0.65);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("search filters results below threshold", async () => {
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]])
        .mockResolvedValueOnce([[1, 0, 0, 0]]),
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("weather", 3, 0.65);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("search returns skills sorted by score descending", async () => {
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]])
        .mockResolvedValueOnce([[0.8, 0.2, 0, 0]]),
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("mixed", 3, 0.0);
    expect(results.length).toBe(2);
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("search respects topK limit", async () => {
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]])
        .mockResolvedValueOnce([[1, 1, 0, 0]]),
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("both", 1, 0.0);
    expect(results).toHaveLength(1);
  });

  it("search uses max scoring (not avg)", async () => {
    // Skill has 2 query embeddings: [1,0,0,0] and [0,0,0,1]
    // Query is [1,0,0,0] → similarities are 1.0 and 0.0
    // Max should give 1.0, avg would give 0.5
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 0, 0, 1]]) // build: 2 query embeddings for 1 skill
        .mockResolvedValueOnce([[1, 0, 0, 0]]), // search
    };

    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get weather\nqueries:\n  - "What is the weather?"\n  - "Temperature"\n---\n# Weather`
    );
    // Remove git skill to have exactly 1 skill with 2 queries
    await rm(join(workspaceDir, "skills", "git"), { recursive: true, force: true });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("weather", 3, 0.0);
    expect(results).toHaveLength(1);
    // Max scoring: should be 1.0 (not 0.5 which avg would give)
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("search filters by type", async () => {
    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather-mem\ndescription: Weather memory\ntype: memory\n---\nI like rain.`
    );
    // git stays as default type (skill)

    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]])
        .mockResolvedValueOnce([[1, 1, 0, 0]]), // matches both
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("test", 3, 0.0, ["memory"]);
    expect(results).toHaveLength(1);
    expect(results[0].skill.type).toBe("memory");
  });

  it("returns empty for search with no matching type", async () => {
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]]),
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("test", 3, 0.0, ["rule"]);
    expect(results).toHaveLength(0);
  });

  it("handles workspace with no skills directory gracefully", async () => {
    const emptyDir = join(tmpdir(), `empty-workspace-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, makeMockProvider());
    await index.build(emptyDir);

    expect(index.skillCount).toBe(0);

    await rm(emptyDir, { recursive: true, force: true });
  });

  it("readSkillContent returns body without frontmatter", async () => {
    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, makeMockProvider());
    await index.build(workspaceDir);

    const content = await index.readSkillContent(
      join(workspaceDir, "skills", "weather", "SKILL.md")
    );
    expect(content).toContain("# Weather");
    expect(content).not.toContain("---");
  });

  it("skips skills with missing name or description", async () => {
    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\n---\n# Missing description`
    );

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, makeMockProvider());
    await index.build(workspaceDir);

    expect(index.skillCount).toBe(1); // Only git
  });

  // ---------------------------------------------------------------------------
  // Relative scoring mode
  // ---------------------------------------------------------------------------

  it("relative mode: injects top-K when best score clears floor", async () => {
    // Two skills: embeddings [1,0,0,0] and [0.9,0.1,0,0]
    // Query [1,0,0,0] → scores ~1.0 and ~0.9 — both within maxDropoff=0.15
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0.9, 0.1, 0, 0]]) // build
        .mockResolvedValueOnce([[1, 0, 0, 0]]), // search
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("test", 3, 0.30, undefined, "relative", 0.15);
    expect(results).toHaveLength(2);
  });

  it("relative mode: returns nothing when best score below floor", async () => {
    // Two skills: embeddings [1,0,0,0] and [0,1,0,0]
    // Query [0,0,1,0] → scores 0.0 and 0.0 — below floor
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]]) // build
        .mockResolvedValueOnce([[0, 0, 1, 0]]), // search — orthogonal
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("test", 3, 0.30, undefined, "relative", 0.15);
    expect(results).toHaveLength(0);
  });

  it("relative mode: drops results beyond maxDropoff from best", async () => {
    // Two skills: embeddings [1,0,0,0] and [0,1,0,0]
    // Query [0.95,0.05,0,0] → score ~0.998 for skill 0, ~0.05 for skill 1
    // maxDropoff=0.15 → skill 1 drops (gap ~0.95)
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0, 1, 0, 0]]) // build
        .mockResolvedValueOnce([[0.95, 0.05, 0, 0]]), // search
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("test", 3, 0.30, undefined, "relative", 0.15);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeGreaterThan(0.9);
  });

  it("relative mode: respects topK limit", async () => {
    const searchProvider: EmbeddingProvider = {
      embed: vi.fn()
        .mockResolvedValueOnce([[1, 0, 0, 0], [0.95, 0.05, 0, 0]]) // build — close scores
        .mockResolvedValueOnce([[1, 0, 0, 0]]), // search
    };

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, searchProvider);
    await index.build(workspaceDir);

    const results = await index.search("test", 1, 0.30, undefined, "relative", 0.15);
    expect(results).toHaveLength(1);
  });
});
