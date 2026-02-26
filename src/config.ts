export type SkillRouterConfig = {
  enabled: boolean;
  topK: number;
  threshold: number;
  embeddingModel: string;
  maxInjectedChars: number;
  cacheTimeMs: number;
  skillDirs?: string[];
};

export const DEFAULT_CONFIG: SkillRouterConfig = {
  enabled: false,
  topK: 3,
  threshold: 0.65,
  embeddingModel: "text-embedding-3-small",
  maxInjectedChars: 8000,
  cacheTimeMs: 300_000, // 5 min
};

export function resolveConfig(pluginConfig?: Record<string, unknown>): SkillRouterConfig {
  if (!pluginConfig) return { ...DEFAULT_CONFIG };
  return {
    enabled: typeof pluginConfig.enabled === "boolean" ? pluginConfig.enabled : DEFAULT_CONFIG.enabled,
    topK: typeof pluginConfig.topK === "number" ? pluginConfig.topK : DEFAULT_CONFIG.topK,
    threshold: typeof pluginConfig.threshold === "number" ? pluginConfig.threshold : DEFAULT_CONFIG.threshold,
    embeddingModel: typeof pluginConfig.embeddingModel === "string" ? pluginConfig.embeddingModel : DEFAULT_CONFIG.embeddingModel,
    maxInjectedChars: typeof pluginConfig.maxInjectedChars === "number" ? pluginConfig.maxInjectedChars : DEFAULT_CONFIG.maxInjectedChars,
    cacheTimeMs: typeof pluginConfig.cacheTimeMs === "number" ? pluginConfig.cacheTimeMs : DEFAULT_CONFIG.cacheTimeMs,
    skillDirs: Array.isArray(pluginConfig.skillDirs) ? pluginConfig.skillDirs.map(String) : undefined,
  };
}
