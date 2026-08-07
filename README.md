# Standbüro

## Für Anwender:innen

**Standbüro** ist ein einfaches Werkzeug, mit dem du für Schiessanlässe Standblätter mit Barcodes (Lizenz und Programm) drucken kannst – ohne Installation, ohne Konto, ohne Abo. Du gibst die Teilnehmer ein, stellst einmalig Anlass und Programm ein, und druckst die Blätter aus.

Die App läuft direkt im Browser und funktioniert auch **offline**, sobald sie einmal geladen wurde. Alle Daten bleiben lokal auf deinem Gerät – nichts wird auf einen Server geschickt. Du kannst sie zudem als Web-App auf Desktop oder Tablet **installieren**, sodass sie sich wie ein normales Programm verhält.

Unterstützte Sprachen: **Deutsch** und **Französisch** (umschaltbar in den Einstellungen).

Diese Software ist kostenlos und Open Source – entwickelt für die Schweizer Schützenvereine. Bei Problemen, Wünschen oder zum Mithelfen: [Projekt auf GitHub](https://github.com/Schiesssport/OpenRangeOffice).

---

## Technical overview

> **Coding agents:** must absorb [`AGENTS.md`](AGENTS.md) before any code — it is the operational contract for this repository (architecture, conventions, storage shape, git rules, post-change checklist).

A small offline-first web app for managing shooting-event participants and printing barcoded score sheets ("Standblätter") for Swiss shooting events.

Built as a single-page PWA with no build step and no external runtime dependencies — open `index.html` (served over `http://localhost` or `https://`) and it works.

## Features

- **Participant Table**
  - Inline editing for last name, first name, year of birth, licence number
  - Up to two configurable custom columns
  - Quick filter (top right of the toolbar)
  - Auto-expansion of two-digit years (e.g. `26 → 2026`, `27 → 1927`, pivot = current year)
  - Live shooting category badge (`JJ / J / E / S / V / SV`) computed from age
  - CSV import (auto-detects `;`, `,`, or tab delimiter, maps DE/FR/EN headers)
  - CSV download (UTF-8 BOM, `;`-delimited — opens cleanly in Excel)
  - Excel-compatible copy to clipboard
  - Backup export/import (JSON, full state)
  - Optional SSV licence-roster lookup: import once, then licence numbers auto-fill last name, first name, year of birth (stored in IndexedDB, never bundled into event exports)
- **Matches & score-sheet printing**
  - Up to five configurable matches ("Stiche"); each participant registers for the matches they've entered, toggled per row
  - One printed sheet per registered (participant × match); a Code128 participant barcode and match barcode, each with a `mod-97` checksum
  - Configurable **scorecards** (print templates): place participant/match barcodes, participant name, match title, event name and logo in millimetres, over an optional PDF backdrop (created in Word, exported to PDF, ≤1 MB); prints on white when no PDF is set
  - Optional paired copy of each field at a horizontal/vertical offset (for split, tear-off paper)
  - Toolbar prints per match or all matches (grouped by participant) for the selection; `Ctrl/Cmd+P` prints the focused participant's registered matches
  - Black & white friendly: no colour in category indicators
- **i18n**: German (default) and French, switchable at runtime
- **PWA**: installable, fully offline after first load (service worker caches all assets)

## Planned Features

- [ ] **Streamlined administrative workflow**: Printing award cards and receipts.
- [ ] **Group competition**: Automated calculation of equipment categories based on firearm types.
- [ ] **Club competition**: Full compliance with Swiss Shooting Sport Federation (SSV) standards and the 2011 regulatory framework.
- [ ] **Live Leaderboards**: Optimized display for sponsors and real-time rankings on projectors or large-screen TVs.
- [ ] **Individual competition**: Scriptable ranking logic using dedicated event hooks, allowing users to define their own custom rules and scoring algorithms.

## Barcodes

Two Code128 barcodes per label, both with a `mod-97` (`-3n mod 97`) checksum:

| Barcode | Composition |
|---|---|
| Participant | `participantPrefix` + licence number padded to 6 digits + checksum |
| Match | `codePrefix` (2) + `matchCode` (3) + `targetCode` (3) + checksum |

## File layout

| File | Purpose |
|---|---|
| `index.html` | Markup only; UI structure and `data-i18n` hooks |
| `styles.css` | All styling, including the print stylesheet for the label sheets |
| `src/app.js` | Application logic (translations, settings, table, barcode, print, CSV, backup, update prompt) |
| `src/core/*.js` | Pure-logic modules, imported into `app.js` as namespaces (`Escape`, `I18n`, `Ages`, `BarcodeCodec`, `Csv`, `Licenses`, `UpdateTime`, `Ids`, `MatchOrder`, `ScorecardLayout`) |
| `src/tests/*.test.js` | Node test suite, one file per `src/core/*.js` module |
| `src/vendor/JsBarcode.all.min.js` | Vendored barcode library (no CDN needed) |
| `src/vendor/pdf.min.js`, `pdf.worker.min.js` | Vendored pdf.js (rasterizes the optional PDF scorecard backdrop); pinned in `package.json`, copied by `npm run vendor` |
| `sw.js` | Service worker — offline cache + `SKIP_WAITING` handler (bump `CACHE_NAME` to ship a new version). Stays at repo root so its scope covers the whole site. |
| `manifest.webmanifest` | PWA manifest |
| `icon.svg` | App icon |

## Storage

Three top-level `localStorage` keys, each a JSON-encoded versioned wrapper:

| Key | Shape |
|---|---|
| `settings`     | `{ version, data: { eventName, eventLogo, participantPrefix, licenseEnabled, customColumn1Name, customColumn2Name, matches: [...], scorecards: [...] } }` |
| `participants` | `{ version, items: [ {license, lastName, firstName, yearOfBirth, custom1, custom2, registeredMatches: [matchKey, ...]}, ... ] }` |
| `userSettings` | `{ language, updateDeferUntil }` — local user preferences, **not** part of an event export |

The exported `.openrangeoffice` file mirrors `settings` + `participants` exactly. Section versions are `Major.Minor`; an incompatible major aborts the import (a registry-based migration framework is in place for future major bumps).

## Running locally

The app needs to be served over `http://localhost` or `https://` for the service worker / PWA install to work.

```bash
npm run dev      # fast iteration: service worker uses network-first, edits show on reload
npm run prod     # production simulation: cache-first, restart = "new release" (triggers update prompt)
```

## Browser support

Modern evergreen browsers (Chromium-based, Firefox, Safari).

## Licence

[AGPL-3.0](LICENSE)

This is free community software: it is prohibited to sell this tool as a private product or hide its source code. Under the AGPL license, any modifications or hosted versions must remain open-source and free for everyone to use and improve.
