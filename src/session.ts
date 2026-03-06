// ---------------------------------------------------------------------------
// In-memory session state tracking for graduated disclosure
// ---------------------------------------------------------------------------

export class SessionTracker {
  private shownRules: Map<string, Set<string>> = new Map();

  hasRuleBeenShown(sessionId: string, location: string): boolean {
    return this.shownRules.get(sessionId)?.has(location) ?? false;
  }

  markRuleShown(sessionId: string, location: string): void {
    let set = this.shownRules.get(sessionId);
    if (!set) {
      set = new Set();
      this.shownRules.set(sessionId, set);
    }
    set.add(location);
  }

  /** Clear state for a session (e.g., on disconnect). */
  clearSession(sessionId: string): void {
    this.shownRules.delete(sessionId);
  }
}
