import { resolveConfig } from "./config.ts";
import { SkillIndex } from "./skill-index.ts";
import { createRouter } from "./router.ts";
import { SessionTracker } from "./session.ts";
import { TraceAccumulator } from "./traces.ts";
import { OpenAIEmbeddingProvider, LocalEmbeddingProvider } from "./embeddings.ts";
import type { EmbeddingProvider } from "./embeddings.ts";
import type { PluginLogger } from "./types.ts";

type OpenClawConfig = {
  workspace?: {
    dir?: string;
  };
};

type OpenClawPluginApi = {
  id: string;
  config: OpenClawConfig;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  on: (
    event: string,
    handler: (...args: unknown[]) => unknown,
    opts?: unknown
  ) => void;
  registerService: (service: { id: string; start: () => Promise<void>; stop: () => void }) => void;
};

// ---------------------------------------------------------------------------
// Hook event/context types
// ---------------------------------------------------------------------------

type PromptBuildEvent = {
  prompt: string;
  messages: unknown[];
};

type PromptBuildContext = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: unknown;
};

type ToolCallEvent = {
  toolName: string;
  toolInput?: Record<string, unknown>;
  sessionKey?: string;
};

type ToolCallContext = {
  agentId?: string;
  sessionKey?: string;
};

type AgentEndEvent = {
  sessionKey?: string;
  agentId?: string;
  messageCount?: number;
  error?: string;
  outcome?: string;
};

// ---------------------------------------------------------------------------
// Tool guidance query builder
// ---------------------------------------------------------------------------

function buildToolQuery(toolName: string, toolInput?: Record<string, unknown>): string {
  if (!toolInput) return `using ${toolName} tool`;

  // Extract context based on tool type
  let context = "";
  switch (toolName) {
    case "exec":
      context = typeof toolInput.command === "string" ? toolInput.command.slice(0, 200) : "";
      break;
    case "Read":
    case "Write":
    case "Edit":
      context = typeof toolInput.file_path === "string" || typeof toolInput.path === "string"
        ? String(toolInput.file_path ?? toolInput.path)
        : "";
      break;
    case "message":
      context = typeof toolInput.action === "string" ? `${toolInput.action}` : "";
      if (typeof toolInput.channel === "string") context += ` on ${toolInput.channel}`;
      break;
    case "web_search":
    case "web_fetch":
      context = typeof toolInput.query === "string" || typeof toolInput.url === "string"
        ? String(toolInput.query ?? toolInput.url).slice(0, 200)
        : "";
      break;
    case "sessions_spawn":
      context = typeof toolInput.task === "string" ? toolInput.task.slice(0, 200) : "";
      break;
    default:
      // Generic: use first string value
      for (const val of Object.values(toolInput)) {
        if (typeof val === "string" && val.length > 3) {
          context = val.slice(0, 200);
          break;
        }
      }
  }

  return context ? `using ${toolName}: ${context}` : `using ${toolName} tool`;
}

// ---------------------------------------------------------------------------
// Plugin entry point
// ---------------------------------------------------------------------------

export default function register(api: OpenClawPluginApi): void {
  const config = resolveConfig(api.pluginConfig);

  if (!config.enabled) {
    api.logger.info("Skill router disabled");
    return;
  }

  // Create embedding provider (local ONNX by default, zero API cost)
  let provider: EmbeddingProvider;
  if (config.embeddingBackend === "openai") {
    const apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) {
      api.logger.warn("Skill router: openai backend selected but no OPENAI_API_KEY, falling back to local");
      provider = new LocalEmbeddingProvider(config.embeddingModel);
    } else {
      provider = new OpenAIEmbeddingProvider(config.embeddingModel, apiKey);
      api.logger.info(`Skill router: using OpenAI embeddings (${config.embeddingModel})`);
    }
  } else {
    provider = new LocalEmbeddingProvider(config.embeddingModel);
    api.logger.info(`Skill router: using local ONNX embeddings (${config.embeddingModel})`);
  }

  const index = new SkillIndex(config, provider);
  const sessionTracker = new SessionTracker();
  const traceAccumulator = new TraceAccumulator();
  const router = createRouter(index, config, api.logger, sessionTracker, traceAccumulator);

  // --- Hook: before_prompt_build ---
  // Main hook: semantic skill routing per-turn
  api.on("before_prompt_build", async (event: unknown, context: unknown) => {
    return router(event as PromptBuildEvent, context as PromptBuildContext);
  });

  // --- Hook: before_tool_call ---
  // Inject tool-specific guidance when a tool is about to fire
  api.on("before_tool_call", async (event: unknown, context: unknown) => {
    const toolEvent = event as ToolCallEvent;
    const toolContext = context as ToolCallContext;
    const toolName = toolEvent.toolName;
    if (!toolName) return undefined;

    // Record tool call in trace
    const sessionKey = toolContext.sessionKey ?? toolEvent.sessionKey ?? "";
    if (sessionKey) {
      traceAccumulator.recordToolCall(sessionKey, toolName);
    }

    // Only search for tool-guidance type skills
    if (!config.enabled || !index.skillCount) return undefined;

    const query = buildToolQuery(toolName, toolEvent.toolInput);

    try {
      const results = await index.search(
        query,
        2, // Max 2 tool guidances per call
        config.threshold + 0.1, // Higher threshold for tool guidance (less noise)
        ["tool-guidance"]
      );

      if (results.length === 0) return undefined;

      let totalChars = 0;
      const sections: string[] = [];

      for (const result of results) {
        let content: string;
        try {
          content = await index.readSkillContent(result.skill.location);
        } catch {
          continue;
        }

        if (totalChars + content.length > 4000) break;

        sections.push(
          `## Tool Guidance: ${result.skill.name} (relevance: ${(result.score * 100).toFixed(0)}%)\n\n${content}`
        );
        totalChars += content.length;
      }

      if (sections.length === 0) return undefined;

      api.logger.info(
        `Skill router[tool]: injected ${sections.length} guidance(s) for ${toolName} (${totalChars} chars)`
      );

      return { prependContext: sections.join("\n\n---\n\n") };
    } catch (err) {
      api.logger.warn(`Skill router[tool]: search failed: ${err}`);
      return undefined;
    }
  });

  // --- Hook: agent_end ---
  // Capture execution traces for GEPA-style evolution
  api.on("agent_end", async (event: unknown) => {
    const endEvent = event as AgentEndEvent;
    const sessionKey = endEvent.sessionKey ?? "";
    if (!sessionKey) return;

    if (endEvent.messageCount) {
      traceAccumulator.recordMessageCount(sessionKey, endEvent.messageCount);
    }

    const outcome = endEvent.error
      ? "error"
      : endEvent.outcome === "timeout"
        ? "timeout"
        : "completed";

    try {
      const trace = await traceAccumulator.finalize(
        sessionKey,
        outcome,
        endEvent.error
      );
      if (trace && trace.skillsInjected.length > 0) {
        api.logger.info(
          `Skill router[trace]: ${sessionKey} — ${trace.outcome}, skills=[${trace.skillsInjected.join(",")}], tools=${trace.toolsCalled.length}, msgs=${trace.messageCount}`
        );
      }
    } catch (err) {
      api.logger.warn(`Skill router[trace]: failed to finalize: ${err}`);
    }
  });

  // --- Service: index builder ---
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

  // Periodic cleanup of stale trace and session entries (every 30 min)
  const cleanupInterval = setInterval(() => {
    traceAccumulator.cleanup();
    sessionTracker.cleanup();
  }, 1800_000);

  // Unref so it doesn't prevent process exit
  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    (cleanupInterval as NodeJS.Timeout).unref();
  }

  api.logger.info("Skill router v0.5.0: registered (before_prompt_build + before_tool_call + agent_end hooks)");
}
