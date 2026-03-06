import type { SkillIndex } from "./skill-index.ts";
import type { SkillRouterConfig } from "./config.ts";

export type PluginLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

type HookEvent = {
  prompt: string;
  messages: unknown[];
};

type HookContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: unknown;
};

type HookResult = { prependContext: string } | undefined;

export function createRouter(
  index: SkillIndex,
  config: SkillRouterConfig,
  logger: PluginLogger
) {
  return async (event: HookEvent, context: HookContext): Promise<HookResult> => {
    if (!config.enabled) return undefined;

    // Skip heartbeat turns — the prompt contains HEARTBEAT_OK for both
    // the built-in heartbeat and cron jobs that use the heartbeat ack pattern
    if (event.prompt.includes("HEARTBEAT_OK")) return undefined;

    // Rebuild index if stale
    if (index.needsRebuild() && context.workspaceDir) {
      try {
        await index.build(context.workspaceDir);
      } catch (err) {
        logger.warn(`Skill router: failed to build index: ${err}`);
        return undefined;
      }
    }

    // Search for matching skills
    let results;
    try {
      results = await index.search(event.prompt, config.topK, config.threshold);
    } catch (err) {
      logger.warn(`Skill router: search failed: ${err}`);
      return undefined;
    }

    if (results.length === 0) return undefined;

    // Read and assemble skill content
    let totalChars = 0;
    const sections: string[] = [];

    for (const result of results) {
      let content: string;
      try {
        content = await index.readSkillContent(result.skill.location);
      } catch (err) {
        logger.warn(`Skill router: failed to read ${result.skill.location}: ${err}`);
        continue;
      }

      if (totalChars + content.length > config.maxInjectedChars) break;

      sections.push(
        `## Auto-loaded Skill: ${result.skill.name} (relevance: ${(result.score * 100).toFixed(0)}%)\n\n**${result.skill.name}**: ${result.skill.description}\n\n${content}`
      );
      totalChars += content.length;
    }

    if (sections.length === 0) return undefined;

    const prependContext = [
      "The following skills were automatically loaded based on your message:",
      "",
      ...sections,
      "",
      "---",
      "",
    ].join("\n");

    logger.info(`Skill router: injected ${sections.length} skills (${totalChars} chars)`);

    return { prependContext };
  };
}
