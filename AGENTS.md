# Mundus execution-agent startup guide

## Current authority — V1.1.0 Parchment Atlas live on Pages

Mundus **V1.1.0 Parchment Atlas** is deployed at
<https://0mn1si2i5.github.io/Mundus/>. PR #5 and its stacked PR #6 are merged;
the product implementation entered protected `main` at
`1a9c44700e2154186708772a7773fd8972a7aaf2` and passed same-SHA CI, Pages
deployment, live smoke, and desktop/mobile manual verification on 2026-08-02.
The public product includes the parchment presentation, draggable cross-section,
bilingual GeoNames search, bilateral city relations, and Natural Earth vector
globe.

A later interaction-clarity correction changes the current Share UI to one
canonical-precision location link with explicit privacy disclosure. Historical
whole-degree links remain readable. This current behavior supersedes, but does
not rewrite, the precise/approximate V1.0 history below.

Release metadata has a narrower boundary: tag `v1.0.0` and the GitHub Release
still target `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`. No `v1.1.0` tag or GitHub
Release exists. Do not create or retarget one without separate authorization.

The ignored V1.1 convergence plan and the tracked candidate/publication
documents are historical execution evidence. Do not execute their pre-merge
steps again or copy the ignored plan into Git.

The active roadmap authority is `docs/ROADMAP_HANDOFF.md`; older V1 release
text below is durable history unless current Git and remote evidence agree with
it.

This file is the required starting point for an agent entering this repository
with no previous context. Read it completely before changing files or remote
state.

## Current continuation assignment

For work after the published V1.1 product, read
`docs/CONTINUATION_HANDOFF.md` immediately after this file, then follow its
current-state refresh and first-assignment workflow. The continuing agent acts
as both Mundus's technical product lead and its primary developer: first
understand and challenge the next direction, then implement only an accepted,
bounded product packet.

Do not begin feature implementation merely because an older plan contains
executable steps. The first continuation deliverable is a
current product-and-repository assessment, a decision on the roadmap fork, and
a proposed next requirements packet for product-owner review. The active status
and product boundaries remain in `docs/ROADMAP_HANDOFF.md`; this continuation
entry does not authorize release metadata changes or remote-state mutation.

## Local resource impact gate

Every development batch should make a quick local-resource assessment before
execution. Ordinary builds, unit tests, and small fixtures do not need a
separate approval step. The warning gate is for work that could seriously
interfere with normal workstation use, especially when it may do any of the
following:

- consume or download about `50 GiB` or more of local storage;
- sustain near-total machine CPU usage (for example, about `100%` overall) for
  more than several minutes, or create clear thermal/throttling risk;
- create enough memory pressure to cause swapping or materially affect other
  applications;
- leave a large background process, worktree, generated cache, or resumable
  download running after the command exits; or
- have an unknown bound that could plausibly reach one of those conditions.

Before starting a serious-resource action, report the expected peak, duration,
storage location, retention period, cleanup command, and failure or resume
behavior. Then choose a local, external-volume, or cloud path with the product
owner; do not start a potentially disruptive local job silently. Prefer cloud
or external-volume execution for complete raw dumps, global builds, and other
work that exceeds these limits.

When local execution is accepted, keep raw inputs and generated caches outside
the repository worktree when possible, use an explicit bounded cache path, and
make cleanup a separate command that cannot run accidentally from `pnpm check`
or CI. Do not add serious-resource workloads to routine release gates. At the
end of the batch, report measured peak or final usage, what was retained, what
was removed, and whether another run would require a new download.

## Frozen V1 release history below

Sections 1–13 below preserve the completed V1.0.0 execution contract and must
not be executed as current release instructions. Current work starts from
`docs/ROADMAP_HANDOFF.md`. PR #5 remains the durable V1.1 review record. In
particular, do not repeat V1 visibility,
deployment, tag, or Release actions.

## 1. Your assignment

Your immediate job is to complete the smallest responsible Mundus V1 public
release. You are an execution agent, not a product-ideation agent. Finish the
accepted release path, verify it end to end, and record durable evidence.

Do not start V1.1 or add product features while V1 is not live. Do not turn this
project into a general GIS platform, plugin system, account product, or backend
service.

The current terminal condition is:

> A reviewed final `main` commit is deployed successfully to GitHub Pages, the
> public desktop and mobile site pass live smoke, the README and implementation
> record identify that verified site, and `v1.0.0` plus the GitHub Release point
> to the exact same final deployed SHA.

Local tests or a green pull request alone do not complete the assignment.

## 2. Authority and mandatory pause

You may autonomously inspect, edit, test, commit, push release-scoped branches,
update pull requests, and correct P0/P1 findings within the accepted V1 scope.

You must stop and ask the product owner for explicit confirmation immediately
before changing repository visibility from private to public. In the same
message, report:

- the exact repository and branch;
- the proposed public action;
- the PR and commit that will be released;
- current local and remote gate results;
- any remaining P0, P1, or P2 findings;
- whether Pages, branch protection, and private vulnerability reporting are
  currently configured.

Do not interpret an older plan, a previous general request to “publish,” or a
green CI run as permission to cross this visibility gate. After the owner gives
explicit approval, carry the release through to the terminal condition without
asking for routine implementation choices.

Also pause if completion requires any of the following and they have not been
provided or authorized:

- custom-domain ownership or DNS changes;
- deleting or rewriting Git history;
- exposing a credential, private asset, or confidential issue;
- accepting a data/license risk rather than resolving it;
- materially expanding the product beyond the V1 boundary.

## 3. Current ground-truth snapshot

Snapshot time: **2026-07-20 14:52, Asia/Shanghai**. This section is factual but can
become stale. Run the refresh commands in Section 5 before acting.

### Local Git

- Working directory: `/Users/bytedance/Desktop/Zen/Mundus`
- Remote: `https://github.com/0mn1si2i5/Mundus.git`
- Default branch: `main`
- Current local branch: `codex/v1-release-evidence`
- Current `main` SHA: `40c4ab2fdc7ff570924ff5f5c9ed6b024b7a1a77`
- Worktree was clean when this guide was written. Recheck it; never discard
  unknown changes.

### GitHub

- Repository: `0mn1si2i5/Mundus`
- Visibility: **public**
- Homepage URL: `https://0mn1si2i5.github.io/Mundus/`
- Pages site: enabled with GitHub Actions and HTTPS at
  `https://0mn1si2i5.github.io/Mundus/`
- `main` branch protection: enabled with strict `source-quality`,
  `vector-data-full`, `browser-smoke`, and `pages-artifact` checks plus resolved
  review conversations
- Private vulnerability reporting: enabled
- Tags/releases at this historical snapshot: no `v1.0.0` release was found;
  the current-authority section above records its later completion

### Pull requests

- PR #1, “Complete the Mundus V1 product loop”: merged.
- PR #2, “Prepare the V1 public release surface”: merged.
- PR #3, “Add the verified GitHub Pages release path”: merged.
- PR #3 URL: `https://github.com/0mn1si2i5/Mundus/pull/3`
- PR #3 merge: `40c4ab2fdc7ff570924ff5f5c9ed6b024b7a1a77`
- PR #3 remote results at the snapshot:
  - `source-quality`: success;
  - `vector-data-full`: success;
  - `browser-smoke`: success;
  - `pages-artifact`: success;
  - `deploy-pages`: intentionally skipped on a pull request;
  - `live-smoke`: intentionally skipped because nothing was deployed.
- Pages deployment and live smoke:
  `https://github.com/0mn1si2i5/Mundus/actions/runs/29722665114`
- CI run:
  `https://github.com/0mn1si2i5/Mundus/actions/runs/29722665105`

### Latest local validation

Validated on the PR #3 head while preparing this guide:

- `pnpm check`: pass;
- unit tests: 66 passed in 15 files;
- production build: pass;
- Pages artifact: 22 files, required license/notices present, zero source maps;
- `pnpm test:e2e`: 45 passed, 3 intentional skips, across desktop Chromium and
  Pixel 7 projects.

Do not reuse these numbers as current proof after changing a file. Rerun the
appropriate gate and record the new output.

## 4. Read these files in order

Do not begin by scanning random implementation files. Read the following in
order so product intent and release boundaries remain intact:

1. `AGENTS.md` — this startup and execution contract.
2. `docs/ROADMAP_HANDOFF.md` — planning layers, current handoff entry point,
   and the bounded product direction.
3. `docs/MVP_RELEASE_PLAN.md` — release packets, P0/P1/P2 rules, and final
   acceptance checklist.
4. `docs/RELEASE_RUNBOOK.md` — exact Pages artifact, deploy, live-smoke, and
   rollback behavior.
5. `README.md` and `README.zh-CN.md` — public product promise and operator
   commands.
6. `docs/IMPLEMENTATION.md` — completed product slices and evidence history.
7. `docs/EXECUTION_PLAN.md` — V1-to-V1.1 sequencing. Do not start Milestones 3
   or 4 during this assignment.
8. `docs/PROJECT_PLAN.md` — stable product scope, experience principles,
   architecture boundaries, data policy, and release acceptance.
9. `SECURITY.md`, `DATA_SOURCES.md`, and `THIRD_PARTY_LICENSES.md` — public
   security and licensing contract.
10. `.github/workflows/ci.yml` and `.github/workflows/pages.yml` — remote gates
    and deployment permissions.
11. `package.json`, `vite.config.ts`, `playwright.config.ts`, and
    `playwright.live.config.ts` — local gate, artifact policy, and browser
    projects.

The product-plan and data-method sections are stable decisions. Status headers
in older documents may lag behind GitHub; current Git and GitHub evidence wins.
If you discover drift, update the documentation during the final evidence PR.

## 5. First 15 minutes: refresh reality

Run these read-only checks before deciding what is left:

```bash
pwd
git status --short
git status --ignored --short
git branch -vv
git log -12 --oneline --decorate
git remote -v
gh repo view --json nameWithOwner,visibility,isPrivate,url,homepageUrl,defaultBranchRef
gh pr status
gh pr view 4 --json number,title,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,headRefOid,baseRefOid,statusCheckRollup
gh run list --limit 12
gh release list --limit 10
git tag --list --sort=-creatordate
```

Then check the three remote release settings without mutating them:

```bash
gh api repos/0mn1si2i5/Mundus/branches/main/protection
gh api repos/0mn1si2i5/Mundus/pages
gh api repos/0mn1si2i5/Mundus/private-vulnerability-reporting
```

A `404` currently means the corresponding feature is not configured or is not
available under the private repository state. Do not treat it as a transient
network success.

If the worktree is dirty, inspect every change. Existing changes belong to the
user unless clearly produced by your current work. Never run `git reset --hard`,
`git checkout --`, clean untracked files, rewrite history, or discard changes
without explicit authorization.

## 6. Product model

Mundus is a static, client-side, interactive three-dimensional Earth exhibit.
Its design metaphor is:

> digital museum exhibit × scientific instrument × interactive atlas

It is not a navigation tool, street map, professional GIS editor, data
dashboard, or general visualization platform. Its core experience loop is:

1. choose an observation lens;
2. manipulate the globe;
3. obtain one clear finding;
4. inspect explanation, method, and source;
5. share the current state;
6. move to another lens while preserving geographic context.

The V1 value comes from three deep, distinct modes rather than many shallow
layers:

### Other Side (`antipodes`)

- Default entry and signature mode.
- Select a point by globe interaction, coordinates, local city search, curated
  example, or permission-based geolocation.
- Calculate the antipode locally.
- Show exact origin and antipode countries/oceans, coordinates, center-line and
  half-circumference distances, plus the nearest eligible major city to each
  endpoint in the bundled GeoNames snapshot.
- The bilateral city results are represented major-city entries, not nearest
  settlements, administrative boundaries, built areas, or a complete
  gazetteer.
- Sharing exact coordinates must retain the precise/approximate privacy choice.

### Development, Unpacked (`development`)

- Uses the fixed UNDP Human Development Report 2025 snapshot for 1990–2023.
- Presents HDI plus health, education, and income dimension indices.
- Shows global median, difference from median, historical endpoint change, and
  an algorithmically selected same-year structural contrast.
- The contrast is deliberately selected within an HDI window of `±0.020`; it is
  not a “peer,” proof of similarity, ranking, causal explanation, or typical
  comparison.
- Missing data stays unknown (`null`), never zero and never imputed.
- The semantic table is alphabetical, not a disguised ranking.
- The UNDP asset must remain lazy and absent from an Other Side-only request.

### Sunline (`sunline`)

- Calculates the solar position, day/night terminator, civil-twilight band,
  subsolar point, local solar altitude, and approximate sunrise/sunset entirely
  in the browser.
- Accepts live time or a fixed UTC minute between 2000 and 2099.
- Uses educational NOAA/Meeus-style approximations.
- Never present results as legal, navigational, aviation, astronomical, or
  engineering time services.

### V1 experience requirements

- The first screen is the globe, not a marketing landing page.
- Chinese and English must agree in meaning.
- Desktop and mobile must complete the same product loop.
- Keyboard, focus management, reduced motion, semantic DOM alternatives, and
  WebGL failure behavior are release requirements, not polish.
- Data source, year, method, unit, missing state, license, and caveat must be
  visible when relevant.
- Opening the Mode Atlas or Share dialog must not mutate shareable URL state.
- Mode switching preserves the selected geographic point and camera policy.

## 7. Architecture map and invariants

The app is deliberately a thin static client. Do not introduce a backend,
runtime plugin loader, UI framework, general event bus, or second renderer.

### Application shell

- `src/app/App.tsx` composes the header, one lazy globe viewport, result layer,
  controls, direct mode navigation, Mode Atlas, share dialog, and first-use
  hint.
- `src/app/useUrlState.ts` synchronizes browser history with shareable state.
- `src/i18n/messages.ts` is the bilingual UI copy source.
- `src/styles/global.css` and CSS Modules define the visual system. Do not add a
  generic component library for release work.

### State and URL

- `src/state/appStore.ts` is the small Zustand store.
- `src/state/urlState.ts` validates and serializes versioned query state.
- Default point: Shanghai, `31.2304,121.4737`.
- Default mode: `antipodes`.
- Shareable parameters include `mode`, `point`, Development `indicator/year`,
  and fixed Sunline `time`; non-default state uses `v=1`.
- Coordinates serialize to at most four decimals.
- Continuous time/camera-like updates replace history rather than flooding it.
- Locale and first-use behavior are local preferences, not cloud user state.

### Mode orchestration

- `src/features/modes/modeRegistry.ts` owns static metadata and `MODE_ORDER`.
- `ModeDefinition` must remain pure metadata. Do not place React hooks, data
  loaders, renderer objects, camera callbacks, or mutable runtime state there.
- `src/features/modes/useModePresentation.ts` is the exhaustive presentation
  dispatch.
- `ModeControls.tsx` and `ModeResult.tsx` are the finite UI dispatch boundaries.
- A mode may fail and recover without taking down the entire app.

### Globe kernel

- `src/features/globe/GlobeViewport.tsx` owns the single WebGL Canvas and mode
  visualization composition.
- `geo.ts`, `interaction.ts`, `countryData.ts`, `quality.ts`, and `webgl.ts`
  provide isolated calculation/capability behavior.
- Do not expose Three.js mesh internals to mode controls.
- Maintain `frameloop="demand"` behavior except during intentional animation.
- Preserve WebGL context-loss recovery, resource cleanup, automatic quality,
  reduced-motion behavior, and semantic fallbacks.

### Data

- Machine-readable manifests live in `src/data/manifests/`.
- Reviewed derived snapshots live in `src/data/generated/`.
- Rebuild scripts live in `scripts/` and must pin upstream URLs and SHA-256.
- `src/data/registry.ts` validates manifests and exposes resources.
- `pnpm data:verify` is fail-closed: a hash mismatch is a release blocker.
- Never silently update an upstream version, fuzzy-match countries at runtime,
  convert missing data to zero, or commit large raw downloads.

### Release artifact

- Vite uses `base: './'` so project Pages and other static hosts work.
- Production target is ES2022.
- Production source maps are intentionally disabled.
- The bundle emits `THIRD_PARTY_NOTICES.md` and copies required release/license
  material into `dist/`.
- `scripts/verify-pages-artifact.mjs` rejects missing required files, symlinks,
  source maps, root-relative/broken assets, and empty dependency notices.
- `dist/` is generated and ignored. Never commit it.

## 8. Toolchain and commands

Use Node.js **22.23.1** for parity with CI and pnpm **11.7.0**. The package
manager is declared in `package.json`; always honor `pnpm-lock.yaml`.

Install:

```bash
pnpm install --frozen-lockfile
```

Local development:

```bash
pnpm dev
```

Complete non-browser gate:

```bash
pnpm check
```

`pnpm check` currently performs, in order:

1. `pnpm check:source`: Prettier check, ESLint with zero warnings, TypeScript
   project build/typecheck, the pinned Node.js toolchain check, generated-data
   hash verification, the GeoNames data tests, the Vitest unit/integration
   suite, and Pages artifact verifier contract tests;
2. the focused Natural Earth vector-data tests;
3. the production build plus release notices;
4. Pages artifact verification against the generated `dist/`.

The full vector-data suite runs separately as `pnpm test:data-vector-globe:full`
in CI so `source-quality` can keep its focused vector tests while
`vector-data-full` provides the complete vector validation. Both checks are
required directly by protected `main`; there is no pass-through aggregator
job. The literal `/Mundus/`
mount rehearsal (`pnpm test:release-server`) remains an explicit low-frequency
release exercise and is not part of the routine source gate.

Complete local desktop/mobile browser gate:

```bash
pnpm test:e2e
```

Artifact-only verification:

```bash
pnpm release:verify
pnpm release:verify /path/to/unpacked-pages-artifact
```

Live release smoke requires an already deployed URL:

```bash
MUNDUS_LIVE_URL='https://0mn1si2i5.github.io/Mundus/' \
  pnpm exec playwright test --config=playwright.live.config.ts
```

The live smoke suite is intentionally small. It proves the host serves the
artifact and the initial WebGL experience renders on desktop/mobile. It does
not replace the full local E2E suite or the manual product checklist.

## 9. Test interpretation

- Unit baseline at this snapshot: 66 passing tests in 15 files.
- Full E2E baseline: 48 cases enumerated, 45 passed and 3 intentionally skipped.
- The skips come from project applicability, not unresolved failures. Inspect
  the exact Playwright report before repeating this claim.
- Browser tests run serially because WebGL capability/fallback tests share a
  finite GPU context budget.
- Do not increase timeouts, add retries, remove assertions, or mark a test
  skipped merely to make a release green.
- A flaky or timed-out result must be reproduced and investigated. Test the
  exact failure path first, then rerun the full relevant gate.
- Headless FPS is not evidence of real-device performance. Existing desktop and
  iPhone measurements live under `docs/performance/`.

Release severity:

- **P0:** secret/security exposure, invalid or prohibited data/license,
  corrupted artifact, public history leak, or unreproducible deployment. Stop.
- **P1:** broken mode, incorrect result, mobile primary-flow blocker,
  inaccessible primary control, broken sharing, missing required attribution,
  failed CI/Pages/live smoke. Stop and fix.
- **P2:** cosmetic defect, optional governance/documentation gap, or a
  non-primary environment issue with a safe fallback. Record it; do not inflate
  the MVP unless it materially harms the showcase.

## 10. What is already complete

Do not repeat this work unless a regression or current diff invalidates it:

- V1 product loop and all three modes;
- first-interaction hint and keyboard-complete Mode Atlas;
- Development median/history/structural-contrast narrative;
- visible Natural Earth country-boundary and GeoNames major-city attribution in
  Other Side;
- English canonical README and Chinese README;
- security policy;
- data-source and third-party-license documentation;
- intentional no-source-map production policy;
- bundled dependency notices and release artifact verifier;
- pinned GitHub Actions and Node/pnpm versions;
- PR-only Pages artifact rehearsal;
- main-only Pages deploy job with least-privilege write permissions;
- automated post-deploy desktop/mobile live smoke;
- rollback runbook.

The remaining work is the final evidence PR, complete public-site validation,
the matching tag/Release, and final SHA readback—not another feature batch.

## 11. Exact remaining execution plan

### Phase 0 — completed release-path setup

PR #3 merged as `40c4ab2fdc7ff570924ff5f5c9ed6b024b7a1a77` after
review and green required checks. The repository is public, `main` protection
is active, private vulnerability reporting is enabled, and GitHub Actions Pages
is enabled with HTTPS. The first production Pages run and automated desktop and
mobile live smoke passed. Do not repeat these steps unless current GitHub state
shows a regression.

### Phase 1 — complete live product validation

Use the URL returned by `actions/deploy-pages`, expected to be
`https://0mn1si2i5.github.io/Mundus/`. Verify the actual output; do not hardcode
success from the expected address.

Automated evidence:

- Pages workflow success;
- `live-smoke` success on desktop and mobile;
- successful response and document title;
- no failed core asset request;
- completed WebGL frame sample.

Manual product smoke in both a desktop and mobile viewport:

1. Open the root URL directly and with a hard refresh.
2. Confirm the default Other Side view loads without a fatal console error.
3. Select a point, verify exact origin/antipode results, both nearest eligible
   GeoNames major cities, scope caveat, and Natural Earth/GeoNames attribution.
4. Use a precise share URL and an approximate share URL; reload each and verify
   the intended state and privacy precision.
5. Open/close Mode Atlas by pointer and keyboard; verify focus restoration.
6. Switch to Development; confirm map, controls, semantic table, median/history
   evidence, contrast language, source, year, unit, and missing-state behavior.
7. Switch to Sunline; test fixed time, playback, return to now, selected-place
   result, UTC labeling, and educational caveat.
8. Switch Chinese/English and verify document language/title and core meaning.
9. Test reduced motion and keyboard globe operation.
10. Exercise or simulate WebGL unavailability and context loss; confirm a
    meaningful DOM/fallback result remains.
11. Inspect the Network panel: relative project assets load, no root-relative
    Pages breakage, and Development/place chunks remain lazy until needed.
12. Inspect console/page errors. Any release-blocking error is P1.

Record the Pages workflow URL, deployed SHA, final URL, date/time, viewports,
browser version, automated results, product checklist, and P2 limitations. The
existing automated live smoke proves only the host, initial Other Side canvas,
core requests, and frame sample; it does not close this broader checklist.

### Phase 2 — merge the final evidence PR

PR #4, `codex/v1-release-evidence`, contains only durable release evidence and
the verified live-site links. Review its final diff, require green
`source-quality`, `vector-data-full`, `browser-smoke`, and `pages-artifact`,
resolve valid conversations, and merge
through protected `main`. That merge creates the final candidate production
SHA. Wait for its CI, Pages deployment, and live smoke to pass again.

Do not tag the earlier first-deployment SHA if the final evidence PR changes
`main`.

### Phase 3 — tag and GitHub Release

Only after the final evidence merge has deployed successfully:

1. Capture the final `main` SHA.
2. Confirm the successful Pages deployment reports that exact SHA.
3. Confirm the final live URL still passes smoke.
4. Create annotated tag `v1.0.0` at that exact SHA and push it.
5. Create the GitHub Release targeting the same tag/SHA.
6. Release notes should include:
   - one-sentence product purpose;
   - the three V1 modes;
   - verified live URL;
   - key data sources and educational caveats;
   - known P2 limitations, including the non-blocking medium-range Android
     hardware gap if still applicable;
   - link to data sources and security reporting.
7. Read back the tag target, release target, `main` SHA, Pages deployment SHA,
   live URL, README link, and repository homepage. They must agree.

### Phase 4 — completion report

Report the outcome rather than a list of commands. Include:

- public repository URL;
- verified live site URL;
- PR #3 and final evidence PR URLs;
- final `main`/deployment/tag/release SHA;
- local unit/E2E counts;
- remote CI, Pages, and live-smoke URLs;
- branch protection and private vulnerability reporting status;
- known P2 limitations;
- whether the optional custom domain remains deferred.

If any one of the required SHA identities or live gates is missing, say the
release is incomplete and identify the exact blocker.

## 12. Git and change hygiene

- Branch names should use the `codex/` prefix.
- Keep commits and PRs single-purpose. Do not mix product features into release
  settings or evidence changes.
- Start each batch with `git status`, inspect ignored files, and compare against
  the correct base.
- Before committing, run `git diff --check` and the proportionate test gate.
- Never commit `dist/`, `node_modules/`, Playwright reports, test results,
  `.playwright-cli/`, `output/`, `tmp/`, `.env*`, `.DS_Store`, logs, tokens, or
  downloaded raw datasets.
- Do not regenerate data unless the task explicitly requires a reviewed source
  update. A rebuild is not a harmless formatting action.
- Do not change dependency versions during release unless resolving a verified
  P0/P1. If the lockfile changes, regenerate and review the license inventory.
- Do not manually edit generated JSON snapshots or bundled notices.
- Do not force-push a reviewed release branch unless explicitly coordinated.
- Do not create the release tag until the final live-verified SHA is known.

## 13. External-state hygiene

- Read remote state before mutating it and read it back afterward.
- Prefer repository-owned GitHub Actions over a personal local deployment.
- Use least-privilege workflow permissions. Only the deploy job receives
  `pages: write` and `id-token: write`.
- Never upload local `dist/` manually to production.
- Never edit GitHub Pages files directly.
- Roll back by redeploying a previously verified workflow run, then make
  protected `main` represent the intended state through a reviewed revert or
  corrective PR.
- A custom domain is optional after MVP. It requires owner-supplied domain/DNS
  authority, GitHub domain verification before DNS cutover, HTTPS enforcement,
  and smoke testing of both canonical and fallback URLs.

## 14. Common traps

1. **Following stale status text.** Older docs still mention July 15 branches.
   Refresh Git and GitHub first and correct tracking docs at release.
2. **Calling an artifact rehearsal a deployment.** A PR Pages workflow uploads
   an artifact but intentionally skips deploy and live smoke.
3. **Merging before planning Pages enablement.** If Pages is unavailable while
   private, the main deploy may need enablement plus a rerun of the same SHA.
4. **Tagging too early.** The post-live documentation PR changes the production
   SHA. Tag only after its deployment succeeds.
5. **Treating README links as evidence.** README now identifies the verified
   host, but only deployment and product-smoke evidence validates a release SHA.
6. **Overbuilding open-source governance.** Contribution walkthroughs,
   marketplace contracts, Dependabot, and CodeQL are not MVP blockers unless a
   concrete review promotes them to P0/P1.
7. **Adding an unbounded mode.** Every new observation requires a focused
   product, data, resource, and owner-approval packet.
8. **Breaking project Pages paths.** Root-relative assets can work locally and
   fail under `/Mundus/`; keep artifact verification intact.
9. **Publishing source maps.** V1 intentionally prohibits them.
10. **Trusting CI without the product loop.** Automated live smoke is narrow;
    perform the manual mode/share/accessibility checks.
11. **Confusing scientific presentation with authority.** Preserve data and
    solar caveats and never add causal or legal claims.
12. **Solving hypothetical scale.** This is a showcase site with no backend or
    high-traffic requirement. One Pages production host is sufficient.

## 15. Deferred roadmap

V1.1.0 Parchment Atlas is the current public Pages product. New cultural or
naming observations require their own small data and licensing packet. Also
defer plugin marketplaces, street-level GIS, weather, time-zone layers,
offline/PWA work, accounts, and backend services.

## 16. Historical kickoff prompt

The prompt below is retained only as V1.0.0 history. Do not use it for a current
execution thread; use the active roadmap and V1.1 convergence authority above.

> Work in `/Users/bytedance/Desktop/Zen/Mundus`. Read `AGENTS.md` completely,
> then read the referenced release and product documents in its prescribed
> order. Refresh local Git and GitHub state before acting. Your goal is to
> complete the smallest responsible Mundus V1 GitHub Pages release, not to add
> features or start V1.1. Continue autonomously through release-scoped review,
> tests, PR work, settings, deployment, live validation, evidence writeback,
> and `v1.0.0`, but stop and request explicit confirmation immediately before
> changing the repository from private to public. Completion requires the final
> `main` SHA, Pages deployment SHA, `v1.0.0` tag SHA, and GitHub Release target
> to match, with the final live site passing desktop/mobile smoke.
