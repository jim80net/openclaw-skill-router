// ---------------------------------------------------------------------------
// Knowledge types
// ---------------------------------------------------------------------------

export type SkillType =
  | "skill"
  | "memory"
  | "tool-guidance"
  | "workflow"
  | "session-learning"
  | "rule";

// ---------------------------------------------------------------------------
// Indexed skill
// ---------------------------------------------------------------------------

export type IndexedSkill = {
  name: string;
  description: string;
  location: string;
  type: SkillType;
  embeddings: number[][];
  queries: string[];
  oneLiner?: string;
};

export type SkillSearchResult = {
  skill: IndexedSkill;
  score: number;
};

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

export type ParsedFrontmatter = {
  name?: string;
  description?: string;
  type?: SkillType;
  oneLiner?: string;
  queries?: string[];
  paths?: string[];
  hooks?: string[];
  keywords?: string[];
};
