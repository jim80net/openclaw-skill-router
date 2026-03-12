import type { SkillType } from "./types.ts";

export type SkillRouterConfig = {
  enabled: boolean;
  topK: number;
  threshold: number;
  embeddingModel: string;
  embeddingBackend: "openai" | "local";
  maxInjectedChars: number;
  cacheTimeMs: number;
  skillDirs?: string[];
  types: SkillType[];
};

export const DEFAULT_CONFIG: SkillRouterConfig = {
  enabled: false,
  topK: 3,
  threshold: 0.45, // lower threshold for 384-dim local model (less discriminating than 1536-dim)
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  embeddingBackend: "local",
  maxInjectedChars: 8000,
  cacheTimeMs: 300_000, // 5 min
  types: ["skill", "memory", "workflow", "session-learning", "rule"],
};

export function resolveConfig(pluginConfig?: Record<string, unknown>): SkillRouterConfig {
  if (!pluginConfig) return { ...DEFAULT_CONFIG };
  return {
    enabled:
      typeof pluginConfig.enabled === "boolean" ? pluginConfig.enabled : DEFAULT_CONFIG.enabled,
    topK: typeof pluginConfig.topK === "number" ? pluginConfig.topK : DEFAULT_CONFIG.topK,
    threshold:
      typeof pluginConfig.threshold === "number"
        ? pluginConfig.threshold
        : DEFAULT_CONFIG.threshold,
    embeddingModel:
      typeof pluginConfig.embeddingModel === "string"
        ? pluginConfig.embeddingModel
        : DEFAULT_CONFIG.embeddingModel,
    embeddingBackend:
      pluginConfig.embeddingBackend === "local" ? "local" : DEFAULT_CONFIG.embeddingBackend,
    maxInjectedChars:
      typeof pluginConfig.maxInjectedChars === "number"
        ? pluginConfig.maxInjectedChars
        : DEFAULT_CONFIG.maxInjectedChars,
    cacheTimeMs:
      typeof pluginConfig.cacheTimeMs === "number"
        ? pluginConfig.cacheTimeMs
        : DEFAULT_CONFIG.cacheTimeMs,
    skillDirs: Array.isArray(pluginConfig.skillDirs)
      ? pluginConfig.skillDirs.map(String)
      : undefined,
    types: Array.isArray(pluginConfig.types)
      ? (pluginConfig.types as SkillType[])
      : DEFAULT_CONFIG.types,
  };
}
