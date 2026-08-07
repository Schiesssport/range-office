# AGENTS.md

This `AGENTS.md` is the operational blueprint for coding agents working on this repository: the logic, rules, and thought processes required to execute autonomous development tasks. It is a living document (≤10 000 characters, target 7000) that must be kept in sync with the codebase as features evolve and conventions change.

## Rules

These are non-negotiable. They override any other guidance in this document.

1. **Always read files before editing them.** No edit goes out based on memory or guesswork — open the file in the current state, locate the exact lines, then change them. This applies to every iteration; the file may have been modified by the developer or a linter between turns.

## What OpenRangeOffice does

OpenRangeOffice is a small offline-first PWA for managing participants and printing barcoded score sheets ("Standblätter") at Swiss shooting events. Single-page, no build step; the only runtime dependencies are the vendored `JsBarcode.all.min.js` and `pdf.min.js` (+ its worker, used to rasterize an optional PDF scorecard backdrop). UI is German or French. All state lives in `localStorage`. See `README.md` for full details.

## Code philosophy

Write for the next developer, not the machine. Every method, variable, and class must communicate its intent by name alone. If a function needs a comment to explain what it does, rename or split it.

- Use descriptive names. No `$data`, no `$result`, no abbreviations.
- Keep methods short and single-purpose.
- One responsibility per class.
- No speculative abstractions. Abstract when duplication is proven, not anticipated.
- No emojis in code or messages unless explicitly requested.
- Default to no comments. Only add a comment when the *why* is non-obvious.

## Architecture

Two-layer split, deliberately strict. All app code lives under `src/`; only `sw.js` and the static asset files stay at the repo root.

| Layer | File(s) | Allowed to touch |
|---|---|---|
| Pure logic | `src/core/*.js` (one file per topic: `escape`, `translations`, `categories`, `barcodes`, `csv`, `licenses`, `updates`, `ids`, `matches`, `scorecards`) | Plain JS only — no DOM, no `localStorage`, no `window`, no `document`, no `Date.now`/`Math.random` (time and randomness are passed in, e.g. `Ids.uuid7(nowMs, randomBytes)`). Exported as ES modules (named function/const exports). |
| App layer | `src/app.js` | DOM, `localStorage`, `IndexedDB`, `JsBarcode`, `pdfjsLib`. Imports each core module as a namespace (`import * as Escape from './core/escape.js'`, etc.) and calls `Escape.escapeHtml(...)`, `BarcodeCodec.buildMatchCode(...)`, `Ids.uuid7(...)`, `MatchOrder.buildPrintPairs(...)`, `ScorecardLayout.fieldPlacements(...)`, etc. Organised as `class` modules with static methods: `Migrations`, `UserSettings`, `Translations`, `Settings`, `Logo`, `Tabs`, `Categories`, `Barcodes`, `Matches`, `Scorecards`, `Participants`, `Selection`, `Filter`, `Toolbar`, `CsvIO`, `Printing`, `Backup`, `LicenseDb`, `Updates`, `App`. |
| Vendor | `src/vendor/JsBarcode.all.min.js`, `src/vendor/pdf.min.js`, `src/vendor/pdf.worker.min.js` | Pinned third-party libraries loaded as classic `<script>`s (set `window.JsBarcode` / `window.pdfjsLib`). pdf.js is a `devDependency` in `package.json`; `npm run vendor` copies the pinned build from `node_modules` into `src/vendor/`. |
| Service worker | `sw.js` (at repo root) | Standalone offline cache + `SKIP_WAITING` message handler. Lives at the root so its scope covers `/`. `app.js` registers it and drives the user-facing update prompt via the `Updates` class. When you add or rename a file the app fetches, update the `ASSETS` array in `sw.js` and bump `CACHE_NAME`. |

Anything that can be tested without a browser belongs in `src/core/`. Tests live in `src/tests/<module>.test.js` and import the matching `../core/<module>.js` directly with named imports, so a failure points at the actual file.

Class-as-namespace is the grouping convention everywhere — app classes for stateful DOM/storage surfaces, namespace imports for pure helpers. Don't expose loose top-level functions from `src/app.js`.

The HTML uses inline `onclick="Module.method()"` handlers wired to those classes — keep classes as static-method namespaces and export them on `window` if a new one is referenced from markup.

## Single sources of truth

When adding columns, settings, or translations, extend the existing schema rather than scattering new lookups:

- **Participant columns** → `Participants.FIELDS` in `src/app.js`. One entry covers: storage key, CSS class, type, placeholder key (or literal placeholder), header key (or dynamic `getHeader`), optional `col` data attribute, optional visibility predicate. Row HTML, CSV export, CSV import, column visibility, and `refreshDynamicTexts` all derive from it. CSV import/export map columns by **header name** — each field by its localized header (`Participants.fieldHeader`), plus one `match_<matchCode>` column per match carrying registrations — so an import stays correct even if the visible columns changed since export; unknown headers are ignored. On update, fields/registrations absent from the file are preserved (`writeRow` skips `undefined` keys).
- **Settings fields** → `Settings.BINDINGS`. One entry covers storage key, element id, type (`text` | `checkbox`), default value. Load/save/get all use it.
- **Translations** → `TRANSLATIONS` in `src/core/translations.js` (`de` and `fr` dictionaries). Use `data-i18n="key"` and `data-i18n-placeholder="key"` in HTML. For dynamic text in JS, call `Translations.t('key', { params })`. `{name}` style placeholders are substituted by `translate()`.
- **Backup format versions** → `Backup.SETTINGS_VERSION`, `Backup.PARTICIPANTS_VERSION` (both `Major.Minor`). Bump the major when the shape changes incompatibly; bump the minor for additive changes.

## Versioning & migrations

Currently, we are in early development, so don't automatically add migration or backwards-compatibility logic. Ask the developer if it is needed for the current task.

Two version markers live in `localStorage`: `settingsVersion`, `participantsVersion`. On every boot, `Migrations.run()` compares them to `Backup.SETTINGS_VERSION` / `Backup.PARTICIPANTS_VERSION` and walks `Migrations.settings[N]` / `Migrations.participants[N]` step-by-step from each old major to the current one, then stamps the current version. Empty registries today.

When you bump a major version (e.g. settings 1.x → 2.0):

1. Update `Backup.SETTINGS_VERSION = '2.0'`.
2. Add `Migrations.settings[1] = () => { /* mutate localStorage in place */ };`.

Imported `.openrangeoffice` files are version-checked per section. Mismatched majors are rejected with `msg.importIncompatible`. Same convention applies — when you change the on-disk shape, bump the major and add a migrator.

## Storage layout

`localStorage` mirrors the export envelope so the two are interchangeable. Three top-level keys, each a JSON-encoded string:

- `settings` — `{ version: "2.0", data: { eventName, participantPrefix, licenseEnabled, customColumn1Name, customColumn2Name, eventLogo, matches: [...], scorecards: [...] } }`. `matches`/`scorecards` are variable-length arrays managed by the `Matches`/`Scorecards` classes via `Settings.getRaw`/`setRaw` (they do **not** fit the flat `Settings.BINDINGS` schema). A match is `{ key (uuid7), label (≤2 chars), title, codePrefix, matchCode, targetCode, scorecardKey }`; a scorecard is `{ key, name, pdfDataUrl, pageWidthMm, pageHeightMm, fields }` where each field is `{ enabled, fromLeftMm, fromTopMm, widthMm, heightMm, fontPt?, pair: { enabled, horizontalOffsetMm, verticalOffsetMm } }`. At least one match and one scorecard always exist.
- `participants` — `{ version: "2.0", items: [ {license, lastName, firstName, yearOfBirth, custom1, custom2, registeredMatches: [matchKey, ...]}, ... ] }`
- `userSettings` — `{ language: "de", updateDeferUntil: 0 }` — local-only user prefs, **not** exported (free-form bag, extend via `UserSettings.patch`)

The optional **SSV license roster** lives in IndexedDB (`openrangeoffice-licenses` / store `licenses`, keyed by `normalizeLicense(...)` from `src/core/licenses.js`) — deliberately *outside* the event envelope so a 10MB roster never bloats `.openrangeoffice` exports. Managed entirely by the `LicenseDb` class; `Backup.clearAll` does not touch it.

The exported `.openrangeoffice` envelope is just the first two:

```jsonc
{
  "settings":     { "version": "2.0", "data":  { ...flat keys, "matches": [...], "scorecards": [...] } },
  "participants": { "version": "2.0", "items": [...] }
}
```

The version lives *inside* each wrapper — there are no separate `*Version` keys. `UserSettings` deliberately sits outside the event so language and future personal prefs survive a full event reset and aren't shipped to other operators in an export.

## Naming conventions

- IDs: kebab-case (`event-name-input`, `participants-tbody`).
- CSS classes: kebab-case (`field-lastname`, `btn-danger-ghost`).
- Storage keys: camelCase (`participantPrefix`, `customColumn1Name`).
- JS identifiers: camelCase; classes PascalCase.
- Translation keys: dotted lowercase (`btn.print`, `category.tooltip`, `placeholder.lastName`).

## Security

User-supplied strings touch `innerHTML` in label printing, row rendering, and dynamic header text — always go through `Escape.escapeHtml()` (the `Escape` namespace bound to `src/core/escape.js`). Don't introduce new template literals that interpolate user input directly into `innerHTML` without escaping. CSV/TSV output uses `escapeCsvField` which handles RFC 4180 quoting.

## i18n discipline

Every visible string ends up in `TRANSLATIONS`. When you add a UI element with text, add a translation key in **both** `de` and `fr` and reference it via `data-i18n` or `Translations.t()`. Don't ship English fallbacks in the UI; English is allowed only for code identifiers and `console`.

## Local development

Node is required.

```bash
npm run dev     # static server; sw.js keeps the placeholder, SW is network-first
npm run prod    # same server but stamps sw.js with a startup timestamp, SW is cache-first (simulates deploy)
npm run test    # runs the Node test suite against src/core/*.js
```

Open `http://localhost:3000` (or whichever port the server reports). The service worker only registers on `localhost` or HTTPS — opening `index.html` via `file://` works for quick visual checks but PWA install / offline cache won't kick in. Restart `npm run prod` to "ship a new release" locally: the new timestamp triggers the in-app update prompt on next reload, exactly as a real deploy would.

## Deployment

Production deploys are driven by GitHub Releases. Publishing a release in the GitHub UI triggers `.github/workflows/deploy.yml`, which stages a `_site/` directory, substitutes the release tag into `sw.js` (replacing the literal `__CACHE_VERSION__` placeholder), and pushes to GitHub Pages.

`CACHE_NAME` therefore should *never* be hand-edited. The placeholder stays in the repo; both the workflow and `npm run prod` stamp it before delivery. Under `npm run dev` the literal `'__CACHE_VERSION__'` reaches the browser unchanged — `sw.js` reads that as the "this is development" signal and switches to network-first so reloads pick up edits.

The first time you set this up, enable GitHub Pages in repo settings with source set to "GitHub Actions" (not "Deploy from a branch").

## Testing

- All testable logic must live in `src/core/`. New core helpers need at least one test in the matching `src/tests/<module>.test.js`.
- Tests use `node --test` plus `assert/strict`. No external test framework. Add a new `src/core/<topic>.js` only when it's a genuinely new topic — prefer extending an existing module.
- Run `npm run test` after every change. A green run is a precondition for handing back to the developer.

## Git & code review

You are read-only on git. Never run `git add`, `git commit`, `git push`, `git rebase`, `git reset`, branch deletion, force pushes, or anything destructive. Read-only commands (`git status`, `git diff`, `git log`, `git show`, `git branch -vv`) are fine. The developer makes all commits.

After every tasked change:

1. Run `node --check <file>.js` for any file you touched, and `npm run test`.
2. List each changed file with a one-line summary of what changed and why.
3. Flag areas that warrant close review — complex logic, security-sensitive paths, side-effects on storage or migrations.
4. Ask for feedback before proceeding to the next task.
5. Suggest a short plain commit message for the pending `git status`. No prefixes, tags, or brackets — the branch name communicates the type; the message explains what changed.

## When you're unsure

- Prefer extending an existing schema (`PARTICIPANT_FIELDS`, `Settings.BINDINGS`, `TRANSLATIONS`) over creating a parallel one.
- Prefer adding a pure helper to the matching `src/core/<topic>.js` (with a test) over adding logic to `src/app.js`.
- Prefer a tiny, named function over an inline ternary chain.
- If a change touches the on-disk format, treat it as a versioning event: bump the major, add a migrator, write tests for the migration step.
