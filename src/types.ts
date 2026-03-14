// ---------------------------------------------------------------------------
// Plugin logger
// ---------------------------------------------------------------------------

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

// ---------------------------------------------------------------------------
// Knowledge types
// ---------------------------------------------------------------------------

export type SkillType =
  | "skill"
  | "memory"
  | "tool-guidance"
  | "workflow"
  | "session-learning"
  | "rule"
  | "stop-rule";

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
