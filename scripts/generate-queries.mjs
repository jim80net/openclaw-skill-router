#!/usr/bin/env node
/**
 * One-time script: generate 5 synthetic queries per skill and write them
 * into the SKILL.md frontmatter as a static `queries:` list.
 *
 * Usage: OPENAI_API_KEY=sk-... node scripts/generate-queries.mjs
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SKILLS_DIRS = [
  "/home/jim_ramtank_com/.openclaw/workspace/skills",
];
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = "gpt-4.1-nano";
const COUNT = 5;

if (!API_KEY) {
  console.error("OPENAI_API_KEY not set");
  process.exit(1);
}

async function generateQueries(name, description) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `Generate ${COUNT} short, natural example queries a user might send when they need the "${name}" skill. Description: ${description}. Output a numbered list, one per line, nothing else.`,
        },
      ],
      max_tokens: 300,
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content ?? "";
  return content
    .split("\n")
    .map((l) => l.replace(/^\d+\.\s*/, "").trim())
    .filter((l) => l.length > 0)
    .slice(0, COUNT);
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  const fm = match[1];
  const body = match[2];

  let name, description;
  for (const line of fm.split(/\r?\n/)) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key === "name") name = val;
    if (key === "description") description = val;
  }

  return { name, description, rawFrontmatter: fm, body };
}

function insertQueries(rawFrontmatter, queries) {
  // Remove existing queries block if present
  const lines = rawFrontmatter.split(/\r?\n/);
  const filtered = [];
  let inQueries = false;
  for (const line of lines) {
    if (line.trim() === "queries:") { inQueries = true; continue; }
    if (inQueries && /^\s+-/.test(line)) continue;
    inQueries = false;
    filtered.push(line);
  }
  const quotedQueries = queries.map((q) => `  - "${q.replace(/"/g, '\\"')}"`);
  return [...filtered, "queries:", ...quotedQueries].join("\n");
}

async function scanSkillFiles(dir) {
  const results = [];
  let entries;
  try { entries = await readdir(dir); } catch { return results; }
  for (const entry of entries) {
    const skillMd = join(dir, entry, "SKILL.md");
    try {
      await readFile(skillMd);
      results.push(skillMd);
    } catch { /* no SKILL.md */ }
  }
  return results;
}

async function main() {
  const allFiles = [];
  for (const dir of SKILLS_DIRS) {
    allFiles.push(...await scanSkillFiles(dir));
  }

  console.log(`Found ${allFiles.length} skill files\n`);

  for (const filePath of allFiles) {
    const raw = await readFile(filePath, "utf-8");
    const parsed = parseFrontmatter(raw);

    if (!parsed?.name || !parsed?.description) {
      console.log(`  SKIP ${filePath} (no name/description)`);
      continue;
    }

    // Skip if queries already present
    if (raw.includes("\nqueries:")) {
      console.log(`  SKIP ${parsed.name} (queries already present)`);
      continue;
    }

    console.log(`  Generating queries for: ${parsed.name}`);
    let queries;
    try {
      queries = await generateQueries(parsed.name, parsed.description);
    } catch (err) {
      console.error(`  ERROR ${parsed.name}: ${err.message}`);
      continue;
    }

    const newFm = insertQueries(parsed.rawFrontmatter, queries);
    const newContent = `---\n${newFm}\n---\n${parsed.body}`;
    await writeFile(filePath, newContent, "utf-8");
    console.log(`  ✓ ${parsed.name}: ${queries.length} queries written`);
  }

  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
