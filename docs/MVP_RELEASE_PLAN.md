# Mundus V1 MVP release plan

- Status: completed historical V1.0.0 plan
- Prepared: 2026-07-16
- Status refreshed: 2026-07-20
- Final commit/deployment/tag/Release: `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`
- Production host: GitHub Pages
- Production source: protected, reviewed `main`
- Public fallback URL: `https://0mn1si2i5.github.io/Mundus/`
- Durable entry point: optional user-owned custom domain, configured after the
  Pages URL is healthy

This is the frozen execution record for the smallest responsible public release. It
narrows the broader open-source work in [EXECUTION_PLAN.md](EXECUTION_PLAN.md)
to the work that must be complete before a public showcase launch.

For a zero-context takeover, read the repository root
[`AGENTS.md`](../AGENTS.md) first. PR #1 and PR #2 have been merged. PR #3 has
been merged. The repository is public; Pages, `main` protection, and private
vulnerability reporting are enabled; the first deployment and automated live
smoke passed. Packet D, final evidence, redeployment, tag, and GitHub Release
are complete. Do not execute the unchecked historical steps below as current
work; use [ROADMAP_HANDOFF.md](ROADMAP_HANDOFF.md).

## 1. Release outcome

Publish the existing three-mode V1 as a static, publicly accessible showcase
whose live content is traceable to one reviewed commit and reproducible from the
repository.

The release is complete only when:

- the accepted V1 product-completion and public-release surface remain merged
  into `main` without release-blocking regressions;
- a GitHub Pages deployment built from that `main` commit is live;
- the live desktop and mobile experience passes the release smoke checklist;
- the live deployment commit is tagged `v1.0.0` and documented in a GitHub
  Release;
- the README points to the verified live URL.

## 2. Product boundary

### Must ship

- Other Side, Development, and Sunline exactly as currently scoped;
- Mode Atlas and first-interaction guidance;
- Chinese and English interfaces;
- desktop, mobile, keyboard, reduced-motion, and WebGL fallback paths;
- visible data source, year, method, license, and attribution information;
- share URLs that survive reload;
- automated, commit-traceable static deployment;
- a clear README, license inventory, security contact, and data-source overview;
- an intentional production source-map decision;
- a clean public Git history and dependency/security review.

### Do not add before launch

- new datasets, content modes, analytics, accounts, backend, PWA, or CMS;
- plugin/runtime marketplace or generalized extension framework;
- visual redesign unrelated to a release-blocking defect;
- multi-provider deployment or speculative scale work.

### Post-launch hardening, not MVP blockers

- full contribution walkthrough and mode proposal template;
- issue and PR template suite;
- Dependabot, CodeQL, and additional repository automation beyond the minimum
  safe release gate;
- custom domain, unless the product owner supplies the domain and explicitly
  makes it a launch requirement;
- mainland-China-specific hosting or CDN work;
- medium-range Android hardware sampling.

## 3. Decision and stop rules

- P0: security exposure, broken primary flow, invalid/mislicensed data, or an
  unreproducible deployment. Stop release and fix.
- P1: broken mode, mobile blocker, inaccessible primary control, incorrect
  result, broken share URL, or missing required attribution. Stop release and
  fix.
- P2: cosmetic defect, optional documentation gap, or non-primary browser issue
  with a safe fallback. Record it; do not expand the release unless it materially
  harms the showcase.
- Never weaken or skip a failing test to make the release green. Investigate the
  exact failure first.
- Do not switch repository visibility, publish a tag, or create a public release
  until the corresponding gate below is satisfied.

## 4. Execution sequence

Each packet should be a small reviewed change. Record command output, URLs, and
commit SHAs in the PR or release evidence; do not commit local browser reports,
build output, caches, credentials, or tokens.

### Packet A — close the V1 product-completion branch

Status: **complete** through merged PR #1. The steps below are retained as the
historical gate; do not repeat the feature batch unless current evidence shows
a regression.

1. Rebase or update `codex/v1-product-completion` from current `main` without
   changing the accepted product scope.
2. Run:
   - `pnpm install --frozen-lockfile`
   - `pnpm check`
   - `pnpm test:e2e`
3. Review four release questions:
   - Does a first-time user understand and act within ten seconds?
   - Do all three modes produce a clear result with explanation and source?
   - Are keyboard, focus, reduced-motion, mobile, and fallback paths intact?
   - Are Development calculations and lazy-data boundaries unchanged?
4. Correct only P0/P1 findings, then rerun the affected test and full gate.
5. Open or update the PR, wait for all required remote checks, review the final
   diff, and merge to `main`.

Gate A evidence:

- clean `git status`;
- successful `pnpm check` and full Playwright result;
- successful remote quality and browser checks;
- reviewed PR URL and merge commit SHA;
- no unresolved P0/P1 finding.

### Packet B — prepare the minimum public-release surface

Status: **complete** through merged PR #2. The steps below are retained as the
public-surface acceptance contract.

1. Make English the canonical README and provide a complete Chinese README or a
   clearly linked equivalent. Both must state product purpose, three-mode scope,
   local run/check commands, data/licensing policy, and the future live URL.
2. Add the minimum durable public documents:
   - `SECURITY.md` with a private reporting route and supported version;
   - `DATA_SOURCES.md` with Natural Earth, UNDP, solar calculation sources,
     versions, transformations, redistribution status, and visible attribution;
   - `THIRD_PARTY_LICENSES.md` or equivalent dependency/data inventory.
3. Confirm that the MIT license describes code only and does not imply that all
   bundled data uses MIT.
4. Decide production source maps explicitly:
   - default MVP decision: do not publish browser source maps;
   - retain them only if a documented debugging need outweighs artifact size and
     source exposure.
5. Audit the complete Git history for secrets and inspect production
   dependencies. Any credible secret or prohibited asset is P0.
6. Verify `.gitignore` and the final diff contain no `dist/`, Playwright output,
   caches, local evidence, `.DS_Store`, credentials, or environment files.

Gate B evidence:

- public-facing documents reviewed in both languages where applicable;
- attribution is visible in the product, not only in repository files;
- full-history secret-scan result and production dependency-audit result;
- source-map decision recorded;
- clean tree and no unresolved P0/P1 licensing or security finding.

### Packet C — add reproducible GitHub Pages deployment

Status: **complete** through merged PR #3. Its merge commit `40c4ab2` passed the
complete Pages workflow, deployment, and automated desktop/mobile live smoke.

1. Add a dedicated Pages workflow that builds with the pinned Node and pnpm
   versions, uses the lockfile, runs the release gate, uploads only `dist/`, and
   deploys only from `main` through the `github-pages` environment.
2. Keep pull requests build/test-only. A PR must never replace production.
3. Use the official GitHub Pages artifact and deployment actions with minimum
   permissions. Pin maintained action versions according to the repository's
   release-security policy.
4. Add a post-deployment smoke step or separate workflow that checks the emitted
   Pages URL and at minimum verifies:
   - HTTP success and expected document title;
   - JavaScript and core static assets load;
   - the initial Other Side view renders without a fatal error.
5. Build the exact Pages artifact before public visibility. If private Pages is
   unavailable on the account, inspect and test the uploaded artifact without
   treating the absence of a private live URL as a passed live smoke.

Gate C evidence:

- Pages artifact built from the intended commit;
- artifact contains no source maps when the default policy is used;
- workflow permissions and deployment environment reviewed;
- successful artifact inspection or private rehearsal;
- rollback is documented as redeploying a previously verified commit, not
  manually editing hosted files.

### Packet D — public launch

Status: **completed** at
`a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`. The numbered steps below are the
historical launch procedure, not current instructions.

This packet changes public external state. Execute it only after Gates A–C and a
final product-owner visibility confirmation.

1. Confirm the repository contains no confidential history, assets, issue
   content, workflow secret, or personal data.
2. Switch the repository to public if it is still private.
3. Enable GitHub Pages with GitHub Actions as the publishing source and restrict
   production deployment to `main`.
4. Merge the release branch after remote checks are green and let the workflow
   deploy the merge commit.
5. Run live smoke on desktop and a mobile viewport:
   - direct entry and hard refresh;
   - all three modes;
   - first interaction and Mode Atlas;
   - Chinese/English;
   - one precise and one approximate share URL;
   - Development evidence/source display;
   - Sunline fixed-time and return-to-now behavior;
   - keyboard operation, reduced motion, and WebGL fallback;
   - visible Natural Earth and UNDP attribution;
   - browser console free of release-blocking errors.
6. Put the verified Pages URL in the README and GitHub repository homepage.
7. Confirm the Pages deployment SHA equals the intended `main` SHA.
8. Tag that exact SHA as `v1.0.0`, push the tag, and create a concise GitHub
   Release with product scope, live URL, data caveats, and known non-blocking
   limitations.

Gate D evidence:

- public repository URL;
- successful Pages workflow URL;
- verified live Pages URL;
- live-smoke checklist with desktop/mobile evidence;
- deployed SHA, tag SHA, and release target SHA are identical;
- README and repository homepage point to the verified URL.

### Packet E — optional durable custom domain

This packet can run after launch and requires a domain owned by the product
owner. It does not block the GitHub Pages MVP unless explicitly promoted to a
launch gate.

1. Product owner supplies the domain and DNS access or performs the DNS changes.
2. Verify the domain in GitHub before pointing DNS at Pages.
3. Configure the domain in repository Pages settings, then configure DNS. Do not
   depend on a committed `CNAME` file for a custom Actions deployment.
4. Enable HTTPS after certificate issuance.
5. Verify both the custom domain and `github.io` fallback, redirects, share URLs,
   and hard refresh.
6. Update README, repository homepage, and release notes to use the custom domain
   as canonical while retaining the Pages URL as recovery information.

## 5. Final acceptance checklist

- [x] Gates A, B, C, and D have complete evidence.
- [x] `pnpm check` and full Playwright pass on the first deployed commit.
- [x] Remote CI and first Pages deployment pass.
- [x] No unresolved P0/P1 product, accessibility, data, license, or security
      finding remains.
- [x] Automated live desktop and mobile smoke pass.
- [x] The three V1 modes, bilingual UI, sharing, attribution, and fallback paths
      are available on the public URL.
- [x] README and repository homepage point to the live site from final `main`.
- [x] Pages deployment SHA = `main` release commit SHA = `v1.0.0` target SHA.
- [x] Known P2 limitations are written in the release, not silently forgotten.

## 6. Handoff instruction for the execution thread

This handoff is complete history. PR #4, final CI/Pages/live smoke, `v1.0.0`,
and the GitHub Release all closed at the same SHA. Current work starts from
`ROADMAP_HANDOFF.md`; do not repeat the V1.0.0 publication steps.
