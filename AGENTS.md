# Mundus agent guide

This is the single starting point for an agent working in this repository. Read
it completely before changing files or remote state. Current Git, GitHub and
live evidence always win over any status text written here.

## 1. Product

Mundus is a static, client-side, interactive 3D Earth exhibit:

> digital museum exhibit × scientific instrument × interactive atlas

It is not a navigation tool, street map, GIS editor, data dashboard or
visualization platform. The core loop is: choose an observation, turn the
globe, get one clear finding, inspect it, share the state, move to another
observation while keeping the selected place.

- Live site: <https://0mn1si2i5.github.io/mundus/> (repository
  `0mn1si2i5/mundus`; Pages paths are case-sensitive, and the deploy job's
  `page_url` is the authority for the address).
- The bare address opens a neutral lobby. The header switcher offers the two
  primary observations, **Other Side** (`antipodes`) and **Surname Atlas**
  (`surnames`); **Sunline** (`sunline`) sits under "More observations".
  **Development, Unpacked** was retired in 2026-10: its links
  (`mode=development`) open the lobby with a "retired" notice, and its UNDP
  data, code and attribution were removed.
- Methods, data sources, licences and software notices live in one About
  dialog; a short credit line on the globe opens it. Working panels carry only
  per-result caveats (for example the "not individually verified" surname
  label).

Observation contracts:

- **Other Side** — antipode computed locally; origin/antipode countries or
  oceans, coordinates, through-Earth and surface distances, and the nearest
  eligible GeoNames major city on each side (represented major cities, not
  nearest settlements). Share links use canonical precision with an explicit
  privacy note; historical whole-degree links stay readable.
- **Surname Atlas** — community surname snapshot with explicit provenance and
  missing states; local script / Latin / Chinese forms are reviewed by Mundus
  (`src/features/surnames/surnameNameForms.ts`). Data contract:
  `docs/NAMING_OBSERVATION_RESEARCH.md`.
- **Sunline** — solar position, terminator, civil twilight, subsolar point and
  approximate sunrise/sunset computed in the browser (NOAA/Meeus-style
  approximations, educational only; never legal, navigational or aviation
  time).

Experience requirements: the first screen is the globe; Chinese and English
agree in meaning; desktop and mobile complete the same loop; keyboard, focus
management, reduced motion, 44px touch targets on phones, semantic DOM
alternatives and WebGL failure behaviour are release requirements.

Stable product scope, interaction principles and data policy:
`docs/PROJECT_PLAN.md`. Implementation history: `docs/IMPLEMENTATION.md`.

## 2. Working agreement

The product owner decides direction. The agent acts as technical product lead
and primary developer: challenge scope, propose bounded work, implement it, and
carry it through tests, review and release evidence.

- **Fixes** to shipped behaviour go to `main` through a pull request once CI is
  green.
- **Features, redesigns and new observations** start with a short proposal
  (question, data source and licence, coverage and missing states, asset
  budget, bilingual copy, accessibility, failure behaviour, tests). Implement
  only after the owner accepts it, and merge only after the owner has reviewed
  the pull request.
- **Always ask first** before changing repository settings, Pages, branch
  protection or secrets; creating or moving tags and GitHub Releases; deleting
  branches; rewriting or force-pushing shared history; accepting a data or
  licence risk; or starting a job that trips the resource gate in §7.
- Never discard local changes you did not make.

## 3. Architecture invariants

A thin static client: no backend, runtime plugin loader, UI framework, generic
event bus or second renderer.

- `src/app/App.tsx` composes header, lobby, one lazy globe viewport, mode
  panel and result, Share and About dialogs. `src/i18n/messages.ts` holds the
  bilingual UI copy; styles are `src/styles/global.css` tokens plus CSS
  Modules.
- `src/state/appStore.ts` (Zustand) and `src/state/urlState.ts` (validated,
  versioned query state); `src/app/useUrlState.ts` syncs browser history.
- `src/features/modes/modeRegistry.ts` is pure metadata (`MODE_ORDER`, tier);
  no hooks, loaders, renderer objects or mutable state.
  `useModePresentation`, `ModeControls` and `ModeResult` are the exhaustive
  dispatch boundaries. A mode may fail and recover without taking down the app.
- `src/features/globe/GlobeViewport.tsx` owns the single WebGL Canvas. Keep
  `frameloop="demand"` outside intentional animation, context-loss recovery,
  resource cleanup, automatic quality and reduced motion. Do not expose
  Three.js internals to mode controls.
- The lobby makes no requests for mode-specific chunks or data; a mode loads
  only when entered and releases playback, listeners and GPU resources on exit.

URL contract:

| URL shape                                  | Behaviour                                       |
| ------------------------------------------ | ----------------------------------------------- |
| bare address                               | lobby                                           |
| unversioned or `v=1` with historical state | Other Side, existing parser semantics           |
| `v=2` without `mode`                       | lobby; a valid `point` selects the shared point |
| `v=2&mode=<id>`                            | that mode                                       |
| `v=2` with an unknown mode                 | lobby plus a dismissible notice                 |
| retired `mode=development` (any version)   | lobby plus a dismissible "retired" notice       |

Coordinates serialise to at most four decimals. Continuous time or camera
updates replace history entries. Opening a dialog never mutates the URL.
Locale and first-use state are local preferences.

## 4. Data

- Manifests: `src/data/manifests/`; reviewed snapshots:
  `src/data/generated/`; rebuild scripts in `scripts/` pin upstream URLs and
  SHA-256 hashes. `pnpm data:verify` is fail-closed: a hash mismatch blocks
  release.
- Never silently update an upstream version, fuzzy-match countries at runtime,
  turn missing values into zero, hand-edit generated JSON or notices, or commit
  raw downloads.
- Attribution and licences: `DATA_SOURCES.md`, `THIRD_PARTY_LICENSES.md`, the
  About dialog, and method notes in `docs/data/`.

## 5. Toolchain and gates

Node 22.23.1 and pnpm 11.7.0 (pinned in `package.json`; honour
`pnpm-lock.yaml`).

```bash
pnpm install --frozen-lockfile
pnpm dev               # local development
pnpm check:source      # format, lint, typecheck, data:verify, node tests, vitest, artifact-verifier tests
pnpm check             # check:source + vector-data subset + build + release:verify
pnpm test:e2e          # desktop Chromium and Pixel 7 browser suites
pnpm release:verify    # Pages artifact verification of dist/
```

Required checks on protected `main`: `source-quality`, `vector-data-full`,
`browser-smoke` and `pages-artifact` (which needs the build plus both browser
projects). On `main`, the Pages workflow then deploys and runs a desktop/mobile
live smoke against the deployed URL. Live smoke only proves the host serves the
artifact and renders the lobby; it does not replace the browser suites.

Browser tests live in `tests/e2e/`, one file per area (`shell`, `layout`,
`globe`, `other-side`, `surnames`, `sunline`) with shared
helpers in `helpers.ts`; `@smoke` tags the CI smoke subset.

Test discipline: never loosen an assertion, add retries, raise timeouts or skip
a test to get green. Reproduce a failure, find the root cause, fix it, then
rerun the relevant gate. Browser tests run serially because WebGL contexts are
a shared budget. A claim that something passes must come from a fresh run on
the final commit.

Severity: **P0** — secret exposure, invalid data or licence, corrupted
artifact, unreproducible deploy: stop. **P1** — broken mode or result, mobile
primary-flow blocker, inaccessible primary control, broken sharing, missing
attribution, failed CI/Pages/live smoke: fix before merging. **P2** — cosmetic
or non-primary issues with a safe fallback: record, don't inflate scope.

## 6. Release and Pages

- Vite uses `base: './'`, targets ES2022 and ships no source maps.
  `scripts/verify-pages-artifact.mjs` rejects missing notices, symlinks, source
  maps and root-relative assets. `dist/` is never committed or uploaded by hand.
- Only the deploy job has `pages: write` and `id-token: write`. Roll back by
  redeploying a previously verified run, then fix `main` with a reviewed
  revert. Procedure: `docs/RELEASE_RUNBOOK.md`.
- Release identity: tag `v1.0.0` and its GitHub Release target
  `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`. No later tag exists; creating one
  needs owner approval and must point at a deployed, live-verified `main` SHA.
  `package.json`'s version is build metadata, not a release identity.

## 7. Local resource gate

Ordinary builds and tests need no approval. Before work that could seriously
disturb the machine — about 50 GiB of storage, near-total CPU for more than a
few minutes, memory pressure that causes swapping, long-lived background
processes or downloads, or an unknown bound that could reach these — report the
expected peak, duration, storage location, retention and cleanup command, and
agree a local, external-volume or cloud path with the owner. Keep raw inputs
and caches outside the worktree, never add such work to routine gates, and
report what was kept and removed afterwards.

## 8. Git hygiene

- Work on a focused branch; keep each pull request single-purpose.
- Run `git diff --check` and the proportionate gate before committing.
- Never commit `dist/`, `node_modules/`, Playwright reports, `test-results/`,
  `output/`, `tmp/`, `.env*`, `.DS_Store`, logs, tokens or raw datasets.
- Do not change dependencies unless the work requires it; if the lockfile
  changes, review the licence inventory.
- Do not persist per-task plans, execution logs or transcripts in the
  repository. Persist only lasting contracts: product, data and licence
  decisions, architecture invariants and release evidence.
