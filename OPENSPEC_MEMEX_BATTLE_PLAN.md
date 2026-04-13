# OpenSpec Proposal: Memex Positioning and Product Battle Plan vs Gbrain

## Status
Draft proposal for review

## Problem
Memex has a stronger architectural position than Gbrain in some important ways, but it currently loses the narrative war.

Gbrain presents as a complete product:
- personal AI knowledge brain
- compounding memory loop
- clear ingestion story
- obvious user-facing magic

Memex presents more like infrastructure:
- semantic skill router
- prompt injection middleware
- context activation layer

That makes Memex easy to underestimate, even when its core primitives are more strategically valuable inside OpenClaw.

## Decision
Do not reposition Memex as a direct Gbrain clone.

Instead, position Memex as the **knowledge activation layer for agents**:
- not just memory storage
- not just retrieval
- the system that decides what wakes up, when, and why

Core framing:
- Gbrain = knowledge substrate / personal AI brain
- Memex = runtime intelligence layer that activates knowledge, rules, workflows, and behaviors

This proposal recommends building the product and messaging around that distinction.

## Thesis
Memex wins if it becomes the control plane for agent cognition.

That means:
1. stronger product language
2. clearer user-facing artifacts
3. better compiled views of current truth
4. first-class entities and freshness
5. explainable activation and traceability
6. workflow activation, not only snippet retrieval

## Brutal assessment

### Where Gbrain is ahead
1. Packaging
   - clearer story
   - more emotionally legible
   - easier to demo

2. Knowledge ingestion narrative
   - meetings, email, calendar, voice, ideas
   - obvious compounding loop

3. Product framing
   - feels like a thing people want immediately
   - “your AI knows your life” is sticky

4. Maintenance story
   - dream cycle
   - sync cadence
   - compiled truth patterns

### Where Memex is ahead
1. Runtime-native integration
   - plugs directly into OpenClaw prompt construction
   - influences behavior at execution time

2. Multi-agent architecture
   - shared memory propagation across agents
   - more natural fit for agent ecosystems than single-user brain framing

3. Knowledge types
   - skills, memories, rules, workflows, session-learnings
   - richer than a plain note corpus

4. Graduated disclosure
   - more efficient than dumping large context blobs
   - better fit for constrained context windows

5. Telemetry and traces
   - can explain what fired and why
   - opens the door to optimization loops

### Where Memex is weak right now
1. Weak one-line value prop
2. Reads as plumbing, not magic
3. Limited visible output artifacts for users
4. No strong “compiled truth” surface
5. Workflow activation story is implied, not explicit
6. Freshness, verification, and conflict handling are not first-class in the product story

## Strategic position
Memex should not compete on “who has the bigger second brain.”

Memex should compete on:
- agent judgment
- context precision
- workflow activation
- explainability
- multi-agent coordination

### Proposed positioning statement
Memex gives agents judgment, not just memory.

Alternative:
- The knowledge activation layer for OpenClaw agents
- The control plane for agent context
- The runtime that decides what your agent should remember right now

## Proposed scope

### Phase 1: Messaging and product framing
Goal: make Memex legible and compelling.

Deliverables:
1. README rewrite
   - lead with outcome, not architecture
   - explain activation vs storage
   - include side-by-side examples

2. Homepage/repo tagline rewrite
   - remove “semantic router” first impression as primary framing
   - keep it as technical detail lower down

3. Demo narrative
   - show same task with and without Memex
   - show activation of rules, skills, and memories in context
   - show why less context can produce better behavior

4. “Why Memex is not RAG” section
   - distinguish from note search and vector retrieval wrappers

### Phase 2: User-visible artifacts
Goal: make the value inspectable.

Deliverables:
1. Activation trace viewer
   - what matched
   - what got injected
   - why
   - what was suppressed

2. Compiled truth view
   - current synthesis
   - evidence trail
   - timestamps
   - confidence/freshness indicators

3. Query hit analytics
   - what types of knowledge fire most
   - dead skills / noisy rules / stale memories

### Phase 3: Better cognition primitives
Goal: widen the moat.

Deliverables:
1. Entity-aware routing
   - people, companies, projects, tickers, systems as first-class objects

2. Freshness model
   - hot, warm, stale, disputed, verified

3. Conflict-aware memory handling
   - contradictory memories should surface as conflict, not silent winner-take-all

4. Workflow activation
   - not just inject knowledge, but suggest or trigger procedural modes when confidence is high

5. Post-turn learning loop
   - use traces and outcomes to adjust boosts, thresholds, and routing quality over time

### Phase 4: Multi-agent control plane
Goal: own the high ground.

Deliverables:
1. Cross-agent propagation dashboard
2. Shared-memory governance patterns
3. Agent-specific routing policies
4. Task-mode activation across agent fleets

## What to steal from Gbrain immediately
1. Brain-first lookup doctrine
2. Compiled truth + timeline UX
3. Better ingestion playbooks
4. Dream-cycle language and maintenance framing
5. Stronger compounding narrative
6. Better “install me and feel value quickly” onboarding

## What not to copy
1. Do not turn Memex into a generic second-brain clone
2. Do not bury the multi-agent edge
3. Do not reduce the project to note ingestion and vector search
4. Do not overfit to a single-person CRM/lifelogging story

## Proposed roadmap

### 0-30 days
- Rewrite README and repo positioning
- Add explicit “activation trace” docs/screenshots
- Publish a Memex vs RAG vs Gbrain comparison doc
- Add a basic compiled-truth concept note

### 30-60 days
- Build trace viewer / inspectability surface
- Add freshness metadata in memory model
- Introduce entity-aware routing design
- Improve telemetry summaries

### 60-90 days
- Implement compiled truth objects
- Implement conflict surfacing
- Add workflow activation hooks
- Package one opinionated end-to-end demo

## Success criteria
1. A new user can explain Memex in one sentence after reading the README
2. The project clearly differentiates from generic RAG memory systems
3. Users can inspect why a memory or skill activated
4. Memex demonstrates value in a multi-agent OpenClaw deployment
5. Public narrative shifts from “routing plugin” to “agent cognition layer”

## Risks
1. Over-positioning without shipping user-visible artifacts
2. Trying to out-Gbrain Gbrain instead of owning a distinct category
3. Adding too much complexity before improving clarity
4. Building features that are technically elegant but invisible to users

## Recommendation
Keep Memex. Do not divest.

But stop selling it like a retrieval utility.

Build and present it as the runtime intelligence layer that turns memory into judgment.

That is the winning position.

## PR scope for this proposal
This proposal PR should include:
- this battle plan document
- optional README edits if we want to start the repositioning immediately

This proposal PR should not yet include:
- large code changes
- schema migrations
- telemetry redesign
- UX implementation

Those should follow as separate implementation PRs after proposal approval.
