import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { createRouter } from "../src/router.ts";
import { SessionTracker } from "../src/session.ts";
import type { SkillIndex } from "../src/skill-index.ts";
import type { IndexedSkill, SkillSearchResult } from "../src/types.ts";

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

function makeSkill(overrides: Partial<IndexedSkill> = {}): IndexedSkill {
  return {
    name: "test-skill",
    description: "A test skill",
    location: "/fake/skills/test/SKILL.md",
    type: "skill",
    embeddings: [],
    queries: [],
    ...overrides,
  };
}

const BASE_EVENT = { prompt: "how do I check the weather?", messages: [] };
const BASE_CONTEXT = { workspaceDir: "/fake/workspace", sessionId: "test-session-1" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createRouter", () => {
  let sessionTracker: SessionTracker;

  beforeEach(() => {
    sessionTracker = new SessionTracker();
  });

  it("returns undefined when config.enabled is false", async () => {
    const logger = makeLogger();
    const index = makeIndex();
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: false },
      logger,
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
    expect(index.search).not.toHaveBeenCalled();
  });

  it("returns undefined when no skills match", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      search: vi.fn().mockResolvedValue([]),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
  });

  it("rebuilds index when stale and workspaceDir is available", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      needsRebuild: vi.fn().mockReturnValue(true),
      search: vi.fn().mockResolvedValue([]),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );

    await router(BASE_EVENT, BASE_CONTEXT);

    expect(index.build).toHaveBeenCalledWith("/fake/workspace");
  });

  it("skips rebuild when workspaceDir is not available", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      needsRebuild: vi.fn().mockReturnValue(true),
      search: vi.fn().mockResolvedValue([]),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );

    await router(BASE_EVENT, {});

    expect(index.build).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Graduated disclosure: Skills (teaser)
  // -----------------------------------------------------------------------

  it("injects skill teaser (not full body) for type=skill", async () => {
    const logger = makeLogger();
    const skill = makeSkill({
      name: "weather",
      description: "Get weather forecasts",
      type: "skill",
    });
    const matches: SkillSearchResult[] = [{ skill, score: 0.92 }];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue("# Full body that should NOT appear"),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeDefined();
    expect(result?.prependContext).toContain("Available Skill: weather");
    expect(result?.prependContext).toContain("92%");
    expect(result?.prependContext).toContain("Get weather forecasts");
    expect(result?.prependContext).toContain("read the full instructions at");
    // Should NOT contain the full body
    expect(result?.prependContext).not.toContain("Full body that should NOT appear");
    // readSkillContent should NOT have been called for skill type
    expect(index.readSkillContent).not.toHaveBeenCalled();
  });

  it("injects skill teaser for type=workflow", async () => {
    const skill = makeSkill({ name: "deploy", description: "Deploy workflow", type: "workflow" });
    const matches: SkillSearchResult[] = [{ skill, score: 0.85 }];
    const index = makeIndex({ search: vi.fn().mockResolvedValue(matches) });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      makeLogger(),
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);
    expect(result?.prependContext).toContain("Available Skill: deploy");
    expect(result?.prependContext).toContain("read the full instructions at");
  });

  // -----------------------------------------------------------------------
  // Graduated disclosure: Memories (always full)
  // -----------------------------------------------------------------------

  it("injects full body for type=memory", async () => {
    const skill = makeSkill({ name: "pnpm-pref", description: "Use pnpm", type: "memory" });
    const matches: SkillSearchResult[] = [{ skill, score: 0.88 }];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue("Always use pnpm instead of npm."),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      makeLogger(),
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);
    expect(result?.prependContext).toContain("Recalled Memory: pnpm-pref");
    expect(result?.prependContext).toContain("Always use pnpm instead of npm.");
  });

  it("injects full body for type=session-learning", async () => {
    const skill = makeSkill({
      name: "correction",
      description: "A correction",
      type: "session-learning",
    });
    const matches: SkillSearchResult[] = [{ skill, score: 0.8 }];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue("Don't do X, do Y instead."),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      makeLogger(),
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);
    expect(result?.prependContext).toContain("Recalled Memory: correction");
    expect(result?.prependContext).toContain("Don't do X, do Y instead.");
  });

  // -----------------------------------------------------------------------
  // Graduated disclosure: Rules (full → one-liner)
  // -----------------------------------------------------------------------

  it("injects full body for rule on first match", async () => {
    const skill = makeSkill({
      name: "pnpm-rule",
      description: "Use pnpm",
      type: "rule",
      oneLiner: "Use pnpm, not npm.",
    });
    const matches: SkillSearchResult[] = [{ skill, score: 0.9 }];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue("Always use pnpm for all package management."),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      makeLogger(),
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);
    expect(result?.prependContext).toContain("Rule: pnpm-rule");
    expect(result?.prependContext).not.toContain("Rule reminder");
    expect(result?.prependContext).toContain("Always use pnpm for all package management.");
  });

  it("injects one-liner reminder for rule on subsequent match", async () => {
    const skill = makeSkill({
      name: "pnpm-rule",
      description: "Use pnpm",
      type: "rule",
      oneLiner: "Use pnpm, not npm.",
    });
    const matches: SkillSearchResult[] = [{ skill, score: 0.9 }];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue("Full rule body."),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      makeLogger(),
      sessionTracker,
    );

    // First call — full body
    await router(BASE_EVENT, BASE_CONTEXT);

    // Second call — should be reminder
    const result = await router(BASE_EVENT, BASE_CONTEXT);
    expect(result?.prependContext).toContain("Rule reminder: pnpm-rule");
    expect(result?.prependContext).toContain("Use pnpm, not npm.");
    expect(result?.prependContext).not.toContain("Full rule body.");
  });

  it("falls back to description when oneLiner is absent for rule reminder", async () => {
    const skill = makeSkill({
      name: "no-liner",
      description: "Fallback description",
      type: "rule",
      // no oneLiner
    });
    const matches: SkillSearchResult[] = [{ skill, score: 0.85 }];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue("Full body."),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      makeLogger(),
      sessionTracker,
    );

    // First call
    await router(BASE_EVENT, BASE_CONTEXT);
    // Second call — reminder
    const result = await router(BASE_EVENT, BASE_CONTEXT);
    expect(result?.prependContext).toContain("Rule reminder: no-liner");
    expect(result?.prependContext).toContain("Fallback description");
  });

  // -----------------------------------------------------------------------
  // maxInjectedChars limit
  // -----------------------------------------------------------------------

  it("respects maxInjectedChars limit and stops adding skills", async () => {
    const logger = makeLogger();
    const matches: SkillSearchResult[] = [
      { skill: makeSkill({ name: "skill-a", description: "A", type: "memory" }), score: 0.9 },
      { skill: makeSkill({ name: "skill-b", description: "B", type: "memory" }), score: 0.8 },
    ];

    const bigContent = "x".repeat(5000);
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue(bigContent),
    });

    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true, maxInjectedChars: 6000 },
      logger,
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result?.prependContext).toContain("skill-a");
    expect(result?.prependContext).not.toContain("skill-b");
  });

  // -----------------------------------------------------------------------
  // Logging
  // -----------------------------------------------------------------------

  it("logs breakdown by type", async () => {
    const logger = makeLogger();
    const matches: SkillSearchResult[] = [
      { skill: makeSkill({ name: "r1", type: "rule", oneLiner: "rule" }), score: 0.9 },
      { skill: makeSkill({ name: "m1", type: "memory" }), score: 0.85 },
      { skill: makeSkill({ name: "s1", type: "skill" }), score: 0.8 },
    ];
    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockResolvedValue("content"),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );

    await router(BASE_EVENT, BASE_CONTEXT);

    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("1 rule"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("1 skill"));
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("1 memory"));
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  it("returns undefined when search throws, without propagating error", async () => {
    const logger = makeLogger();
    const index = makeIndex({
      search: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );

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
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );

    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("build failed"));
  });

  it("skips unreadable memory files and continues", async () => {
    const logger = makeLogger();
    const matches: SkillSearchResult[] = [
      { skill: makeSkill({ name: "bad", type: "memory", location: "/bad/SKILL.md" }), score: 0.9 },
      {
        skill: makeSkill({ name: "good", type: "memory", location: "/good/SKILL.md" }),
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

    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );
    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result?.prependContext).toContain("good");
    expect(result?.prependContext).not.toContain("bad");
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("file not found"));
  });

  it("returns undefined when all reads fail", async () => {
    const logger = makeLogger();
    const matches: SkillSearchResult[] = [
      { skill: makeSkill({ name: "bad", type: "memory" }), score: 0.9 },
    ];

    const index = makeIndex({
      search: vi.fn().mockResolvedValue(matches),
      readSkillContent: vi.fn().mockRejectedValue(new Error("read error")),
    });

    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      logger,
      sessionTracker,
    );
    const result = await router(BASE_EVENT, BASE_CONTEXT);

    expect(result).toBeUndefined();
  });

  it("skips HEARTBEAT_OK prompts", async () => {
    const index = makeIndex();
    const router = createRouter(
      index,
      { ...DEFAULT_CONFIG, enabled: true },
      makeLogger(),
      sessionTracker,
    );

    const result = await router({ prompt: "HEARTBEAT_OK", messages: [] }, BASE_CONTEXT);
    expect(result).toBeUndefined();
    expect(index.search).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SessionTracker
// ---------------------------------------------------------------------------

describe("SessionTracker", () => {
  it("returns false for unseen rules", () => {
    const tracker = new SessionTracker();
    expect(tracker.hasRuleBeenShown("s1", "/rule.md")).toBe(false);
  });

  it("returns true after marking a rule shown", () => {
    const tracker = new SessionTracker();
    tracker.markRuleShown("s1", "/rule.md");
    expect(tracker.hasRuleBeenShown("s1", "/rule.md")).toBe(true);
  });

  it("tracks rules per session independently", () => {
    const tracker = new SessionTracker();
    tracker.markRuleShown("s1", "/rule.md");
    expect(tracker.hasRuleBeenShown("s2", "/rule.md")).toBe(false);
  });

  it("clears session state", () => {
    const tracker = new SessionTracker();
    tracker.markRuleShown("s1", "/rule.md");
    tracker.clearSession("s1");
    expect(tracker.hasRuleBeenShown("s1", "/rule.md")).toBe(false);
  });

  it("cleanup removes stale sessions", async () => {
    const tracker = new SessionTracker();
    tracker.markRuleShown("s1", "/rule.md");
    // Wait 10ms so the entry becomes stale with maxAge=1
    await new Promise((r) => setTimeout(r, 10));
    tracker.cleanup(1);
    expect(tracker.hasRuleBeenShown("s1", "/rule.md")).toBe(false);
  });

  it("cleanup keeps recently accessed sessions", () => {
    const tracker = new SessionTracker();
    tracker.markRuleShown("s1", "/rule.md");
    // Cleanup with very large maxAge should keep everything
    tracker.cleanup(999_999_999);
    expect(tracker.hasRuleBeenShown("s1", "/rule.md")).toBe(true);
  });
});
