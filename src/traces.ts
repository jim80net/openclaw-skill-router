// ---------------------------------------------------------------------------
// Execution trace capture for GEPA-style skill evolution
// ---------------------------------------------------------------------------

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ExecutionTrace = {
  sessionKey: string;
  agentId: string;
  timestamp: string;
  skillsInjected: string[]; // skill names that were injected this session
  toolsCalled: string[]; // tool names used
  messageCount: number;
  durationMs: number;
  outcome: "completed" | "error" | "timeout" | "unknown";
  errorSummary?: string;
};

const TRACES_DIR = join(homedir(), ".openclaw", "cache", "skill-router-traces");

export function getTracesDir(): string {
  return TRACES_DIR;
}

/**
 * Write an execution trace to disk.
 */
export async function writeTrace(trace: ExecutionTrace): Promise<void> {
  await mkdir(TRACES_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const sessionSlug = trace.sessionKey.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const filename = `${date}-${sessionSlug}.json`;
  const filepath = join(TRACES_DIR, filename);
  await writeFile(filepath, JSON.stringify(trace, null, 2), "utf-8");
}

/**
 * Accumulator for building traces across a session's lifecycle.
 * One per session, created on first hook fire, finalized on agent_end.
 */
export class TraceAccumulator {
  private traces: Map<
    string,
    {
      startTime: number;
      skillsInjected: Set<string>;
      toolsCalled: Set<string>;
      agentId: string;
      messageCount: number;
    }
  > = new Map();

  recordInjection(sessionKey: string, agentId: string, skillNames: string[]): void {
    let entry = this.traces.get(sessionKey);
    if (!entry) {
      entry = {
        startTime: Date.now(),
        skillsInjected: new Set(),
        toolsCalled: new Set(),
        agentId,
        messageCount: 0,
      };
      this.traces.set(sessionKey, entry);
    }
    for (const name of skillNames) {
      entry.skillsInjected.add(name);
    }
  }

  recordToolCall(sessionKey: string, toolName: string): void {
    const entry = this.traces.get(sessionKey);
    if (entry) {
      entry.toolsCalled.add(toolName);
    }
  }

  recordMessageCount(sessionKey: string, count: number): void {
    const entry = this.traces.get(sessionKey);
    if (entry) {
      entry.messageCount = count;
    }
  }

  async finalize(
    sessionKey: string,
    outcome: ExecutionTrace["outcome"],
    errorSummary?: string,
  ): Promise<ExecutionTrace | null> {
    const entry = this.traces.get(sessionKey);
    if (!entry) return null;

    const trace: ExecutionTrace = {
      sessionKey,
      agentId: entry.agentId,
      timestamp: new Date().toISOString(),
      skillsInjected: [...entry.skillsInjected],
      toolsCalled: [...entry.toolsCalled],
      messageCount: entry.messageCount,
      durationMs: Date.now() - entry.startTime,
      outcome,
      errorSummary,
    };

    this.traces.delete(sessionKey);

    // Only write traces for sessions that actually did something
    if (trace.messageCount > 2 || trace.toolsCalled.length > 0) {
      await writeTrace(trace);
    }

    return trace;
  }

  /**
   * Clean up stale entries (sessions that never got an agent_end).
   * Call periodically.
   */
  cleanup(maxAgeMs: number = 3600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, entry] of this.traces) {
      if (entry.startTime < cutoff) {
        this.traces.delete(key);
      }
    }
  }
}
