import { access, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { CacheData } from "./cache.ts";
import { fromCachedSkill, loadCache, saveCache, toCachedSkill } from "./cache.ts";
import type { SkillRouterConfig } from "./config.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import { cosineSimilarity } from "./embeddings.ts";
import type { IndexedSkill, ParsedFrontmatter, SkillSearchResult, SkillType } from "./types.ts";

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
        listAccumulators[currentListKey].push(listItem[1].replace(/^["']|["']$/g, "").trim());
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
// Memory file parsing (shared signature with claude-skill-router)
// ---------------------------------------------------------------------------

/**
 * Parse a memory markdown file into sections.
 * Extracts ## sections and looks for `Triggers:` lines as queries.
 * Signature matches claude-skill-router/src/core/skill-index.ts.
 */
export function parseMemoryFile(
  content: string,
  _filePath: string,
): Array<{ name: string; description: string; queries: string[]; body: string }> {
  const results: Array<{ name: string; description: string; queries: string[]; body: string }> = [];

  // Split by ## headings
  const sections = content.split(/^(?=##\s)/m);

  for (const section of sections) {
    const headingMatch = section.match(/^##\s+(.+)/);
    if (!headingMatch) continue;

    const name = headingMatch[1].trim();
    const bodyLines: string[] = [];
    const queries: string[] = [];

    for (const line of section.split(/\r?\n/).slice(1)) {
      const triggerMatch = line.match(/^Triggers?:\s*(.+)/i);
      if (triggerMatch) {
        // Parse comma-separated or quoted triggers
        const raw = triggerMatch[1];
        const parsed = raw
          .split(/,\s*/)
          .map((t) => t.replace(/^["']|["']$/g, "").trim())
          .filter((t) => t.length > 0);
        queries.push(...parsed);
      } else {
        bodyLines.push(line);
      }
    }

    const body = bodyLines.join("\n").trim();
    if (body.length > 0 || queries.length > 0) {
      // Use the first meaningful line as description if body is short
      const description = body.split("\n")[0]?.trim() || name;
      results.push({ name, description, queries, body });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Memory directory scanning
// ---------------------------------------------------------------------------

async function scanMemoryDirs(dirs: string[]): Promise<string[]> {
  const memoryFiles: string[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      // Skip top-level MEMORY.md — it's already injected by OpenClaw
      if (entry === "MEMORY.md") continue;
      memoryFiles.push(join(dir, entry));
    }
  }

  return memoryFiles;
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
    private provider: EmbeddingProvider,
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

    // Scan memory directories
    const memoryDirsToScan: string[] = this.config.memoryDirs ? [...this.config.memoryDirs] : [];
    const memoryFiles = await scanMemoryDirs(memoryDirsToScan);

    // Stat all files (skills + memory)
    const statResults = await Promise.all([
      ...skillFiles.map(async (location) => {
        const s = await stat(location);
        return { location, mtime: s.mtimeMs, isMemory: false };
      }),
      ...memoryFiles.map(async (location) => {
        const s = await stat(location);
        return { location, mtime: s.mtimeMs, isMemory: true };
      }),
    ]);

    // Check for changes
    const currentLocations = new Set(statResults.map((s) => s.location));
    const anyNew = statResults.some((s) => !this.skillMtimes.has(s.location));
    const anyChanged = statResults.some((s) => this.skillMtimes.get(s.location) !== s.mtime);
    const anyDeleted = [...this.skillMtimes.keys()].some((loc) => !currentLocations.has(loc));

    if (this.buildTime > 0 && !anyNew && !anyChanged && !anyDeleted) {
      this.buildTime = Date.now();
      return;
    }

    // Parse skills/memories that need (re)embedding
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

    for (const { location, mtime, isMemory } of statResults) {
      if (isMemory) {
        // Memory files may produce multiple sections — each keyed as "path#SectionName"
        // Check if the base file changed
        const cachedMtime = this.skillMtimes.get(location);
        if (cachedMtime === mtime) continue; // no change

        // Remove old sections for this memory file from skills array
        this.skills = this.skills.filter((s) => !s.location.startsWith(`${location}#`));
        if (this.cache) {
          for (const key of Object.keys(this.cache.skills)) {
            if (key.startsWith(`${location}#`)) delete this.cache.skills[key];
          }
        }

        try {
          const raw = await readFile(location, "utf-8");
          const sections = parseMemoryFile(raw, location);
          for (const section of sections) {
            const sectionKey = `${location}#${section.name}`;
            const queries = section.queries.length > 0 ? section.queries : [section.description];
            toEmbed.push({
              name: section.name,
              description: section.description,
              location: sectionKey,
              queries,
              type: "memory",
              mtime,
            });
          }
        } catch {
          // Skip unreadable
        }
        this.skillMtimes.set(location, mtime);
        continue;
      }

      // --- Skill files (SKILL.md) ---
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

    // Remove deleted skills (handle memory section keys like "path#SectionName")
    this.skills = this.skills.filter((s) => {
      const baseLocation = s.location.includes("#") ? s.location.split("#")[0] : s.location;
      return currentLocations.has(baseLocation) || currentLocations.has(s.location);
    });
    if (this.cache) {
      for (const key of Object.keys(this.cache.skills)) {
        const baseKey = key.includes("#") ? key.split("#")[0] : key;
        if (!currentLocations.has(baseKey) && !currentLocations.has(key)) {
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
    typeFilter?: SkillType[],
    scoringMode: "relative" | "absolute" = "absolute",
    maxDropoff: number = 0.15,
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

    const sorted = scored.sort((a, b) => b.score - a.score);

    if (scoringMode === "relative") {
      // Relative mode: if the best match clears the floor, inject top-K
      // but drop results that fall too far below the best
      if (sorted.length === 0 || sorted[0].score < threshold) return [];
      const bestScore = sorted[0].score;
      return sorted.filter((r) => bestScore - r.score <= maxDropoff).slice(0, topK);
    }

    // Absolute mode (legacy): each result must individually pass threshold
    return sorted.filter((r) => r.score >= threshold).slice(0, topK);
  }

  async readSkillContent(location: string): Promise<string> {
    // Handle memory file sections (location is "path#SectionName")
    if (location.includes("#")) {
      const [filePath, sectionName] = location.split("#", 2);
      const raw = await readFile(filePath, "utf-8");
      const sections = parseMemoryFile(raw, filePath);
      const section = sections.find((s) => s.name === sectionName);
      return section?.body.trim() || "";
    }

    const raw = await readFile(location, "utf-8");
    const { body } = parseFrontmatter(raw);
    return body.trim();
  }
}

export type { ParsedFrontmatter };
// Export for testing
export { parseFrontmatter };
