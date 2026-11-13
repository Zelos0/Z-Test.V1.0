# SPINE Extension-Pack (opt-in hardening modules)

These are optional. Adding all of them to every project would violate SPINE's
own Compaction Rule — most projects need two or three, not fourteen. Adopt a
module only when its trigger condition actually applies.

## Activation

Add one line to the root `CLAUDE.md`: `Active SPINE Extensions: <module names>`.
Then copy only the relevant module's contract into the doc it names below —
don't paste this whole file into a project.

---

## Institutional Memory

### Rejected Approaches
**Trigger:** a domain has been redesigned more than once, or an agent could
plausibly re-suggest something already tried.
**Add to:** owning AGENTS.md, `## Rejected Approaches`.
- One line per approach: `<approach> — tried, rejected because <reason>`
- Don't delete an entry just because it's old; only remove it once the
  subsystem it applied to no longer exists

### Data-Migration-Contract
**Trigger:** any domain with a persistent schema (SQL, SQLite, NoSQL
collections) that survives across deploys.
**Add to:** the AGENTS.md owning the storage layer, `## Migration Contract`.
- Name the exact migration mechanism — ban ad hoc schema drift explicitly,
  e.g. `CREATE TABLE IF NOT EXISTS` is not a valid way to apply a schema change
- State whether migrations are forward-only or reversible, and where the
  rollback command lives (pairs with the Core-Set Rollback Recipe)

## Trust Calibration

### Confidence-Flags
**Trigger:** a domain has parts verified by tests/production and parts that
are still speculative.
**Add to:** inline, no new heading needed.
- Mark sections `✅ battle-tested` or `⚠️ unverified`
- Treat ⚠️ sections as lower-trust: verify before relying on them, don't
  propagate their assumptions elsewhere without a check

### Freshness-Marker
**Trigger:** a fast-moving domain where code changes faster than the doc
gets reviewed.
**Add to:** top of the AGENTS.md, one line: `Last verified: <date>`.
- Update the date every time a SPINE pass confirms the doc still matches
  the code
- A stale-looking date is a signal to verify against code before trusting
  the doc, not to read and go

## Verification & Performance

### Verification-Leiter (Verification Ladder)
**Trigger:** the project has more than one verification tier (e.g. a fast
lint/typecheck and a slow full test suite).
**Add to:** root `CLAUDE.md`, Commands section.
- Define at least two tiers: `Quick` (after every edit) and `Full` (before
  closeout / large changes)
- State the size/risk threshold that upgrades a change from Quick to Full

### Known Flaky/Slow Tests
**Trigger:** the project has any test suite.
**Add to:** the AGENTS.md owning the test suite, `## Flaky/Slow Tests`.
- One line per test: `<test name> — flaky because <reason>` or `slow because <reason>`
- Check this list before concluding a failing test means the change broke something

### Perf-Budget
**Trigger:** a domain has a measurable performance constraint (bundle size,
query count, latency, memory).
**Add to:** owning AGENTS.md, `## Perf Budget`.
- State a number and a check command, not a vague target:
  `Bundle ≤ 250kb gzipped — npm run build:analyze`
- Treat a budget breach as blocking, not a note for later

## Provider & Environment

### AI-Provider-Contract
**Trigger:** the project integrates any LLM/AI provider (subscription SDK,
API key, local model server, media-gen API, etc.).
**Add to:** root AGENTS.md, or a dedicated child doc if multiple providers exist,
`## AI Provider Contract`.
- Name each provider, its auth mode (subscription vs API key vs local), and
  the model IDs in use
- State which is the default and why (cost, capability, latency)
- Never silently swap a provider or model ID without updating this contract

### Secrets/Env-Map
**Trigger:** any project with `.env` or equivalent secrets config.
**Add to:** root AGENTS.md, `## Env Map`.
- List every env var name, required vs optional, and its purpose — never its value
- A new env var requires an entry here in the same change that introduces it

### Dependency-Pin-Contract
**Trigger:** any pinned/locked dependency version that was pinned for a
specific reason, not just "latest at install time."
**Add to:** owning AGENTS.md, `## Pinned Dependencies`.
- `<package>@<version> — pinned because <reason>, breaks if bumped: <what breaks>`
- Bumping a pinned dependency requires updating or removing this entry, not
  just editing the manifest

## Multi-Agent Coordination

### Agent-Handoff-Notiz
**Trigger:** work is paused mid-task and handed to a different session,
agent, or worktree.
**Add to:** nearest AGENTS.md, temporary `## In-Flight Handoff` section.
- State exactly what's incomplete, what was already verified, and the next
  concrete step
- Delete this section the moment the handoff is picked up and completed —
  it's scratch, not a permanent record (unlike Decision Log)

### Claim/Lock-Hinweis
**Trigger:** multiple agents or worktrees can touch the same folder concurrently.
**Add to:** top of the relevant AGENTS.md, one line: `Claimed by: <agent/branch>, since <timestamp>`.
- Check this line before starting work in a folder; if claimed by someone
  else, don't edit — coordinate or wait
- Clear the claim the moment the work is merged or finished

## Machine-Readable Hygiene

### YAML-Frontmatter
**Trigger:** the project has enough AGENTS.md files that a script — not
just an LLM — should be able to audit them.
**Add to:** top of every AGENTS.md, as YAML frontmatter.
- Minimal fields: `domain`, `risk` (mirrors Risk Tier), `last_verified`
  (mirrors Freshness-Marker)
- A missing or malformed frontmatter block is itself a SPINE Audit finding

### Glossar (Glossary)
**Trigger:** the project has recurring domain-specific terms that would
otherwise get redefined ad hoc in every child doc.
**Add to:** root AGENTS.md, `## Glossary`.
- One line per term: `<term> — <definition>`
- Child docs reference the term without redefining it; if a child doc needs
  a different definition, the term is overloaded — split it instead

---

<!-- Appended from MAX-ME/EXTENSIONS-ADD.md (START.md Schritt 3) -->

## Agent-Pipeline Integrity

### Invariant-Check
**Trigger:** the project runs multi-agent/subagent pipelines where a quantity
(token budget, cost, subagent count, carried-over state) should stay constant
or move predictably between checkpoints.
**Add to:** owning AGENTS.md, `## Invariants`.
- List each invariant as one line: `<name> — expected constant/bound between
  <checkpoint A> and <checkpoint B>, tolerance <value>`
- Before a full trace analysis, check ONLY the checkpoint values first. All
  invariants hold → no further analysis needed. One breaks → analyze only the
  span between the last good and first bad checkpoint, not the full trace
- Document known, intentional exceptions (e.g. retry paths) inline so they
  aren't flagged as false positives
- Log real bug findings from this check as a dated `## Known Footguns` entry,
  not just here

### Prompt-Cache-Contract
**Trigger:** the project calls the Claude API or Agent SDK directly (not only
via claude.ai/Claude Code's own managed session) with repeated multi-turn
context.
**Add to:** root AGENTS.md or CLAUDE.md, `## Cache Contract`.
- State what sits before each cache breakpoint (tools → system → stable
  context) and confirm it is byte-identical across calls — no timestamps,
  session IDs, or reordered tool lists ahead of a breakpoint
- Name the TTL choice (5 min default vs. 1 hour) and why
- State the model-switch rule: a mid-context model change invalidates the
  cache for that model; route switches through a compact handoff message,
  not a raw context carryover
- Log `cache_creation_input_tokens` / `cache_read_input_tokens` from real
  calls here once available — treat near-zero cache reads as a signal to
  re-check prefix stability, not to remove the breakpoint

## Cross-Session Continuity

### Session-Snapshot-Contract
**Trigger:** work on this project is routinely paused for hours, days, or
weeks (parallel multi-project work), and re-deriving context from full
history on resume is expensive.
**Add to:** root AGENTS.md, `## Session Snapshot`. Extends, does not replace,
Session Discipline in the core contract.
- Maintain a `.snapshot/HOT.md` (current focus, last completed step, next
  step, open blockers — target under ~500 tokens) that is OVERWRITTEN at
  session end, not appended to
- Before overwriting, compress the outgoing HOT.md content into 1-2 lines
  and append it, dated, to `.snapshot/ARCHIVE.md` — read only on demand
- Permanent, rarely-changing facts belong in the existing Decision Log, not
  in HOT.md or ARCHIVE.md
- On resume after any gap: read HOT.md only first; consult ARCHIVE.md or the
  Decision Log only if HOT.md is insufficient for the next step
