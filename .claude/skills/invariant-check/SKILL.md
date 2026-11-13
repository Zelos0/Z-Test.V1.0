---
name: invariant-check
description: SPINE Invariant-Check vor einer teuren Trace-Analyse eines Multi-Agent-Runs. Nutzen bei "warum ist das Ergebnis falsch", "Subagent X liefert komische Werte", "Kosten explodiert", "prüf mal ob der letzte Run sauber war" – zuerst nur Checkpoint-Werte gegen die Invarianten-Tabelle der zuständigen AGENTS.md vergleichen.
---

# SKILL: invariant-check (SPINE-kompatibel)

## Trigger

Nutze diesen Skill, bevor du eine vollständige Trace-Analyse eines
Multi-Agent-Runs beginnst — z. B. bei "warum ist das Ergebnis falsch",
"Subagent X liefert komische Werte", "Kosten explodiert sind",
"Prüf mal ob der letzte Run sauber war".

Nutze ihn NICHT als Ersatz für tiefe Analyse, wenn die Invariante bereits
bekanntermaßen gebrochen ist und die genaue Fehlerstelle gesucht wird —
dann direkt in Schritt 3 einsteigen.

## Vor Schritt 1 — SPINE Drift Guard

Nenne eine Zeile, welche `AGENTS.md`-Kette für den betroffenen Ordner/Agent
gelesen wurde und ob die dort dokumentierten Invarianten (siehe
`INVARIANTS.md`) noch zum aktuellen Code/Setup passen. Weichen sie sichtbar
ab, erst das melden, bevor der Check überhaupt läuft.

## Ablauf

### Schritt 1 — Billige Prüfung (immer zuerst)

Lies NUR den `## Invariants`-Abschnitt der zuständigen `AGENTS.md` (siehe
`INVARIANTS.md` für die Methodik) und die geloggten Checkpoint-Werte des
betroffenen Runs. Vergleiche jede definierte Invariante:

- Ist der Wert an Checkpoint A gleich (oder innerhalb Toleranz) dem Wert
  an Checkpoint B?

Gib eine kurze Tabelle aus: Invariante | Status (OK/VERLETZT) | Differenz

### Schritt 2 — Entscheidung

- Alle Invarianten OK → Antworte: "Keine strukturelle Auffälligkeit gefunden.
  Falls das Problem inhaltlicher Natur ist (falsches Ergebnis trotz
  korrekter Struktur), ist eine gezielte inhaltliche Prüfung nötig,
  keine Trace-Analyse."
- Mindestens eine Invariante VERLETZT → weiter zu Schritt 3

### Schritt 3 — Gezielte, eingegrenzte Analyse (nur bei Verletzung)

Lies NUR den Trace-Abschnitt zwischen dem letzten bestätigt guten Checkpoint
und dem ersten verletzten Checkpoint. Nicht den gesamten Run.

Beispiel: Bei 15 Subagents und Verletzung zwischen Subagent 7 und 9 →
nur Output von Subagent 7, 8, 9 lesen, nicht 1–15.

### Schritt 4 — Dokumentation (SPINE-konform)

Trage das Ergebnis NICHT in eine separate Log-Datei ein, sondern:
- Echter Bug gefunden → dated Eintrag unter `## Known Footguns` der
  zuständigen `AGENTS.md`: `<Aktion/Bedingung> bricht <Invariante> — weil <Mechanismus>`
- Bewusste, gewollte Ausnahme entdeckt (kein Bug) → Eintrag bei den
  "Bekannten, gewollten Nicht-Konservativitäten" in `INVARIANTS.md`
  bzw. lokal neben der Invarianten-Tabelle, nicht bei Known Footguns
- Grundlegende Architektur-Konsequenz aus dem Fund (z. B. "Retries müssen
  ab jetzt anders gezählt werden") → zusätzlich als dated Eintrag unter
  `## Decisions`, nach dem SPINE-Format
  `<Entscheidung> statt <Alternative> — warum: <Grund>`

Nach Abschluss: kurz bestätigen, welche `AGENTS.md` aktualisiert wurde,
oder "unverändert weil <Grund>" (SPINE Closeout-Konvention).

## Warum das Tokens spart

Ohne diesen Skill: kompletter Trace wird bei jedem Verdacht komplett gelesen
und analysiert, unabhängig davon, ob überhaupt ein struktureller Fehler
vorliegt.

Mit diesem Skill:
- Kein Fehler vorhanden → nur Checkpoint-Werte gelesen (paar Dutzend Tokens
  statt tausende)
- Fehler vorhanden → nur die relevante Teilspanne gelesen statt des
  gesamten Traces

Der Hebel ist am größten bei Systemen, die meistens korrekt laufen und nur
gelegentlich geprüft werden sollen — dort entfällt die teure Analyse fast
komplett.
