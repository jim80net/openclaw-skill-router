import type { SkillIndex } from "./skill-index.ts";
import type { SkillRouterConfig } from "./config.ts";
import type { SessionTracker } from "./session.ts";
import type { IndexedSkill, PluginLogger } from "./types.ts";
import type { TraceAccumulator } from "./traces.ts";
import { extractUserMessage } from "./prompt-extractor.ts";
import { loadTelemetry, saveTelemetry, recordMatch } from "./telemetry.ts";

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

// ---------------------------------------------------------------------------
// Disclosure formatting
// ---------------------------------------------------------------------------

function formatRule(
  skill: IndexedSkill,
  relevance: string,
  content: string,
  isReminder: boolean
): string {
  if (isReminder) {
    const reminder = skill.oneLiner || skill.description;
    return `## Rule reminder: ${skill.name} (relevance: ${relevance})\n\n${reminder}`;
  }
  return `## Rule: ${skill.name} (relevance: ${relevance})\n\n${content}`;
}

function formatMemory(skill: IndexedSkill, relevance: string, content: string): string {
  return `## Recalled Memory: ${skill.name} (relevance: ${relevance})\n\n${content}`;
}

function formatSkillTeaser(skill: IndexedSkill, relevance: string): string {
  return (
    `## Available Skill: ${skill.name} (relevance: ${relevance})\n\n` +
    `**${skill.name}**: ${skill.description}\n\n` +
    `To use this skill, read the full instructions at: \`${skill.location}\``
  );
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export function createRouter(
  index: SkillIndex,
  config: SkillRouterConfig,
  logger: PluginLogger,
  sessionTracker: SessionTracker,
  traceAccumulator?: TraceAccumulator
) {
  return async (event: HookEvent, context: HookContext): Promise<HookResult> => {
    if (!config.enabled) return undefined;

    // Extract the user's actual message from OpenClaw's envelope
    const userMessage = extractUserMessage(event.prompt);

    // Skip heartbeat turns and empty messages
    if (userMessage.includes("HEARTBEAT_OK") || userMessage.length < 5) return undefined;

    // Rebuild index if stale
    if (index.needsRebuild() && context.workspaceDir) {
      try {
        await index.build(context.workspaceDir);
      } catch (err) {
        logger.warn(`Skill router: failed to build index: ${err}`);
        return undefined;
      }
    }

    // Search for matching skills using cleaned message
    let results;
    try {
      results = await index.search(
        userMessage,
        config.topK,
        config.threshold,
        config.types
      );
    } catch (err) {
      logger.warn(`Skill router: search failed: ${err}`);
      return undefined;
    }

    if (results.length === 0) return undefined;

    const sessionKey = context.sessionKey ?? "";
    const sessionId = context.sessionId ?? "";

    // Assemble content with type-specific disclosure
    let totalChars = 0;
    const sections: string[] = [];
    const counts = { rules: 0, memories: 0, skills: 0 };
    const injectedNames: string[] = [];

    for (const result of results) {
      const { skill, score } = result;
      const relevance = `${(score * 100).toFixed(0)}%`;

      let section: string;

      if (skill.type === "rule") {
        if (sessionId && sessionTracker.hasRuleBeenShown(sessionId, skill.location)) {
          section = formatRule(skill, relevance, "", true);
        } else {
          let content: string;
          try {
            content = await index.readSkillContent(skill.location);
          } catch (err) {
            logger.warn(`Skill router: failed to read ${skill.location}: ${err}`);
            continue;
          }
          section = formatRule(skill, relevance, content, false);
          if (sessionId) {
            sessionTracker.markRuleShown(sessionId, skill.location);
          }
        }
        counts.rules++;
      } else if (skill.type === "memory" || skill.type === "session-learning") {
        let content: string;
        try {
          content = await index.readSkillContent(skill.location);
        } catch (err) {
          logger.warn(`Skill router: failed to read ${skill.location}: ${err}`);
          continue;
        }
        section = formatMemory(skill, relevance, content);
        counts.memories++;
      } else {
        section = formatSkillTeaser(skill, relevance);
        counts.skills++;
      }

      if (totalChars + section.length > config.maxInjectedChars) break;

      sections.push(section);
      injectedNames.push(skill.name);
      totalChars += section.length;
    }

    if (sections.length === 0) return undefined;

    const prependContext = [
      "The following was automatically loaded based on semantic relevance to your message:",
      "",
      ...sections,
      "",
      "---",
      "",
    ].join("\n");

    // Log breakdown
    const parts: string[] = [];
    if (counts.rules > 0) parts.push(`${counts.rules} rule${counts.rules > 1 ? "s" : ""}`);
    if (counts.skills > 0)
      parts.push(`${counts.skills} skill${counts.skills > 1 ? "s" : ""}`);
    if (counts.memories > 0)
      parts.push(`${counts.memories} memor${counts.memories > 1 ? "ies" : "y"}`);
    logger.info(
      `Skill router: injected ${parts.join(" + ")} (${totalChars} chars) for: ${JSON.stringify(userMessage.slice(0, 80))}`
    );

    // Record telemetry (fire-and-forget)
    if (sessionKey) {
      loadTelemetry()
        .then((telemetry) => {
          for (const result of results) {
            recordMatch(telemetry, result.skill.location, sessionKey);
          }
          return saveTelemetry(telemetry);
        })
        .catch(() => {
          // Telemetry is best-effort
        });
    }

    // Record trace data
    if (traceAccumulator && sessionKey) {
      traceAccumulator.recordInjection(
        sessionKey,
        context.agentId ?? "unknown",
        injectedNames
      );
    }

    return { prependContext };
  };
}
