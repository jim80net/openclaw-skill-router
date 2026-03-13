import { readdir, readFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { cosineSimilarity } from "./embeddings.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import type { SkillRouterConfig } from "./config.ts";
import type { IndexedSkill, SkillSearchResult, SkillType, ParsedFrontmatter } from "./types.ts";
import { loadCache, saveCache, toCachedSkill, fromCachedSkill } from "./cache.ts";
import type { CacheData } from "./cache.ts";

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const LIST_KEYS = new Set(["queries", "paths", "hooks", "keywords"]);

function parseFrontmatter(content: string): { meta: ParsedFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const frontmatter = match[1];
  const body = match[2];
  const meta: ParsedFrontmatter = {};

  let currentListKey = "";
  const listAccumulators: Record<string, string[]> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    if (currentListKey) {
      const listItem = line.match(/^\s+-\s+(.*)/);
      if (listItem) {
        listAccumulators[currentListKey].push(
          listItem[1].replace(/^["']|["']$/g, "").trim()
        );
        continue;
      }
      currentListKey = "";
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key === "name") meta.name = value;
    if (key === "description") meta.description = value;
    if (key === "type") meta.type = value as SkillType;
    if (key === "one-liner") meta.oneLiner = value;

    if (LIST_KEYS.has(key) && rawValue === "") {
      currentListKey = key;
      listAccumulators[key] = [];
    }
  }

  if (listAccumulators.queries?.length) meta.queries = listAccumulators.queries;
  if (listAccumulators.paths?.length) meta.paths = listAccumulators.paths;
  if (listAccumulators.hooks?.length) meta.hooks = listAccumulators.hooks;
  if (listAccumulators.keywords?.length) meta.keywords = listAccumulators.keywords;

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

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
        await access(skillMd);
        skillFiles.push(skillMd);
      } catch {
        // No SKILL.md
      }
    }
  }

  return skillFiles;
}

// ---------------------------------------------------------------------------
// SkillIndex (with persistent cache)
// ---------------------------------------------------------------------------

export class SkillIndex {
  private skills: IndexedSkill[] = [];
  private buildTime: number = 0;
  private skillMtimes: Map<string, number> = new Map();
  private cacheLoaded: boolean = false;
  private cache: CacheData | null = null;

  constructor(
    private config: SkillRouterConfig,
    private provider: EmbeddingProvider
  ) {}

  get skillCount(): number {
    return this.skills.length;
  }

  needsRebuild(): boolean {
    if (this.buildTime === 0) return true;
    return Date.now() - this.buildTime >= this.config.cacheTimeMs;
  }

  async build(workspaceDir: string): Promise<void> {
    // Load persistent cache on first build
    if (!this.cacheLoaded) {
      this.cache = await loadCache(this.config.embeddingModel);
      this.cacheLoaded = true;

      // Hydrate from cache on cold start
      if (this.skills.length === 0 && Object.keys(this.cache.skills).length > 0) {
        for (const [location, cached] of Object.entries(this.cache.skills)) {
          this.skills.push(fromCachedSkill(location, cached));
          this.skillMtimes.set(location, cached.mtime);
        }
      }
    }

    const managedSkillsDir = join(homedir(), ".openclaw", "workspace", "skills");
    const workspaceSkillsDir = join(workspaceDir, "skills");

    const dirsToScan: string[] = [workspaceSkillsDir, managedSkillsDir];
    if (this.config.skillDirs) {
      dirsToScan.push(...this.config.skillDirs);
    }

    const skillFiles = await scanSkillDirs(dirsToScan);

    // Stat all files
    const statResults = await Promise.all(
      skillFiles.map(async (location) => {
        const s = await stat(location);
        return { location, mtime: s.mtimeMs };
      })
    );

    // Check for changes
    const currentLocations = new Set(statResults.map((s) => s.location));
    const anyNew = statResults.some((s) => !this.skillMtimes.has(s.location));
    const anyChanged = statResults.some(
      (s) => this.skillMtimes.get(s.location) !== s.mtime
    );
    const anyDeleted = [...this.skillMtimes.keys()].some(
      (loc) => !currentLocations.has(loc)
    );

    if (this.buildTime > 0 && !anyNew && !anyChanged && !anyDeleted) {
      this.buildTime = Date.now();
      return;
    }

    // Parse skills that need (re)embedding
    type ParsedSkill = {
      name: string;
      description: string;
      location: string;
      queries: string[];
      type: SkillType;
      oneLiner?: string;
      mtime: number;
    };
    const toEmbed: ParsedSkill[] = [];

    for (const { location, mtime } of statResults) {
      // Check if cache has a valid entry
      const cached = this.cache?.skills[location];
      if (cached && cached.mtime === mtime) {
        // Use cached embeddings — skip re-embedding
        const existing = this.skills.findIndex((s) => s.location === location);
        const skill = fromCachedSkill(location, cached);
        if (existing >= 0) this.skills[existing] = skill;
        else if (!this.skills.some((s) => s.location === location)) this.skills.push(skill);
        this.skillMtimes.set(location, mtime);
        continue;
      }

      // Check in-memory cache
      const unchanged =
        this.skillMtimes.get(location) === mtime &&
        this.skills.some((s) => s.location === location);
      if (unchanged) continue;

      try {
        const raw = await readFile(location, "utf-8");
        const { meta } = parseFrontmatter(raw);
        if (!meta.name || !meta.description) continue;
        const queries = meta.queries?.length ? meta.queries : [meta.description];
        const type: SkillType = meta.type ?? "skill";
        toEmbed.push({
          name: meta.name,
          description: meta.description,
          location,
          queries,
          type,
          oneLiner: meta.oneLiner,
          mtime,
        });
      } catch {
        // Skip unreadable
      }
    }

    // Embed new/changed skills
    if (toEmbed.length > 0) {
      const flatQueries = toEmbed.flatMap((p) => p.queries);
      const flatEmbeddings = await this.provider.embed(flatQueries);

      let offset = 0;
      for (const p of toEmbed) {
        const embeddings = flatEmbeddings.slice(offset, offset + p.queries.length);
        const skill: IndexedSkill = {
          name: p.name,
          description: p.description,
          location: p.location,
          type: p.type,
          embeddings,
          queries: p.queries,
          oneLiner: p.oneLiner,
        };
        const existing = this.skills.findIndex((s) => s.location === p.location);
        if (existing >= 0) this.skills[existing] = skill;
        else this.skills.push(skill);
        offset += p.queries.length;

        // Update persistent cache
        if (this.cache) {
          this.cache.skills[p.location] = toCachedSkill(skill, p.mtime);
        }
      }
    }

    // Remove deleted skills
    this.skills = this.skills.filter((s) => currentLocations.has(s.location));
    if (this.cache) {
      for (const key of Object.keys(this.cache.skills)) {
        if (!currentLocations.has(key)) {
          delete this.cache.skills[key];
        }
      }
    }

    // Update mtime tracking
    this.skillMtimes = new Map(statResults.map((s) => [s.location, s.mtime]));

    // Persist cache (fire-and-forget)
    if (this.cache && toEmbed.length > 0) {
      saveCache(this.cache).catch(() => {
        // Cache save is best-effort
      });
    }

    this.buildTime = Date.now();
  }

  async search(
    query: string,
    topK: number,
    threshold: number,
    typeFilter?: SkillType[]
  ): Promise<SkillSearchResult[]> {
    let candidates = this.skills;
    if (typeFilter && typeFilter.length > 0) {
      const allowed = new Set(typeFilter);
      candidates = candidates.filter((s) => allowed.has(s.type));
    }

    if (candidates.length === 0) return [];

    const [queryEmbedding] = await this.provider.embed([query]);

    const scored = candidates.map((skill) => {
      const similarities = skill.embeddings.map((e) => cosineSimilarity(queryEmbedding, e));
      const score = Math.max(...similarities);
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

// Export for testing
export { parseFrontmatter };
export type { ParsedFrontmatter };
