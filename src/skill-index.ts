import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { embedTexts, cosineSimilarity } from "./embeddings.ts";
import type { SkillRouterConfig } from "./config.ts";

export type IndexedSkill = {
  name: string;
  description: string;
  location: string; // Path to SKILL.md
  embeddings: number[][];
  queries: string[];
};

export type SkillSearchResult = {
  skill: IndexedSkill;
  score: number;
};

type ParsedFrontmatter = {
  name?: string;
  description?: string;
  queries?: string[];
};

function parseFrontmatter(content: string): { meta: ParsedFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const frontmatter = match[1];
  const body = match[2];
  const meta: ParsedFrontmatter = {};
  const queries: string[] = [];
  let inQueriesBlock = false;

  for (const line of frontmatter.split(/\r?\n/)) {
    if (inQueriesBlock) {
      const listItem = line.match(/^\s+-\s+(.*)/);
      if (listItem) {
        queries.push(listItem[1].replace(/^["']|["']$/g, "").trim());
        continue;
      }
      inQueriesBlock = false;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key === "name") meta.name = value;
    if (key === "description") meta.description = value;
    if (key === "queries" && rawValue === "") inQueriesBlock = true;
  }

  if (queries.length > 0) meta.queries = queries;
  return { meta, body };
}

async function scanSkillDirs(dirs: string[]): Promise<string[]> {
  const skillFiles: string[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillMd = join(dir, entry, "SKILL.md");
      try {
        await readFile(skillMd);
        skillFiles.push(skillMd);
      } catch {
        // No SKILL.md in this subdirectory
      }
    }
  }

  return skillFiles;
}

export class SkillIndex {
  private skills: IndexedSkill[] = [];
  private buildTime: number = 0;
  private skillMtimes: Map<string, number> = new Map();

  constructor(
    private config: SkillRouterConfig,
    private apiKey: string
  ) {}

  get skillCount(): number {
    return this.skills.length;
  }

  needsRebuild(): boolean {
    if (this.buildTime === 0) return true;
    return Date.now() - this.buildTime >= this.config.cacheTimeMs;
  }

  async build(workspaceDir: string): Promise<void> {
    const managedSkillsDir = join(homedir(), ".openclaw", "workspace", "skills");
    const workspaceSkillsDir = join(workspaceDir, "skills");

    const dirsToScan: string[] = [workspaceSkillsDir, managedSkillsDir];
    if (this.config.skillDirs) {
      dirsToScan.push(...this.config.skillDirs);
    }

    const skillFiles = await scanSkillDirs(dirsToScan);

    // Stat all files to detect changes
    const statResults = await Promise.all(
      skillFiles.map(async (location) => {
        const s = await stat(location);
        return { location, mtime: s.mtimeMs };
      })
    );

    // Early return if nothing has changed
    const currentLocations = new Set(statResults.map((s) => s.location));
    const anyNew = statResults.some((s) => !this.skillMtimes.has(s.location));
    const anyChanged = statResults.some((s) => this.skillMtimes.get(s.location) !== s.mtime);
    const anyDeleted = [...this.skillMtimes.keys()].some((loc) => !currentLocations.has(loc));

    if (this.buildTime > 0 && !anyNew && !anyChanged && !anyDeleted) {
      this.buildTime = Date.now(); // reset TTL
      return;
    }

    // Parse skills that are new or changed
    type ParsedSkill = { name: string; description: string; location: string; queries: string[] };
    const toEmbed: ParsedSkill[] = [];

    for (const { location, mtime } of statResults) {
      const unchanged =
        this.skillMtimes.get(location) === mtime &&
        this.skills.some((s) => s.location === location);
      if (unchanged) continue;

      try {
        const raw = await readFile(location, "utf-8");
        const { meta } = parseFrontmatter(raw);
        if (!meta.name || !meta.description) continue;
        // Use frontmatter queries if present, fall back to description
        const queries = meta.queries?.length ? meta.queries : [meta.description];
        toEmbed.push({ name: meta.name, description: meta.description, location, queries });
      } catch {
        // Skip unreadable files
      }
    }

    // Embed new/changed skills in one batch call
    if (toEmbed.length > 0) {
      const flatQueries = toEmbed.flatMap((p) => p.queries);
      const flatEmbeddings = await embedTexts(flatQueries, {
        model: this.config.embeddingModel,
        apiKey: this.apiKey,
      });

      let offset = 0;
      for (const p of toEmbed) {
        const embeddings = flatEmbeddings.slice(offset, offset + p.queries.length);
        const skill: IndexedSkill = {
          name: p.name,
          description: p.description,
          location: p.location,
          embeddings,
          queries: p.queries,
        };
        const existing = this.skills.findIndex((s) => s.location === p.location);
        if (existing >= 0) this.skills[existing] = skill;
        else this.skills.push(skill);
        offset += p.queries.length;
      }
    }

    // Remove deleted skills
    this.skills = this.skills.filter((s) => currentLocations.has(s.location));

    // Update mtime tracking
    this.skillMtimes = new Map(statResults.map((s) => [s.location, s.mtime]));

    this.buildTime = Date.now();
  }

  async search(query: string, topK: number, threshold: number): Promise<SkillSearchResult[]> {
    if (this.skills.length === 0) return [];

    const [queryEmbedding] = await embedTexts([query], {
      model: this.config.embeddingModel,
      apiKey: this.apiKey,
    });

    const scored = this.skills.map((skill) => {
      const similarities = skill.embeddings.map((e) => cosineSimilarity(queryEmbedding, e));
      const score = similarities.reduce((sum, s) => sum + s, 0) / similarities.length;
      return { skill, score };
    });

    return scored
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  async readSkillContent(location: string): Promise<string> {
    const raw = await readFile(location, "utf-8");
    const { body } = parseFrontmatter(raw);
    return body.trim();
  }
}

// Export parseFrontmatter for testing
export { parseFrontmatter };
