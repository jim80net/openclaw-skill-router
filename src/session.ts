// ---------------------------------------------------------------------------
// In-memory session state tracking for graduated disclosure
// ---------------------------------------------------------------------------

export class SessionTracker {
  private shownRules: Map<string, { rules: Set<string>; lastAccess: number }> = new Map();

  hasRuleBeenShown(sessionId: string, location: string): boolean {
    const entry = this.shownRules.get(sessionId);
    if (entry) entry.lastAccess = Date.now();
    return entry?.rules.has(location) ?? false;
  }

  markRuleShown(sessionId: string, location: string): void {
    let entry = this.shownRules.get(sessionId);
    if (!entry) {
      entry = { rules: new Set(), lastAccess: Date.now() };
      this.shownRules.set(sessionId, entry);
    }
    entry.lastAccess = Date.now();
    entry.rules.add(location);
  }

  /** Clear state for a session (e.g., on disconnect). */
  clearSession(sessionId: string): void {
    this.shownRules.delete(sessionId);
  }

  /** Remove sessions not accessed within maxAgeMs (default 1 hour). */
  cleanup(maxAgeMs: number = 3600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, entry] of this.shownRules) {
      if (entry.lastAccess < cutoff) {
        this.shownRules.delete(key);
      }
    }
  }
}
