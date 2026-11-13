# Projekt-Hub

Lokales Dashboard für alle deine Projekte auf `H:`. Läuft auf deinem Windows-PC unter
`http://127.0.0.1:4310` und ist nur von diesem PC aus erreichbar.

- **Liste aller Projekte** unter `H:\Projekte` (weitere Laufwerke in den Einstellungen):
  - Stand aus `.snapshot/HOT.md` (Fokus, nächster Schritt, Blocker)
  - SPINE-Status (AGENTS.md / CLAUDE.md / HOT.md)
  - Git (Branch, offene Änderungen, ↑↓ zum Remote, Cloud-Session-Branches `origin/claude/*`)
  - Stack und Aktivität der letzten 12 Wochen
- **Aktionen pro Projekt:** Claude Code starten, VS Code, Explorer, Terminal, GitHub öffnen,
  **SPINE einrichten** (startet Claude Code mit `START.md` aus `H:\MY-SKILLS\MAX-ME`)
- **Neues Projekt:** legt den Ordner auf `H:` an, auf Wunsch mit `git init` und SPINE-Setup
- **Sync:** holt alle Repos (`git fetch`), spult saubere Repos vor (nur Fast-Forward) und
  **klont jedes GitHub-Repo, das noch keinen Ordner auf H: hat**. So landet Arbeit aus
  Claude-Code-Cloud-Sessions automatisch auf deinem PC.
- **Cache auf H:** npm, yarn, pnpm, bun, pip, uv und Playwright cachen nach `H:\DevCache`.

## Installation (einmalig)

1. Diesen Ordner `projekt-hub` auf den PC holen, entweder als ZIP oder per
   `git clone -b claude/project-tool-h-drive-cache-m1glji https://github.com/Zelos0/Z-Test.V1.0`.
2. **`Installieren.cmd` doppelklicken.** Der Installer
   - prüft Node.js 18+ und bietet sonst die Installation per `winget` an,
   - legt `H:\Projekte`, `H:\DevCache` und `H:\Projekt-Hub` an,
   - setzt die Cache-Umgebungsvariablen für deinen Benutzer und sichert die alten Werte in `env-backup.json`,
   - kopiert die App, schreibt `config.json` und legt Verknüpfungen auf dem Desktop, im Startmenü und im Autostart an,
   - startet den Hub und öffnet den Browser.
3. Optional, aber empfohlen: einmal `gh auth login` ausführen (GitHub CLI: `winget install GitHub.cli`),
   damit fehlende Repos automatisch geklont werden.

Optionen, z. B. `Installieren.cmd -Drive D -NoAutostart`:

| Option | Wirkung |
|---|---|
| `-Drive H` | Laufwerk für alles (Standard `H`) |
| `-ProjectsRoot`, `-CacheRoot`, `-HubDir`, `-MaxMePath` | einzelne Pfade abweichend setzen |
| `-MoveClaudeConfig` | Claude-Code-Konfiguration nach `H:\DevCache\claude` (setzt `CLAUDE_CONFIG_DIR`; das Original bleibt als Sicherung) |
| `-NoCacheVars` | Cache-Umgebungsvariablen nicht setzen |
| `-NoAutostart`, `-NoShortcuts`, `-NoStart` | Verknüpfungen bzw. Start weglassen |
| `-Yes` | keine Rückfragen |

## Bedienung

| Taste | Aktion |
|---|---|
| `/` | Suchen |
| `j` / `k` oder ↓ / ↑ | Auswahl bewegen |
| `Enter` | Details |
| `c` · `e` · `o` | Claude Code · Editor · Explorer |
| `n` · `r` | Neues Projekt · Neu scannen |

**Einstellungen** (Regler-Symbol unten links) öffnen weitere Optionen:
- Wurzelordner auf mehreren Laufwerken
- MAX-ME-Pfad und Editor (`code`, `cursor`, …)
- Sync-Intervall und automatisches Klonen
- **HUB-Index kopieren**: die Projekt-Übersicht als Markdown-Tabelle im Format von START.md, Schritt 6

## Dateien auf dem PC

| Ort | Inhalt |
|---|---|
| `H:\Projekte\` | deine Projekte (jeder Unterordner ist ein Projekt) |
| `H:\DevCache\` | Paket-Caches und `projekt-hub\` (Scan-Cache, `server.log`) |
| `H:\Projekt-Hub\` | App, `config.json`, `env-backup.json`, `Deinstallieren.cmd` |

## Cloud-Umgebung (claude.ai „Cloud-Umgebung aktualisieren“)

Was dort im Setup-Skript steht, läuft in einem Linux-Container in der Cloud und **kann dein
Laufwerk `H:` nie erreichen**. Für dieses Setup dort also nichts eintragen:

- **Umgebungsvariablen:** leer lassen
- **Setup-Skript:** leer lassen (dieses Repo braucht keine Installation)

Der Weg auf deinen PC läuft über GitHub. Cloud-Sessions pushen ihre Branches, und der Hub holt
sie beim Start sowie alle 30 Minuten nach `H:\Projekte`.

## Deinstallieren

`H:\Projekt-Hub\Deinstallieren.cmd`. Der Server wird gestoppt, Verknüpfungen werden entfernt
und die Umgebungsvariablen aus `env-backup.json` wiederhergestellt. Projekte und Caches bleiben
unangetastet.

## Fehlersuche

- **Hub startet nicht:** `H:\Projekt-Hub\Projekt-Hub.cmd` starten, dann ist das Log sichtbar.
  Alternativ `H:\DevCache\projekt-hub\server.log` öffnen.
- **„Besitzer abweichend“ bei Git:** Das Laufwerk gehört einem anderen Windows-Benutzer.
  Der Hub liest trotzdem. Für eigene Git-Befehle den im Detailpanel angezeigten
  `safe.directory`-Befehl ausführen.
- **Port belegt:** in `H:\Projekt-Hub\config.json` den `port` ändern.

## Entwicklung

```
node --test test/*.test.js                       # 22 Tests: Scanner, Git, Sync, Sicherheit, API
node test/fixtures.js demo                       # Demo-Projekte + config erzeugen
node app/server.js --config demo/config.json --no-sync --open
```
