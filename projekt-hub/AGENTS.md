# projekt-hub

> CRITICAL — read fully before any edit.

Risk: medium

## Purpose

Lokales Dashboard (Windows, `http://127.0.0.1:4310`) für alle Projektordner unter den
konfigurierten Wurzeln (Standard `H:\Projekte`): SPINE-Status, `.snapshot/HOT.md`, Git,
Stack, 12-Wochen-Aktivität; Aktionen Explorer/Editor/Terminal/Claude Code/SPINE-Setup;
Sync (fetch + Fast-Forward) und Klonen fehlender GitHub-Repos. `install.ps1` legt
Projekt-, Cache- und App-Ordner auf H: an und leitet Paket-Caches nach `H:\DevCache` um.

## Ownership

- `app/server.js` — HTTP-Server, API, Sicherheitsprüfungen, Hintergrund-Jobs
- `app/lib/` — `scanner` (Projekterkennung), `git`, `sync` (fetch/ff/gh), `actions` (Prozessstart), `config`, `util`
- `app/public/` — UI (Vanilla HTML/CSS/JS, keine Build-Stufe)
- `install.ps1`, `uninstall.ps1`, `start-hidden.ps1`, `*.cmd` — Windows-Installation
- `test/` — `node:test`-Suite, Fixtures, Fake-`gh`

## Local Contracts

- Keine npm-Abhängigkeiten; nur Node-Bordmittel, Node ≥ 18
- Server bindet nur an `127.0.0.1`; jede `/api/*`-Anfrage (außer `/api/ping`) braucht
  `X-Hub-Token` (pro Start zufällig, ins HTML injiziert), erlaubten `Host` (DNS-Rebinding)
  und bei POST passenden `Origin`
- Aktionen nehmen nur Projekt-IDs aus dem letzten Scan, nie rohe Pfade
- Prozesse ohne Shell (`execFile`/`spawn`); `cmd.exe` nur für Editor/Konsole, Pfade vorher
  gegen `UNSAFE_SHELL_RE` geprüft
- Git: nur lesen, `fetch` und `merge --ff-only` bei sauberem Baum — nie Merge/Rebase/Reset;
  jeder Aufruf mit `-c core.fsmonitor=false`
- Dateiinhalte (HOT.md, README, Commits) in der UI nur per `textContent`, nie `innerHTML`
- `.ps1` = Windows PowerShell 5.1 kompatibel, UTF-8 mit BOM, CRLF (`.gitattributes`); `.cmd` = ASCII
- `install.ps1` löscht nichts; vorherige Variablen-Werte → `env-backup.json`

## Work Guidance

- Designsprache: ein Akzent (Phosphor-Grün), Graphit-Neutrals, Segoe UI Variable + Cascadia;
  Signatur = SPINE-Meter und 12-Wochen-Puls; keine Verläufe, kein Glassmorphism, keine Kartenraster
- Neue Projektmerkmale zuerst in `scanner.js`/`git.js`, Listen-Payload klein halten (Details über `/api/project/:id`)

## Verification

- Quick: `node --check app/server.js && node --check app/public/app.js`
- Full: `node --test test/*.test.js` (aus `projekt-hub/`)
- UI: `node test/fixtures.js <demo-dir>` und `node app/server.js --config <demo-dir>/config.json --port 4399 --no-sync`, dann Desktop- und Mobil-Screenshots prüfen
- PowerShell-Skripte sind hier nicht ausführbar getestet (kein pwsh im Container) — auf Windows prüfen

## Decisions

- 2026-11-13: Zero-dep Node + Vanilla-UI statt Electron/React — warum: kein `npm install` auf dem Ziel-PC, sofort startbar
- 2026-11-13: Sync im Server (Autostart) statt geplanter Windows-Aufgabe — warum: ein Prozess, ein Log, gleiche Logik wie der UI-Button
- 2026-11-13: `safe.directory=<projekt>` per `-c` statt global `*` — warum: externe Laufwerke haben fremde Besitzer-SIDs; globales `*` würde Git-Schutz überall abschalten
- 2026-11-13: Kein REFERO-Dokumentgerüst — warum: kollidiert mit SPINE-AGENTS.md; Designentscheidungen stehen hier

## Footguns

- `ErrorActionPreference = 'Stop'` plus umgeleitetes stderr eines Programms (`2>`/`*>`) bricht `install.ps1` in PS 5.1 ab — weil stderr dort zu Fehlerobjekten wird; über `cmd.exe /d /c "... >nul 2>&1"` aufrufen
- `.ps1` ohne BOM speichern bricht Umlaute in PS 5.1 — weil es ANSI annimmt
- `git for-each-ref --format` mit `%x1f` liefert Literaltext — weil for-each-ref nur `%1f` kennt (anders als `git log`)
- `hidden`-Attribut auf Elementen mit eigenem `display` wirkungslos — deshalb global `[hidden]{display:none!important}`

## Rollback

- Auf dem PC: `H:\Projekt-Hub\Deinstallieren.cmd` (stoppt Server, entfernt Verknüpfungen, stellt Variablen aus `env-backup.json` wieder her; Projekte/Caches bleiben)

## Child SPINE Index

Keine Child-Docs: `app/`, `test/` sind durch diesen Vertrag vollständig abgedeckt.
