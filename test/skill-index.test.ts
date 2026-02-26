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

  // Mock fetch globally for OpenAI API calls
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

  function makeEmbeddingResponse(count: number) {
    // Return distinct unit vectors: skill 0 -> [1,0], skill 1 -> [0,1]
    const data = Array.from({ length: count }, (_, i) => ({
      index: i,
      embedding: Array.from({ length: 4 }, (_, j) => (j === i % 4 ? 1 : 0)),
    }));
    return {
      ok: true,
      json: async () => ({ data }),
    };
  }

  it("builds an index from workspace skills", async () => {
    mockFetch.mockResolvedValue(makeEmbeddingResponse(2));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(workspaceDir);

    expect(index.skillCount).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const call = mockFetch.mock.calls[0];
    expect(call[0]).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(call[1].body as string);
    expect(body.input).toHaveLength(2);
    expect(body.input).toContain("Get current weather and forecasts");
    expect(body.input).toContain("Git version control operations");
  });

  it("needsRebuild returns true before first build", () => {
    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    expect(index.needsRebuild()).toBe(true);
  });

  it("needsRebuild returns false immediately after build", async () => {
    mockFetch.mockResolvedValue(makeEmbeddingResponse(2));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 60_000 }, "test-key");
    await index.build(workspaceDir);

    expect(index.needsRebuild()).toBe(false);
  });

  it("needsRebuild returns true after cacheTimeMs elapses", async () => {
    mockFetch.mockResolvedValue(makeEmbeddingResponse(2));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true, cacheTimeMs: 0 }, "test-key");
    await index.build(workspaceDir);

    // cacheTimeMs=0 means it's always stale after the very first check
    expect(index.needsRebuild()).toBe(true);
  });

  it("search returns results above threshold", async () => {
    // Build: 2 skills get embeddings [1,0,0,0] and [0,1,0,0]
    mockFetch
      .mockResolvedValueOnce(makeEmbeddingResponse(2)) // build call
      .mockResolvedValueOnce({                          // search call: query embedding matches skill 0
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
    // Build: skill 0 -> [1,0,0,0], skill 1 -> [0,1,0,0]
    mockFetch
      .mockResolvedValueOnce(makeEmbeddingResponse(2))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: [{ index: 0, embedding: [1, 0, 0, 0] }] }),
      });

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(workspaceDir);

    // skill 1 has embedding [0,1,0,0] vs query [1,0,0,0] -> similarity 0
    // threshold 0.65 should filter it out
    const results = await index.search("weather", 3, 0.65);
    expect(results).toHaveLength(1);
    // The one result should have a high score (matches the query embedding exactly)
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("search returns skills sorted by score descending", async () => {
    // skill 0 -> [1,0,0,0], skill 1 -> [0,1,0,0]
    // query -> [0.8, 0.2, 0, 0]: closer to skill 0
    mockFetch
      .mockResolvedValueOnce(makeEmbeddingResponse(2))
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
      .mockResolvedValueOnce(makeEmbeddingResponse(2))
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
    mockFetch.mockResolvedValue(makeEmbeddingResponse(0));

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
    mockFetch.mockResolvedValue(makeEmbeddingResponse(1));

    const index = new SkillIndex({ ...DEFAULT_CONFIG, enabled: true }, "test-key");
    await index.build(workspaceDir);

    // Only the git skill with a complete frontmatter gets indexed
    expect(index.skillCount).toBe(1);
    expect(mockFetch.mock.calls[0]).toBeTruthy();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    expect(body.input[0]).toBe("Git version control operations");
  });
});
