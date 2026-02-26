import { resolveConfig } from "./config.ts";
import { SkillIndex } from "./skill-index.ts";
import { createRouter } from "./router.ts";

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
    handler: (event: any, context: any) => unknown,
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

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    api.logger.warn("Skill router: no OPENAI_API_KEY found, disabling");
    return;
  }

  const index = new SkillIndex(config, apiKey);
  const router = createRouter(index, config, api.logger);

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
