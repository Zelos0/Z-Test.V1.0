# SPINE framework

- SPINE is a highly performant AGENTS.md hierarchy installed here
- Agent must follow SPINE instructions across any edits

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it

## Read Before Editing

1. Read the root AGENTS.md
2. Identify every file or folder you expect to touch
3. Walk from the repository root to each target path
4. Read every AGENTS.md found along each route
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken SPINE

Do not rely on memory. Re-read the applicable SPINE chain in the current session before editing.

## Update After Editing

Every meaningful change requires a SPINE pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the SPINE pass still must happen.

## Hierarchy

- Root AGENTS.md is the SPINE root: project-wide instructions, global preferences, durable workflow rules, and the top-level Child SPINE Index
- Child AGENTS.md files own domain-specific instructions and their own Child SPINE Index
- Each parent explains what its direct children cover and what stays owned by the parent
- The closer a doc is to the work, the more specific and practical it must be

## Child Doc Shape

- Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards
- Work Guidance must reflect the current standards of the project or user instructions; if there are no specific standards or instructions yet, leave it empty
- Verification must reflect an existing check; if no verification framework exists yet, leave it empty and update it when one exists

Default section order:
- Purpose
- Ownership
- Local Contracts
- Work Guidance
- Verification
- Child SPINE Index

Optional sections — add only when the domain actually needs them (see SPINE Extensions below): Risk Tier (at the very top, right under the title), Decisions, Footguns, Rollback.

## Style

- Keep docs concise, current, and operational
- Document stable contracts, not diary entries
- Put broad rules in parent docs and concrete details in child docs
- Prefer direct bullets with explicit names
- Do not duplicate rules across many files unless each scope needs a local version
- Delete stale notes instead of explaining history
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist

## Closeout

1. Re-check changed paths against the SPINE chain
2. Update nearest owning docs and any affected parents or children
3. Refresh every affected Child SPINE Index
4. Remove stale or contradictory text
5. Run existing verification when relevant
6. Report any docs intentionally left unchanged and why

# SPINE Extensions (Project Hardening)

These extensions strengthen SPINE. They never weaken the core contract above.

Further optional hardening modules (Rejected Approaches, Data-Migration-
Contract, Confidence-Flags, Freshness-Marker, Verification Ladder, Known
Flaky/Slow Tests, Perf-Budget, AI-Provider-Contract, Secrets/Env-Map,
Dependency-Pin-Contract, Agent-Handoff-Notiz, Claim/Lock-Hinweis, YAML-
Frontmatter, Glossary) live in `EXTENSIONS.md`. Adopt one only when its
trigger condition applies — do not paste the whole file into a project.

## Scope Limits

- Never create AGENTS.md in: node_modules, .next, .git, dist, build, out,
  coverage, .turbo, .vercel, .cache, .pnpm-store, generated output folders,
  or any gitignored path
- Never document lockfiles, build artifacts, or temp files (*.tmp.*)
- Default tree depth is 4 levels from repo root. Going deeper is allowed
  when a deeper folder is a real domain boundary or marked CRITICAL —
  state the reason in the parent's Child SPINE Index when you do
- One folder = one domain. If a folder is just a bucket of unrelated
  files, document it in the parent instead of splitting

## Importance-First Rule

File count alone never decides whether a folder gets its own AGENTS.md.
Create a child AGENTS.md — even for a single file — when ANY of these hold:

- the folder contains security, auth, payment, or data-integrity logic
- the code has non-obvious side effects, env dependencies, or ordering rules
- breaking it would silently corrupt data or break production
- it is rarely touched but essential (easy to forget as the project grows)
- it defines a contract other parts of the codebase depend on

Mark such docs with a first line: `> CRITICAL — read fully before any edit.`
Conversely, do NOT create a child AGENTS.md for folders of trivial,
self-explanatory files (assets, icons, simple types) regardless of count.

## Risk Tier

- Every child AGENTS.md that touches security, auth, payment, migrations, or
  other data-integrity logic states a Risk Tier at the very top, right under
  the title: `Risk: low | medium | high`
- High tier means: extra verification before merging, explicit confirmation
  before any destructive step, no silent refactors
- Low tier means: normal caution, no extra ceremony
- Set the tier when the doc is created; revisit it only when the folder's
  responsibility genuinely changes — do not let it drift into busywork

## Decision Log

- Record non-obvious decisions as one-line entries in the owning AGENTS.md
  under a `## Decisions` heading: `<choice> instead of <alternative> — why: <reason>`
- Never silently reverse a logged decision. If new information overturns it,
  add a new dated entry — don't delete the old one until it is clearly obsolete
- This exists to stop an agent from "helpfully" undoing a deliberate choice
  it wasn't there for

## Known Footguns

- Maintain a `## Footguns` list per AGENTS.md for traps that are not obvious
  from reading the code: silent breakage, ordering requirements, non-obvious
  side effects
- Format: `<action> breaks <consequence> — because <mechanism>`
- Add an entry the moment you discover or cause one — do not wait for a
  dedicated cleanup pass

## Rollback Recipe

- For any domain where a bad change is expensive to detect late (migrations,
  deploys, generated artifacts), document the exact undo command in that
  AGENTS.md under `## Rollback`
- A Rollback Recipe is a runnable command, not advice — `npm run migrate:down`,
  not "undo the migration"
- If no safe rollback exists for a domain, say so explicitly — that absence
  is information the agent needs before acting

## Drift Guard

- Before editing any source file, state in one line which AGENTS.md chain
  you read and whether it matched the current code
- If a doc describes contracts that no longer match the code, STOP and
  report the mismatch before editing — never silently "fix" docs to match
  broken code or vice versa
- After editing, explicitly confirm: which AGENTS.md updated, which
  Child SPINE Index refreshed, or "docs unchanged because <reason>"

## Index Integrity

- A Child SPINE Index entry must exist for every child AGENTS.md, and every
  index entry must point to a file that exists — no orphans, no dead links
- When moving, renaming, or deleting folders, update the affected indexes
  in the same task, never "later"
- On `SPINE audit` request: walk the full tree, report orphans, dead links,
  stale contracts, and undocumented critical folders

## Compaction Rule

- Each AGENTS.md should stay under ~80 lines. If it grows beyond that,
  either split the domain or move detail into a child doc
- Prefer one precise sentence over three vague ones
- An AGENTS.md that restates what the code obviously says is noise — delete it

## Session Discipline

- After context compaction or a new session, re-read the SPINE chain before
  the next edit; never trust summarized memory of contracts
- When the user gives an instruction that contradicts a doc, ask once
  whether to update the doc — do not leave docs and behavior diverged

## Verification Hook

- Every AGENTS.md Verification section must name exact runnable commands,
  not vague advice ("run tests" is invalid, `npm run typecheck` is valid)
- Run the nearest applicable verification after every meaningful edit
- If no verification exists for a domain yet, say so in Closeout

## User Preferences

When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md

- Kommunikation und alle sichtbaren Texte auf Deutsch
- Ziel-Rechner ist Windows; Projekte und Caches gehören auf Laufwerk `H:`
- UIs sollen hochwertig und eigenständig wirken, nicht generisch

# Projekt: Z-Test.V1.0

Zwei Teile: die statische Zelos-Webseite im Root (`index.html`, `styles.css`,
`script.js`) und der lokale Projekt-Hub in `projekt-hub/` (eigener Vertrag,
siehe Child SPINE Index).

## Invariants

Invariant-Check (Referenz: `.claude/skills/invariant-check/SKILL.md`). Der
Trigger — Multi-Agent-/Subagent-Pipeline mit prüfbarer Größe — trifft hier
noch nicht zu; Tabelle bleibt Vorlage, bis eine solche Pipeline existiert.

| Name | Erwartung | Checkpoint A | Checkpoint B | Toleranz |
|---|---|---|---|---|
| (noch keine) | — | — | — | — |

## Session Snapshot

- `.snapshot/HOT.md` = aktueller Stand (Fokus, letzter Schritt, nächster
  Schritt, Blocker), < ~500 Tokens, wird am Sessionende ÜBERSCHRIEBEN
- Vorher alten Stand in 1–2 Zeilen datiert an `.snapshot/ARCHIVE.md` anhängen
- Wiedereinstieg: zuerst nur HOT.md lesen, dann Decisions, erst dann die volle SPINE-Kette

## Cache Contract

Nicht zutreffend: dieses Repo ruft weder Claude API noch Agent SDK direkt
auf. Abschnitt füllen (Breakpoints, TTL, Modellwechsel-Regel), sobald das
passiert.

## Decisions

- 2026-11-13: Alt-Dateien per `git mv` umbenannt (`struktur`→`index.html`, `css`→`styles.css`, `java glitch`→`script.js`) statt Links auf die Namen ohne Endung umzubiegen — warum: HTML referenzierte `styles.css`, Hosting erwartet `index.html`, Nutzer hat Überarbeitung des Ganzen beauftragt
- 2026-11-13: Pattern-Index (PATTERN-INDEX.md) vor dem Neubau des Projekt-Hubs geprüft — kein passendes Pattern (vorhanden: Rust-FFI-Bridge, Cloudflare-Tunnel); Neubau

## Footguns

- `script.js` ohne `<script>`-Tag in `index.html` einbinden vergessen bricht den Nav-Glitch still — weil `styles.css` nur die Klasse `.glitch-effect` definiert, die das Skript setzt
- `<h2>` ohne `data-text` bricht den Überschriften-Glitch still — weil `.section h2:before` `content: attr(data-text)` nutzt

## Rollback

- Umbenennung der Webseite zurück: `git mv index.html struktur && git mv styles.css css && git mv script.js "java glitch"`

## Child SPINE Index

- `projekt-hub/AGENTS.md` — CRITICAL, Risk medium: lokaler Node-Server (127.0.0.1), der Projektordner scannt, Git-Befehle ausführt und Konsolen/Claude Code startet; plus Windows-Installer, der Benutzer-Umgebungsvariablen setzt
- Root behält: Webseite (`index.html`, `styles.css`, `script.js`), SPINE-Docs, `.snapshot/`, `.claude/skills/`
