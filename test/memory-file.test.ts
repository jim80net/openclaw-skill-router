import { describe, expect, it } from "vitest";
import { parseMemoryFile } from "../src/skill-index.ts";

describe("parseMemoryFile", () => {
  it("extracts ## sections with body content", () => {
    const content = `# Top level heading (ignored)

Some intro text.

## Trading Rules

Never trade without a stop loss.
Always use position sizing.

## Risk Management

Keep portfolio beta under 1.5.
`;
    const result = parseMemoryFile(content, "/fake/path.md");

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Trading Rules");
    expect(result[0].body).toContain("Never trade without a stop loss.");
    // No Triggers: lines, so queries is empty (caller defaults to [description])
    expect(result[0].queries).toEqual([]);
    expect(result[1].name).toBe("Risk Management");
  });

  it("extracts Triggers: lines as queries", () => {
    const content = `## Deploy Process

Triggers: deploy, push to production, ship it

Run the CI pipeline first.
Then merge to main.
`;
    const result = parseMemoryFile(content, "/fake/path.md");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Deploy Process");
    expect(result[0].queries).toEqual(["deploy", "push to production", "ship it"]);
    expect(result[0].body).not.toContain("Triggers:");
  });

  it("handles Trigger: (singular) as well", () => {
    const content = `## Git Workflow

Trigger: git commit, branch, pr

Always use feature branches.
`;
    const result = parseMemoryFile(content, "/fake/path.md");

    expect(result).toHaveLength(1);
    expect(result[0].queries).toEqual(["git commit", "branch", "pr"]);
  });

  it("uses first body line as description", () => {
    const content = `## API Keys

Store all API keys in 1Password.
Never hardcode them.
`;
    const result = parseMemoryFile(content, "/fake/path.md");

    expect(result[0].description).toBe("Store all API keys in 1Password.");
  });

  it("uses name as description when body is empty but has triggers", () => {
    const content = `## Quick Reference

Triggers: help, cheatsheet
`;
    const result = parseMemoryFile(content, "/fake/path.md");

    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("Quick Reference");
    expect(result[0].queries).toEqual(["help", "cheatsheet"]);
  });

  it("skips sections with no body and no triggers", () => {
    const content = `## Empty Section

## Has Content

Some actual content here.
`;
    const result = parseMemoryFile(content, "/fake/path.md");

    // "Empty Section" has a blank body after trimming but no triggers
    // Only "Has Content" should be returned
    expect(result.some((r) => r.name === "Has Content")).toBe(true);
  });

  it("returns empty array for content with no ## headings", () => {
    const content = `# Only a top-level heading

Some text without any ## sections.
`;
    const result = parseMemoryFile(content, "/fake/path.md");
    expect(result).toHaveLength(0);
  });

  it("strips quoted triggers", () => {
    const content = `## Preferences

Triggers: "dark mode", 'font size', plain

User prefers dark mode.
`;
    const result = parseMemoryFile(content, "/fake/path.md");

    expect(result[0].queries).toEqual(["dark mode", "font size", "plain"]);
  });
});
