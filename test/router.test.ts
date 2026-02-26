import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRouter } from "../src/router.ts";
import type { SkillIndex, SkillSearchResult } from "../src/skill-index.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeIndex(overrides: Partial<SkillIndex> = {}): SkillIndex {
  return {
    skillCount: 0,
    needsRebuild: vi.fn().mockReturnValue(false),
    build: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockResolvedValue([]),
    readSkillContent: vi.fn().mockResolvedValue(""),
    ...overrides,
  } as unknown as SkillIndex;
}

const BASE_EVENT = { prompt: "how do I check the weather?", messages: [] };
const BASE_CONTEXT = { workspaceDir: "/fake/workspace" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createRouter", () => {
  it("returns undefined when config.enabled is false", async () => {
    const logger = makeLogger();
    const index = makeIndex();
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: false }, logger);

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
    expect(index.search).not.toHaveBeenCalled();
  });

  it("returns undefined when no skills match", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      search: vi.fn().mockResolvedValue([]),
    });
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
  });

  it("rebuilds index when stale and workspaceDir is available", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      needsRebuild: vi.fn().mockReturnValue(true),
      search: vi.fn().mockResolvedValue([]),
    });
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);

    await router(BASE_EVENT, BASE_CONTEXT);

    expect(index.build).toHaveBeenCalledWith("/fake/workspace");
  });

  it("skips rebuild when workspaceDir is not available", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      needsRebuild: vi.fn().mockReturnValue(true),
      search: vi.fn().mockResolvedValue([]),
    });
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);

    await router(BASE_EVENT, {});

    expect(index.build).not.toHaveBeenCalled();
  });

  it("returns prependContext with matched skill content", async () => {
    const logger = makeLogger();
    const matchedSkill: SkillSearchResult = {
      skill: {
        name: "weather",
        description: "Get weather",
        location: "/fake/skills/weather/SKILL.md",
        embedding: [],
      },
      score: 0.92,
    };
    const index = makeIndex({
      search: vi.fn().mockResolvedValue([matchedSkill]),
      readSkillContent: vi.fn().mockResolvedValue("# Weather\n\nFetch weather data."),
    });
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeDefined();
    expect(result?.prependContext).toContain("Auto-loaded Skill: weather");
    expect(result?.prependContext).toContain("92%");
    expect(result?.prependContext).toContain("Fetch weather data");
    expect(result?.prependContext).toContain("The following skills were automatically loaded");
  });

  it("respects maxInjectedChars limit and stops adding skills", async () => {
    const logger = makeLogger();
    const bigContent = "x".repeat(5000);

    const matches: SkillSearchResult[] = [
      {
        skill: { name: "skill-a", description: "A", location: "/a/SKILL.md", embedding: [] },
        score: 0.9,
      },
      {
        skill: { name: "skill-b", description: "B", location: "/b/SKILL.md", embedding: [] },
        score: 0.8,
      },
    ];

    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue(bigContent),
    });

    // maxInjectedChars < bigContent.length * 2, so second skill won't fit
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true, maxInjectedChars: 6000 },
      logger
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result?.prependContext).toContain("skill-a");
    expect(result?.prependContext).not.toContain("skill-b");
  });

  it("logs the number of injected skills and char count", async () => {
    const logger = makeLogger();
    const content = "some content";
    const matches: SkillSearchResult[] = [
      {
        skill: { name: "weather", description: "W", location: "/w/SKILL.md", embedding: [] },
        score: 0.88,
      },
    ];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue(content),
    });
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);

    await router(BASE_EVENT, BASE_CONTEXT);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("injected 1 skills")
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining(`${content.length} chars`)
    );
  });

  it("returns undefined when search throws, without propagating error", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      search: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("network error"));
  });

  it("returns undefined when build throws, without propagating error", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      needsRebuild: vi.fn().mockReturnValue(true),
      build: vi.fn().mockRejectedValue(new Error("build failed")),
      search: vi.fn().mockResolvedValue([]),
    });
    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("build failed"));
  });

  it("skips unreadable skill files and continues", async () => {
    const logger = makeLogger();
    const matches: SkillSearchResult[] = [
      {
        skill: { name: "bad-skill", description: "bad", location: "/bad/SKILL.md", embedding: [] },
        score: 0.9,
      },
      {
        skill: { name: "good-skill", description: "good", location: "/good/SKILL.md", embedding: [] },
        score: 0.85,
      },
    ];

    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi
        .fn()
        .mockRejectedValueOnce(new Error("file not found"))
        .mockResolvedValueOnce("Good content"),
    });

    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);
    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result?.prependContext).toContain("good-skill");
    expect(result?.prependContext).not.toContain("bad-skill");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("file not found"));
  });

  it("returns undefined when all skill reads fail", async () => {
    const logger = makeLogger();
    const matches: SkillSearchResult[] = [
      {
        skill: { name: "bad", description: "bad", location: "/bad/SKILL.md", embedding: [] },
        score: 0.9,
      },
    ];

    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockRejectedValue(new Error("read error")),
    });

    const router = createRouter(index, { ...DEFAULT_CONFIG, enabled: true }, logger);
    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
  });
});
