# Mundus Continuation Handoff

Status: active zero-context entry point for post-V1.1 product and development

Verified snapshot: 2026-09-19, Asia/Shanghai

## 1. Mission

You are taking over Mundus as both its technical product lead and its primary
developer.

Your job is not to accept every proposed feature or immediately write code. You
must keep a current model of the product, challenge scope, decide what is worth
building, turn an accepted direction into bounded requirements, and then carry
the implementation through tests, reviews, documentation, and release evidence
within the repository's authorization rules.

Mundus is a long-lived personal digital globe for seeing one planet through
different scientific and cultural lenses. The three current modes are the first
delivered lenses, not a commitment to a fixed final set. Expansion must preserve
the product's identity as:

> digital museum exhibit × scientific instrument × interactive atlas

It is not a navigation product, professional GIS editor, arbitrary layer
catalog, runtime plugin marketplace, account service, or backend platform.

## 2. Read Order And Authority

Read these sources in order before changing product or remote state:

1. `AGENTS.md` — repository safety, architecture, data, release, and frozen V1
   history.
2. This file — the current continuation role, first assignment, and product
   decision workflow.
3. `docs/ROADMAP_HANDOFF.md` — active roadmap authority and GHSL phase state.
4. `docs/GHSL_EXECUTION_HANDOFF.md` — terminal GHSL evidence, not restart
   permission.
5. `README.md` and `README.zh-CN.md` — current public product promise.
6. `docs/IMPLEMENTATION.md` — shipped implementation and evidence record.
7. `docs/PROJECT_PLAN.md` — stable product, experience, architecture, and data
   principles.
8. `DATA_SOURCES.md`, `THIRD_PARTY_LICENSES.md`, and `SECURITY.md` — public data,
   licensing, and security contracts.
9. Current Git, GitHub, Pages, artifact, test, and live evidence.

When sources disagree, current product-owner instructions and explicit approval
gates win, followed by `AGENTS.md`, this file, the tracked roadmap/handoffs, and
fresh repository evidence. Historical plans, migrated conversations, snapshots,
and older status text are evidence only.

## 3. Verified Current Baseline

This snapshot helps detect drift; refresh it before relying on it.

- Public repository: <https://github.com/0mn1si2i5/Mundus>
- Public product: <https://0mn1si2i5.github.io/Mundus/>
- Remote `main` at verification:
  `1c6beb9f8b3b92149e847d1840825a6eadb7a4bd`
- PR #9, “Exhibit Shell V2: mode-neutral lobby, curated orbit, scalable Mode
  Atlas,” and PR #11, “Align live smoke with the Exhibit Shell lobby,” are
  merged. No unreleased observation remains in the current product. The public
  shell entered `main` at `1c6beb9f8b3b92149e847d1840825a6eadb7a4bd` after its
  quality,
  browser-smoke, vector-data-full, and Pages artifact checks passed and both
  review conversations were resolved.
- `main` requires strict `source-quality`, `vector-data-full`, `browser-smoke`,
  and `pages-artifact` checks; private vulnerability reporting is enabled.
- The only tag and GitHub Release are `v1.0.0`, targeting
  `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`.
- The public product is described as V1.1.0 Parchment Atlas, but no V1.1 tag or
  GitHub Release exists.
- The current checkout contains the public product `main` and `v1.0.0` tag. It
  does not contain restored private GHSL worktrees or the large migration proof
  tree.

The absence of restored research state is not evidence of data loss. The
dedicated private migration release preserves it. Do not restore it merely to
make the checkout resemble the old device.

### Refresh commands

Run these read-only checks at the start of a continuation batch:

```bash
pwd
git status --short
git status --ignored --short
git branch -vv
git worktree list
git log -15 --oneline --decorate
git remote -v
git tag --list --sort=-creatordate
gh repo view 0mn1si2i5/Mundus \
  --json nameWithOwner,visibility,url,homepageUrl,defaultBranchRef
gh pr list --repo 0mn1si2i5/Mundus --state all --limit 15
gh run list --repo 0mn1si2i5/Mundus --limit 12
gh release list --repo 0mn1si2i5/Mundus --limit 10
gh api repos/0mn1si2i5/Mundus/branches/main/protection
gh api repos/0mn1si2i5/Mundus/pages
gh api repos/0mn1si2i5/Mundus/private-vulnerability-reporting
```

Then verify that the public URL responds and serves relative project assets:

```bash
curl -L --fail --silent --show-error \
  --output /tmp/mundus-live-index.html \
  https://0mn1si2i5.github.io/Mundus/
rg -n '<title>|<script|<link' /tmp/mundus-live-index.html
```

Never discard an unexpected local change. Existing changes belong to the user
unless the current task proves otherwise.

## 4. Shipped Product

### Other Side

The default signature mode asks where a straight path through Earth's center
would emerge.

Users can select a point through globe interaction, coordinates, bilingual
GeoNames major-city search, examples, or permission-based geolocation. The mode
shows exact endpoints, country/ocean results, center-line and surface distance,
and the nearest eligible represented major city to each endpoint in the pinned
GeoNames snapshot.

Those cities are represented major-city results, not the nearest settlement,
administrative boundary, built area, or complete gazetteer result.

The current share dialog creates one canonical-precision location URL with an
explicit privacy disclosure. Existing whole-degree URLs remain readable. Other
Side also provides the draggable through-Earth cross-section, bilateral focus,
and short endpoint-to-city relation arcs.

### Development, Unpacked

This mode asks what different health, education, and income structures can
underlie similar reported development levels.

It uses the fixed UNDP Human Development Report 2025 snapshot for 1990–2023.
Users can inspect HDI and derived health, education, and income dimension
indices, global median, difference from median, historical endpoint change, and
one bounded same-year structural contrast selected within an HDI window.

The contrast is not a peer classification, ranking, causal explanation, or
claim of typicality. Missing values remain unknown and are never converted to
zero or silently imputed.

### Sunline

Sunline calculates solar position, day/night terminator, civil-twilight band,
subsolar point, local solar altitude, and approximate sunrise/sunset locally in
the browser.

It supports live time and a fixed UTC minute from 2000 through 2099. The visible
third state is `曙暮光 / Twilight`; the internal scientific classification
remains `civil-twilight` over `[-6°, 0°)`. Results are educational and must not
be presented as legal, navigational, aviation, astronomical, or engineering
time services.

### Shared experience

- The first screen is the globe, not a marketing page.
- Chinese and English must agree in meaning.
- Desktop and mobile complete the same core loop.
- Keyboard operation, focus management, reduced motion, semantic DOM results,
  and WebGL failure behavior are product requirements.
- Mode switching preserves the selected geographic context and camera policy.
- Opening Mode Atlas or Share must not mutate shareable URL state.
- Sources, years, units, methods, missing states, licenses, and caveats remain
  visible when relevant.

## 5. Product-To-Code Map

| Product responsibility                                           | Current implementation                                                  |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Application composition, header, navigation, dialogs, boundaries | `src/app/App.tsx`, `src/app/App.module.css`                             |
| URL/history synchronization                                      | `src/app/useUrlState.ts`, `src/state/urlState.ts`                       |
| Cross-feature state and camera intent                            | `src/state/appStore.ts`                                                 |
| Bilingual product copy                                           | `src/i18n/messages.ts` plus bounded component copy                      |
| Pure mode metadata and ordering                                  | `src/features/modes/modeRegistry.ts`                                    |
| Exhaustive domain-to-globe presentation                          | `src/features/modes/useModePresentation.ts`                             |
| Finite controls and result dispatch                              | `src/features/modes/ModeControls.tsx`, `ModeResult.tsx`                 |
| One Canvas, camera, quality, picking, context recovery           | `src/features/globe/`                                                   |
| Other Side calculations, cities, search, relation                | `src/features/antipodes/`                                               |
| Development dataset, evidence, colors, controls                  | `src/features/development/`                                             |
| Solar calculations and time controls                             | `src/features/sunline/`                                                 |
| Share snapshot, privacy copy, canonical URL                      | `src/features/share/`                                                   |
| Manifests, generated assets, runtime validation                  | `src/data/manifests/`, `src/data/generated/`, `src/data/registry.ts`    |
| Reproducible data and artifact tooling                           | `scripts/`                                                              |
| Browser and live release evidence                                | `tests/e2e/`, `.github/workflows/ci.yml`, `.github/workflows/pages.yml` |

Important implementation facts:

- `ModeDefinition` is pure metadata. Do not add loaders, hooks, renderers,
  mutable runtime state, or a general plugin contract to it.
- The current runtime uses explicit exhaustive dispatch. A new lens requires a
  deliberate product and architecture decision, not dynamic registration.
- The app owns exactly one WebGL Canvas and renderer.
- Globe internals remain behind the globe kernel; mode controls do not own
  Three.js meshes or global camera objects.
- Production uses `frameloop="demand"` except during intentional animation.
- Natural Earth 110m/50m vector assets, GeoNames, and UNDP data are pinned,
  generated, hashed, licensed, and fail-closed.
- Static hosting, relative asset paths, no production source maps, complete
  notices, and semantic fallbacks are release invariants.

## 6. Product Decision Framework

Evaluate every material proposal before accepting implementation.

### Should Build

Use when evidence shows a clear user problem, the work reinforces the Mundus
product loop, data and licensing are credible, scope is bounded, and the value
justifies implementation and release cost.

State:

- user and problem;
- expected finding or behavior;
- why Mundus is the right product surface;
- minimum responsible scope;
- dependencies and risks;
- measurable acceptance criteria;
- required approvals.

### Should Delay

Use when the direction may be valuable but a dependency, budget, evidence,
license, design, or product decision is missing. Name the exact gate that would
change the decision.

### Should Reject

Use when the proposal weakens product identity, duplicates existing behavior,
creates unjustified platform complexity, relies on unacceptable data or
scientific claims, or cannot fit the static and accessible architecture.

### Need More Context

Use when the problem or expected finding is unclear. Ask for the minimum
information needed to decide; do not turn uncertainty into implementation.

For all four outcomes, report user value, effort, technical/data risk,
opportunity cost, recommendation, and next action. Be concise, critical, and
willing to reject scope expansion.

## 7. Current Roadmap Fork

### Completed public path

V1.0.0, V1.1 Parchment Atlas, and the interaction-clarity correction are public.
Do not repeat their convergence, visibility, deployment, tag, or evidence
procedures.

### Stopped GHSL path

Human Morphology was designed as a globally complete shared overlay, not a
fourth mode. Plan 1 passed strict topology and representative checks, but the
formal fill stage projected about 10.81 hours and exceeded the approved
eight-hour ceiling. Builds A and B remained incomplete. The terminal decision
is `STOP_GLOBAL_MORPHOLOGY` at
`6e396d90ef215085a3d5bc8dbf602b6e4f239051`.

Plans 2–7 are frozen. Do not resume or reuse the incomplete builds, start
runtime/UI/rendering work, loosen scientific rules, reduce global completeness,
or reinterpret the evidence as a technical GO.

### Accepted bounded next direction

The product owner accepted a bounded low-resource cultural observation using
redistribution-safe community data. The accepted packet is the Surname Atlas:
one static rank-one surname asset, explicit provenance and missing states, and
no backend, crawler, runtime translation service, or new renderer. GHSL remains
closed and its terminal evidence is unchanged.

Before any further feature implementation, the product owner must choose one
of these outcomes:

1. close or indefinitely defer GHSL and revise the roadmap to permit a new
   direction;
2. retain the current three-mode product while gathering user evidence;
3. formally reopen GHSL with a new design/plan that addresses measured budgets;
4. choose another bounded direction and first produce a separate design and
   approval packet.

The Surname Atlas implementation is now tracked in `src/features/surnames/`,
with its data contract and source decision recorded in
`docs/NAMING_OBSERVATION_RESEARCH.md`. It is currently frozen while the
terminal migration and GHSL evidence are retired. Release validation for this
packet must still pass the normal protected-main, Pages artifact, and
desktop/mobile gates when work resumes.

Do not silently choose on the owner's behalf.

## 8. First Assignment

Before implementing a new feature, deliver a **Mundus continuation assessment
packet**.

It must:

1. refresh the local, remote, Pages, release, protection, and live state;
2. inspect and preserve every local change;
3. verify the shipped product identity and document any drift after PR #11;
4. separate current deployment identity from V1.0/V1.1 tag and Release metadata;
5. recommend how to resolve release-identity debt without making the remote
   change;
6. assess the roadmap fork using `Should Build`, `Should Delay`,
   `Should Reject`, or `Need More Context`;
7. if evidence supports continuation, propose exactly one bounded next product
   packet with requirements, architecture/data constraints, risks, validation,
   stop conditions, and acceptance criteria;
8. request product-owner approval before implementation begins.

Recommended investigation order:

1. keep GHSL closed unless the product owner explicitly reopens it with a new
   budgeted design and execution plan;
2. evaluate one bounded low-resource cultural or naming observation packet;
3. obtain product-owner approval and a bounded implementation packet before
   data collection or runtime integration;
4. align tracked handoff and data documentation with the verified state;
5. run the post-integration desktop/mobile and artifact gates.

## 9. Migration Evidence

The dedicated Mundus migration packet was retired on 2026-09-25 after the
current checkout, terminal GHSL handoff, and local recovery inventory were
audited. The private repository
`0mn1si2i5/Mundus-migration-2026-08`, its release, the local
`/Users/ostrovsky/Mundus-restore` packet, and the stale GHSL worktree were
removed. There is no remaining restore path for that packet.

The following separate repositories still preserve unrelated device-migration
context:

- `0mn1si2i5/Zen-migration-2026-08` — cross-project recovery control plane and
  restore evidence;
- `0mn1si2i5/Codex-session-archive-2026-08` — sanitized historical Codex
  sessions, attachments, and memories;

Use migrated conversations and plans to understand why decisions were made.
Never treat them as current Git, product, or authorization truth. Verify every
material claim against this checkout and current remote evidence.

The terminal GHSL decision and its measured evidence remain summarized in
`docs/GHSL_EXECUTION_HANDOFF.md`. The deleted packet contained recovery inputs
and incomplete build outputs, not a runtime dependency or a completed build.
Future GHSL work requires a separately approved reopening and a new source and
execution plan; it cannot rely on the retired packet.

## 10. Development Workflow After Approval

When implementation work is handed to Claude Code or another execution agent,
that agent must follow `docs/EXECUTOR_PROTOCOL.md`. That protocol defines the
executor's role, authority, task-packet structure, verification, and return
format; do not copy the full protocol here.

For an accepted product packet:

1. write a focused design with explicit user behavior, data semantics,
   architecture boundaries, failure states, accessibility, and acceptance;
2. obtain product-owner approval;
3. write a repository-grounded implementation plan;
4. use the task packet's independent `codex/` branch inside a `.worktrees/`
   worktree by default; only bootstrap or governance tasks may be exempted by
   explicit main-brain approval;
5. demonstrate the current gap with a focused failing test or deterministic
   reproduction;
6. implement in small, reviewable slices;
7. run focused tests after each slice;
8. complete product/accessibility and engineering/release reviews;
9. run `git diff --check` and proportionate repository gates;
10. for product changes, run `pnpm check` and complete desktop/mobile
    `pnpm test:e2e`;
11. for an authorized release, require verified Pages artifact, protected-main
    deployment, same-SHA live smoke, manual product validation, and durable
    evidence writeback.

Use Node.js `22.23.1` and pnpm `11.7.0` for CI parity. Do not loosen assertions,
increase timeouts, add retries, or skip tests merely to make a gate green.

## 11. Authorization Boundary

The agent may autonomously perform read-only inspection, local analysis,
approved in-scope file changes, focused tests, full local gates, and local
design/plan preparation.

An approved session task packet may authorize staging and local step-wise
commits. The packet must specify the branch/worktree and the commit boundaries;
any staging or commit outside the packet still requires separate authorization.

Obtain separate authorization before:

- pushing a branch or creating/updating a pull request;
- merging, deploying, tagging, or creating a GitHub Release;
- changing repository visibility, Pages, protection, vulnerability reporting,
  secrets, permissions, or other remote settings;
- rewriting history or deleting/restoring material state;
- restarting GHSL or beginning Plans 2–7;
- changing GHSL source, threshold, connectivity, completeness, containment,
  format, or resource ceilings;
- restoring the large migration snapshot;
- starting a post-GHSL feature before its design and plan are approved.

Also pause if work would expose credentials, private assets, private migration
evidence, confidential issues, or licensing risk.

## 12. Standing Scope Decisions

Unless separately designed and approved:

- reject a general GIS editor, navigation product, or street map;
- reject runtime plugins, a marketplace, or arbitrary layer catalogs;
- reject backend, accounts, cloud user state, or telemetry infrastructure;
- reject weather, time-zone, live-event, PWA, and offline scope;
- do not execute the superseded population-density fourth-mode milestones;
- do not add a fourth mode merely to create roadmap activity;
- do not introduce a second Canvas, renderer, general event bus, UI framework,
  HTTP Range dependency, or backend tile service;
- do not silently update, fuzzy-match, impute, or redistribute data outside its
  reviewed manifest and license contract.

## 13. Continuation Success Condition

The handoff is working when a zero-context agent can:

- describe the current product and its three shipped lenses accurately;
- map user-visible behavior to the responsible modules;
- refresh potentially stale Git, GitHub, Pages, release, and live evidence;
- distinguish deployed V1.1 behavior from V1.0 release metadata;
- explain why GHSL stopped and why its preserved evidence is not executable
  authority;
- evaluate new ideas with product judgment before implementation;
- produce one bounded requirements packet and stop for approval;
- implement an approved packet without breaking static hosting, data identity,
  one-Canvas rendering, accessibility, bilingual meaning, sharing, or release
  verification.
