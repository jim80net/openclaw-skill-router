import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { embedTexts, cosineSimilarity } from "./embeddings.ts";
import type { SkillRouterConfig } from "./config.ts";

export type IndexedSkill = {
  name: string;
  description: string;
  location: string; // Path to SKILL.md
  embedding: number[];
};

export type SkillSearchResult = {
  skill: IndexedSkill;
  score: number;
};

type ParsedFrontmatter = {
  name?: string;
  description?: string;
};

function parseFrontmatter(content: string): { meta: ParsedFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const frontmatter = match[1];
  const body = match[2];
  const meta: ParsedFrontmatter = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (key === "name") meta.name = value;
    if (key === "description") meta.description = value;
  }

  return { meta, body };
}

async function scanSkillDirs(dirs: string[]): Promise<string[]> {
  const skillFiles: string[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      // Directory may not exist — skip silently
      continue;
    }

    for (const entry of entries) {
      const skillMd = join(dir, entry, "SKILL.md");
      try {
        await readFile(skillMd); // Check existence
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
    if (skillFiles.length === 0) {
      this.skills = [];
      this.buildTime = Date.now();
      return;
    }

    // Read and parse all SKILL.md files
    const parsed: Array<{ name: string; description: string; location: string }> = [];
    for (const location of skillFiles) {
      try {
        const raw = await readFile(location, "utf-8");
        const { meta } = parseFrontmatter(raw);
        if (!meta.name || !meta.description) continue;
        parsed.push({ name: meta.name, description: meta.description, location });
      } catch {
        // Skip unreadable files
      }
    }

    if (parsed.length === 0) {
      this.skills = [];
      this.buildTime = Date.now();
      return;
    }

    // Embed all descriptions in one batch call
    const descriptions = parsed.map((p) => p.description);
    const embeddings = await embedTexts(descriptions, {
      model: this.config.embeddingModel,
      apiKey: this.apiKey,
    });

    this.skills = parsed.map((p, i) => ({
      name: p.name,
      description: p.description,
      location: p.location,
      embedding: embeddings[i],
    }));

    this.buildTime = Date.now();
  }

  async search(query: string, topK: number, threshold: number): Promise<SkillSearchResult[]> {
    if (this.skills.length === 0) return [];

    const [queryEmbedding] = await embedTexts([query], {
      model: this.config.embeddingModel,
      apiKey: this.apiKey,
    });

    const scored = this.skills.map((skill) => ({
      skill,
      score: cosineSimilarity(queryEmbedding, skill.embedding),
    }));

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
