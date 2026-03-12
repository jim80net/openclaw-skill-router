// ---------------------------------------------------------------------------
// Telemetry: track which skills fire, when, and for whom
// ---------------------------------------------------------------------------

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

export type EntryTelemetry = {
  matchCount: number;
  lastMatched: string; // ISO timestamp
  firstMatched: string;
  sessionKeys: string[]; // unique sessions (capped)
};

export type TelemetryData = {
  version: 1;
  entries: Record<string, EntryTelemetry>; // keyed by skill location
};

const MAX_SESSION_KEYS = 50;
const TELEMETRY_PATH = join(homedir(), ".openclaw", "cache", "skill-router-telemetry.json");

export function getTelemetryPath(): string {
  return TELEMETRY_PATH;
}

export async function loadTelemetry(): Promise<TelemetryData> {
  const empty: TelemetryData = { version: 1, entries: {} };
  try {
    const raw = await readFile(TELEMETRY_PATH, "utf-8");
    const data = JSON.parse(raw) as TelemetryData;
    if (data.version !== 1) return empty;
    return data;
  } catch {
    return empty;
  }
}

export async function saveTelemetry(data: TelemetryData): Promise<void> {
  const dir = dirname(TELEMETRY_PATH);
  await mkdir(dir, { recursive: true });
  const tmpPath = TELEMETRY_PATH + "." + randomBytes(4).toString("hex") + ".tmp";
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmpPath, TELEMETRY_PATH);
}

/**
 * Record that a skill was matched and injected. Mutates in place.
 */
export function recordMatch(
  telemetry: TelemetryData,
  location: string,
  sessionKey: string
): void {
  const now = new Date().toISOString();
  const existing = telemetry.entries[location];

  if (existing) {
    existing.matchCount++;
    existing.lastMatched = now;
    if (!existing.sessionKeys.includes(sessionKey)) {
      existing.sessionKeys.push(sessionKey);
      if (existing.sessionKeys.length > MAX_SESSION_KEYS) {
        existing.sessionKeys = existing.sessionKeys.slice(-MAX_SESSION_KEYS);
      }
    }
  } else {
    telemetry.entries[location] = {
      matchCount: 1,
      lastMatched: now,
      firstMatched: now,
      sessionKeys: [sessionKey],
    };
  }
}
