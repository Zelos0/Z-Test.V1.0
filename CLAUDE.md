# CLAUDE.md — Personal (SPINE)

@AGENTS.md

## Project

- Name: Z-Test.V1.0 — Zelos-Webseite + Projekt-Hub
- Stack: statische Webseite (HTML/CSS/JS, Root) · Projekt-Hub: Node ≥ 18 ohne Abhängigkeiten,
  Vanilla HTML/CSS/JS, Windows-PowerShell-5.1-Installer (`projekt-hub/`)
- Package manager: keiner (kein `npm install` nötig)
- OS: Windows (use Windows-compatible commands, no `rm -rf`, prefer cross-env)

## Commands

- Dev (Hub): `node projekt-hub/app/server.js --open`
- Dev (Hub, Demo-Daten): `node projekt-hub/test/fixtures.js demo` dann `node projekt-hub/app/server.js --config demo/config.json --no-sync`
- Dev (Webseite): `index.html` im Browser öffnen
- Typecheck: entfällt (kein TypeScript) — Syntax: `node --check projekt-hub/app/server.js`
- Lint: entfällt (kein Linter konfiguriert)
- Test: `node --test projekt-hub/test/*.test.js`
- Build: entfällt (keine Build-Stufe)

Active SPINE Extensions: Invariant-Check, Prompt-Cache-Contract, Session-Snapshot-Contract

## Hard Rules

- Kein TypeScript, kein Bundler im Projekt-Hub — Vanilla JS mit `'use strict'`
- Extend existing helpers/modules before creating new ones — search first
- No new dependencies without asking (Projekt-Hub: grundsätzlich keine)
- Never touch `.env` values; reference `.env.example` for shape
- All user-facing text in German unless stated otherwise

## SPINE

- SPINE framework is active via @AGENTS.md — follow it on every edit
- Verification commands for this repo are listed under Commands above;
  use them as the default Verification in all child AGENTS.md files
