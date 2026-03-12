// ---------------------------------------------------------------------------
// Persistent file-based cache for skill embeddings
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { IndexedSkill, SkillType } from "./types.ts";

export type CachedSkill = {
  name: string;
  description: string;
  queries: string[];
  embeddings: number[][];
  mtime: number;
  type: SkillType;
  oneLiner?: string;
};

export type CacheData = {
  version: 2;
  embeddingModel: string;
  skills: Record<string, CachedSkill>; // keyed by location
};

const CACHE_PATH = join(homedir(), ".openclaw", "cache", "skill-router.json");

export function getCachePath(): string {
  return CACHE_PATH;
}

export async function loadCache(embeddingModel: string): Promise<CacheData> {
  const empty: CacheData = { version: 2, embeddingModel, skills: {} };
  try {
    const raw = await readFile(CACHE_PATH, "utf-8");
    const data = JSON.parse(raw) as CacheData;
    // Invalidate cache if model changed or version mismatch
    if (data.version !== 2 || data.embeddingModel !== embeddingModel) return empty;
    return data;
  } catch {
    return empty;
  }
}

export async function saveCache(data: CacheData): Promise<void> {
  const dir = dirname(CACHE_PATH);
  await mkdir(dir, { recursive: true });
  const tmpPath = CACHE_PATH + "." + randomBytes(4).toString("hex") + ".tmp";
  await writeFile(tmpPath, JSON.stringify(data), "utf-8");
  await rename(tmpPath, CACHE_PATH);
}

/**
 * Convert IndexedSkill + mtime to CachedSkill for persistence.
 */
export function toCachedSkill(skill: IndexedSkill, mtime: number): CachedSkill {
  return {
    name: skill.name,
    description: skill.description,
    queries: skill.queries,
    embeddings: skill.embeddings,
    mtime,
    type: skill.type,
    oneLiner: skill.oneLiner,
  };
}

/**
 * Convert CachedSkill back to IndexedSkill.
 */
export function fromCachedSkill(location: string, cached: CachedSkill): IndexedSkill {
  return {
    name: cached.name,
    description: cached.description,
    location,
    type: cached.type,
    embeddings: cached.embeddings,
    queries: cached.queries,
    oneLiner: cached.oneLiner,
  };
}
