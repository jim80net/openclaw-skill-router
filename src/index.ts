import { resolveConfig } from "./config.ts";
import { SkillIndex } from "./skill-index.ts";
import { createRouter } from "./router.ts";
import { SessionTracker } from "./session.ts";
import { OpenAIEmbeddingProvider, LocalEmbeddingProvider } from "./embeddings.ts";
import type { EmbeddingProvider } from "./embeddings.ts";

type OpenClawConfig = {
  workspace?: {
    dir?: string;
  };
};

type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

type OpenClawPluginApi = {
  id: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  on: (
    event: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => unknown,
    opts?: unknown
  ) => void;
  registerService: (service: { id: string; start: () => Promise<void>; stop: () => void }) => void;
};

export default function register(api: OpenClawPluginApi): void {
  const config = resolveConfig(api.pluginConfig);

  if (!config.enabled) {
    api.logger.info("Skill router disabled");
    return;
  }

  // Create embedding provider based on config
  let provider: EmbeddingProvider;
  if (config.embeddingBackend === "local") {
    provider = new LocalEmbeddingProvider(config.embeddingModel);
    api.logger.info(`Skill router: using local ONNX embeddings (${config.embeddingModel})`);
  } else {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) {
      api.logger.warn("Skill router: no OPENAI_API_KEY found, disabling");
      return;
    }
    provider = new OpenAIEmbeddingProvider(config.embeddingModel, apiKey);
  }

  const index = new SkillIndex(config, provider);
  const sessionTracker = new SessionTracker();
  const router = createRouter(index, config, api.logger, sessionTracker);

  api.on("before_prompt_build", router);

  api.registerService({
    id: "skill-router-index",
    start: async () => {
      const workspaceDir = api.config?.workspace?.dir;
      if (workspaceDir) {
        api.logger.info("Skill router: building initial index...");
        try {
          await index.build(workspaceDir);
          api.logger.info(`Skill router: indexed ${index.skillCount} skills`);
        } catch (err) {
          api.logger.warn(`Skill router: failed to build initial index: ${err}`);
        }
      }
    },
    stop: () => {
      api.logger.info("Skill router: stopped");
    },
  });

  api.logger.info("Skill router: registered (before_prompt_build hook)");
}
