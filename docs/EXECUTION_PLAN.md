# Mundus V1 historical execution plan

- Status: superseded after completed V1.0.0 release
- Updated: 2026-07-20
- Active branch: `codex/v1-release-evidence`
- Product plan: [PROJECT_PLAN.md](PROJECT_PLAN.md)
- Implementation record: [IMPLEMENTATION.md](IMPLEMENTATION.md)

This file is a historical operating plan. It records order,
review gates, and evidence without replacing the stable product decisions in
`PROJECT_PLAN.md`.

## Goal boundary

V1.0.0 was delivered at `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`.
**V1.1.0 Parchment Atlas** is the current public Pages product; its product
implementation entered protected `main` at
`1a9c44700e2154186708772a7773fd8972a7aaf2` and was live-verified on
2026-08-02. The next observation direction requires a focused design, data
contract, resource budget, and product review.
Pleiades/Wikidata cultural work remains a later goal.

The goal is complete only when the release is public, deployed, documented,
reviewed, and reproducible. A green local build alone is not completion.

## Operating loop

Every batch follows the same finite loop:

1. **Plan** — state the product outcome, file boundaries, risks, and tests.
2. **Implement** — keep the batch single-purpose and preserve lazy data/GPU
   boundaries.
3. **Verify** — run formatting, lint, types, data hashes, unit tests, build, and
   proportionate browser tests.
4. **Review** — obtain independent architecture, product/accessibility, and
   release/security review. P0/P1 findings return to implementation.
5. **Correct and re-verify** — test the exact failure path, not only the happy
   path. A timeout or flaky result is investigated before any budget changes.
6. **Publish gradually** — push a small branch/PR, wait for remote CI, then
   merge only when all required checks and reviews are green.
7. **Record** — update `IMPLEMENTATION.md` and this plan with delivered evidence
   and remaining non-blocking validation.

Repository rules for every batch:

- no generated build, browser report, secret, cache, or local evidence files;
- no new general framework unless the next committed feature needs it;
- data manifests and derived hashes fail closed;
- data, controls, and renderer resources stay mode-gated;
- no public visibility, deployment, or release tag before its explicit gate.

## Milestone 0 — stable private baseline

Status: **complete** at `1d627e6` on private `main`.

- Stages 1–4 and Sunline are synced to GitHub.
- WebGL fallback semantics, mode-local failure recovery, responsive panels,
  WCAG muted text, document language, visible UNDP licensing, and generated
  asset verification are hardened.
- Local gate: 57 unit tests; 31 browser tests passed and one intended skip.
- Remote gate: quality and Chromium browser jobs passed for `1d627e6`.
- Medium-range Android hardware sampling remains non-blocking because no device
  is currently available.

## Milestone 1 — V1 product completion

Status: **complete** through merged PR #1 (`70572bf`).

PR #1 merged the completed discovery loop and Development evidence narrative to
`main`. Its corrected head passed 66 unit tests and the complete desktop/mobile
browser gate before merge. No V1.1 data work has started.

### 1A. Discovery and scalable navigation

- Keep `ModeDefinition` as pure static metadata. Add explicit `MODE_ORDER`, a
  shared `ModePanel` shell, and one exhaustive presentation/controls dispatch so
  `App` does not grow a new set of literal branches per mode. Do not put React
  hooks, loaders, renderer access, or camera callbacks in the registry.
- Add a versioned, dismissible first-interaction hint stored only in
  `localStorage`. Only a drag beyond the selection threshold, wheel/pinch zoom,
  point selection, or keyboard globe action dismisses it; pointerdown and hover
  do not. Storage failure degrades to session-only display and never blocks App.
- Add a keyboard-complete Mode Atlas dialog rendered entirely from
  `MODE_DEFINITIONS`.
- Add a permanent Mode Atlas button to the right side of the Header. Keep the
  current three direct bottom navigation targets in V1; redesign that navigation
  only when a fourth target is separately designed and approved.
- Preserve the current point, camera policy, URL history, and direct first
  screen. The Atlas is not a route, landing page, tutorial, or plugin market.
- Restore focus to the opener on close and move focus to the new mode title
  after an Atlas selection.

Acceptance:

- first visit → one operation → hint disappears → refresh keeps it dismissed;
- Atlas supports focus containment, Escape, opener restoration, mode selection,
  back/forward, Chinese/English, reduced motion, and 320–390 px layouts;
- on mobile it is the only active modal layer: background controls/navigation
  are inert or equivalently isolated, Share is mutually exclusive, every touch
  target is at least 44 px, and closing restores the prior layout and focus;
- opening/closing Atlas never mutates a shared URL;
- initial entry bundle grows by no more than 15 kB gzip.

### 1B. Development evidence and narrative

- Add pure, null-safe equal-weight global median calculations for the selected
  indicator/year, including observed count.
- Show the selected value, difference from median, and change since that
  country's earliest earlier observation. Use absolute index-point differences,
  never percentages or causal language.
- Sort the semantic table alphabetically and add median/history evidence,
  removing the current implicit ranking.
- Add a deterministic same-year algorithmic structural contrast. Exclude the
  selected country; require HDI, health, education, and income for both rows and
  `abs(candidate.hdi - selected.hdi) <= 0.020`. Choose the candidate with the
  largest equal-weight L1 structural distance
  `|Δhealth| + |Δeducation| + |Δincome|`, tie-breaking by ascending ISO3. Compute
  with source precision and round only for display. Never widen the window or
  impute missing values.
- Call it an “algorithmically selected contrast”, not a peer: it is deliberately
  selected to reveal a structural difference and does not imply typicality,
  similar social conditions, or causation.
- Keep all calculations derived from the existing HDR 2025 snapshot. Add no
  store state, URL parameter, or new data asset.

Acceptance:

- tests cover even/odd/empty medians, invalid years, missing endpoints, non-1990
  baselines, negative change, contrast ties, and unavailable comparisons;
- fixed asset baselines include 2023 HDI median `0.762` (`n=193`) and China 2005
  education `0.540`, median difference `-0.066`, change since 1990 `+0.163`;
- fixed contrast baselines include China 2005 → Gabon (`L1=0.3861`) and China
  2023 → Palau (`L1=0.3177`), plus missing/no-candidate/ISO-tie fixtures;
- result, method, and semantic table agree in both languages and mobile layout;
- table columns are country, selected value, delta to median, and historical
  endpoint change; unknown history remains unknown;
- the UNDP chunk remains lazy and absent from an Other Side-only request trace.

### 1C. Milestone gate

- full local `pnpm check` and desktop/mobile Playwright;
- architecture review for mode boundaries and bundle/data gating;
- product/accessibility review for the 10-second loop, focus, copy, and mobile;
- data/release review for calculations, visible methods, license, and clean tree;
- reviewed PR merged only after required remote checks are green.

## Milestone 2 — public V1 release

Status: **completed historical milestone**. Public surface PR #2, Pages-path PR
#3, and final evidence PR #4 are merged. Final CI, Pages, desktop/mobile live
smoke, tag, and Release agree on `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`.

The smallest responsible public-showcase slice is defined in
[MVP_RELEASE_PLAN.md](MVP_RELEASE_PLAN.md). Execute that plan first. The
contribution templates, extended repository automation, and other open-source
maturity work below may follow the live MVP unless a release review promotes a
specific item to P0/P1.

Zero-context execution agents must begin with the repository root
[`AGENTS.md`](../AGENTS.md), which records the current GitHub state, remaining
sequence, mandatory visibility pause, final evidence PR, and SHA-identity gate.

- English canonical README plus full Chinese README.
- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, data-source overview,
  mode proposal template, issue/PR templates, and a contribution walkthrough
  using the existing Other Side mode. No fake/example mode is registered,
  bundled, or presented as a plugin contract.
- Visible Natural Earth attribution and complete third-party license inventory.
- CI: full desktop/mobile browser matrix, production dependency audit, generated
  asset hashes, pinned maintained Actions, and production deployment smoke.
- Dedicated full-history secret scan; enable Dependabot, secret scanning/code
  scanning where available; protect `main` with required checks.
- GitHub Pages deployment, repository description/homepage/social preview,
  intentional production source-map policy, public visibility, V1 tag/release,
  and live URL verification.

Publication is atomic and ordered: release-candidate version/changelog → required
CI plus security/license review and Pages artifact rehearsal → public visibility
→ enable available protection/scanning → deploy → Pages live smoke → set homepage
→ `v1.0.0` tag/release. The tag target SHA must equal the live-verified Pages
deployment SHA and must not precede the successful smoke. If private Pages is
unavailable, the rehearsal gate is a built and inspected Pages artifact, not a
skipped gate.

Gate: do not switch the repository public until security, licensing, governance,
CI, deployment rehearsal, and final clean-tree reviews all pass.

## Deferred after this goal

- Pleiades/Wikidata cultural mode discovery and licensing spike.
- General plugin/runtime marketplace.
- 50m country-boundary upgrade, place-name basemap, time zones, weather, or
  street-level GIS features.
