import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseFrontmatter, SkillIndex } from "../src/skill-index.ts";
import { cosineSimilarity } from "../src/embeddings.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

// Mock homedir so tests don't accidentally pick up real skills from ~/.openclaw
vi.mock("node:os", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:os")>();
  return { ...original, homedir: () => join(tmpdir(), "fake-test-home") };
});

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("parses name and description from frontmatter", () => {
    const content = `---
name: weather
description: "Get current weather and forecasts"
---
# Weather Skill

Do stuff with weather.`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBe("weather");
    expect(meta.description).toBe("Get current weather and forecasts");
    expect(body).toContain("# Weather Skill");
  });

  it("handles single-quoted values", () => {
    const content = `---\nname: 'my-skill'\ndescription: 'A skill'\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.name).toBe("my-skill");
    expect(meta.description).toBe("A skill");
  });

  it("handles unquoted values", () => {
    const content = `---\nname: simple\ndescription: plain description\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.name).toBe("simple");
    expect(meta.description).toBe("plain description");
  });

  it("returns empty meta when no frontmatter present", () => {
    const content = "# Just a heading\n\nSome content.";
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(body).toBe(content);
  });

  it("strips frontmatter from body", () => {
    const content = `---\nname: test\ndescription: desc\n---\nActual content here`;
    const { body } = parseFrontmatter(content);
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
});

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0];
    const b = [-1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("correctly scores similar vectors", () => {
    const a = [0.8, 0.6];
    const b = [0.6, 0.8];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.9);
    expect(sim).toBeLessThan(1.0);
  });
});

// ---------------------------------------------------------------------------
// SkillIndex build + search (mocked embeddings API)
// ---------------------------------------------------------------------------

describe("SkillIndex", () => {
  let workspaceDir: string;

  const mockFetch = vi.fn();

  beforeEach(async () => {
    workspaceDir = join(tmpdir(), `skill-index-test-${Date.now()}`);
    await mkdir(join(workspaceDir, "skills", "weather"), { recursive: true });
    await mkdir(join(workspaceDir, "skills", "git"), { recursive: true });

    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get current weather and forecasts\n---\n# Weather\n\nFetch weather data.`
    );
    await writeFile(
      join(workspaceDir, "skills", "git", "SKILL.md"),
      `---\nname: git\ndescription: Git version control operations\n---\n# Git\n\nRun git commands.`
    );

    global.fetch = mockFetch;
  });

  afterEach(async () => {
    await rm(workspaceDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // Returns an embedding response. numSkills * queriesPerSkill total embeddings.
  // Each skill s gets unit vector [0...,1,...,0] at position s%4.
  function makeEmbeddingResponse(numSkills: number, queriesPerSkill: number) {
    const data = [];
    for (let s = 0; s < numSkills; s++) {
      for (let q = 0; q < queriesPerSkill; q++) {
        const idx = s * queriesPerSkill + q;
        data.push({
          index: idx,
          embedding: Array.from({ length: 4 }, (_, j) => (j === s % 4 ? 1 : 0)),
        });
      }
    }
    return { ok: true, json: async () => ({ data }) };
  }

  it("builds an index from workspace skills — one embedding call, no LLM calls", async () => {
    // Skills without queries: fallback to description = 1 query per skill
    mockFetch.mockResolvedValueOnce(makeEmbeddingResponse(2, 1));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(workspaceDir);

    expect(index.skillCount).toBe(2);
    // Only 1 fetch call: the embedding batch (no chat completion calls)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    // 2 skills × 1 description each
    expect(body.input).toHaveLength(2);
  });

  it("uses frontmatter queries when present", async () => {
    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get weather\nqueries:\n  - "What is the weather?"\n  - "Will it rain?"\n  - "Temperature today"\n---\n# Weather`
    );
    // weather: 3 queries, git: 1 (description fallback) = 4 total
    mockFetch.mockResolvedValueOnce(makeEmbeddingResponse(1, 3));
    // git uses description fallback
    const gitEmbed = { ok: true, json: async () => ({ data: [{ index: 0, embedding: [0,1,0,0] }] }) };
    // Actually they're batched together — provide 4 embeddings total
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { index: 0, embedding: [1, 0, 0, 0] },
          { index: 1, embedding: [1, 0, 0, 0] },
          { index: 2, embedding: [1, 0, 0, 0] },
          { index: 3, embedding: [0, 1, 0, 0] },
        ],
      }),
    });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(workspaceDir);

    expect(index.skillCount).toBe(2);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.input).toHaveLength(4); // 3 + 1
  });

  it("needsRebuild returns true before first build", () => {
    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    expect(index.needsRebuild()).toBe(true);
  });

  it("needsRebuild returns false immediately after build", async () => {
    mockFetch.mockResolvedValueOnce(makeEmbeddingResponse(2, 1));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 60_000 }, "test-key");
    await index.build(workspaceDir);

    expect(index.needsRebuild()).toBe(false);
  });

  it("needsRebuild returns true after cacheTimeMs elapses", async () => {
    mockFetch.mockResolvedValueOnce(makeEmbeddingResponse(2, 1));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 0 }, "test-key");
    await index.build(workspaceDir);

    expect(index.needsRebuild()).toBe(true);
  });

  it("second build is a no-op when files unchanged", async () => {
    mockFetch.mockResolvedValueOnce(makeEmbeddingResponse(2, 1));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 60_000 }, "test-key");
    await index.build(workspaceDir);
    await index.build(workspaceDir); // second build — files unchanged

    // Only 1 fetch call total
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(index.skillCount).toBe(2);
  });

  it("search returns results above threshold", async () => {
    mockFetch
      .mockResolvedValueOnce(makeEmbeddingResponse(2, 1))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] }),
      });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, threshold: 0.5 }, "test-key");
    await index.build(workspaceDir);

    const results = await index.search("what is the weather?", 3, 0.5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("search filters results below threshold", async () => {
    mockFetch
      .mockResolvedValueOnce(makeEmbeddingResponse(2, 1))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] }),
      });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(workspaceDir);

    const results = await index.search("weather", 3, 0.65);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("search returns skills sorted by score descending", async () => {
    mockFetch
      .mockResolvedValueOnce(makeEmbeddingResponse(2, 1))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [0.8, 0.2, 0, 0] }] }),
      });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, threshold: 0.0 }, "test-key");
    await index.build(workspaceDir);

    const results = await index.search("weather git", 3, 0.0);
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
  });

  it("search respects topK limit", async () => {
    mockFetch
      .mockResolvedValueOnce(makeEmbeddingResponse(2, 1))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 1, 0, 0] }] }),
      });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, threshold: 0.0 }, "test-key");
    await index.build(workspaceDir);

    const results = await index.search("anything", 1, 0.0);
    expect(results).toHaveLength(1);
  });

  it("readSkillContent strips frontmatter and returns body", async () => {
    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    const location = join(workspaceDir, "skills", "weather", "SKILL.md");
    const content = await index.readSkillContent(location);
    expect(content).toContain("Fetch weather data");
    expect(content).not.toContain("---");
  });

  it("handles workspace with no skills directory gracefully", async () => {
    const emptyDir = join(tmpdir(), `empty-workspace-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(emptyDir);

    expect(index.skillCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    await rm(emptyDir, { recursive: true, force: true });
  });

  it("skips SKILL.md files with missing name or description", async () => {
    await writeFile(
      join(workspaceDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\n---\n# Missing description`
    );
    // Only git skill is valid: 1 query (description fallback)
    mockFetch.mockResolvedValueOnce(makeEmbeddingResponse(1, 1));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(workspaceDir);

    expect(index.skillCount).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.input).toHaveLength(1);
  });
});
