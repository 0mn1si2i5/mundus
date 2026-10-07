# V1 release runbook

Status: current Pages build, deploy and rollback procedure. Release identity
and authorization gates are recorded in `AGENTS.md`.

This runbook covers the reproducible GitHub Pages path for the static site. It
does not authorize changing repository settings, tags or Releases; those need
product-owner approval.

## Build and deploy

- Pull requests run the required CI source and full-vector checks in parallel.
  The Pages workflow builds once in `pages-build` (`pnpm build` and
  `pnpm release:verify`), then runs the complete Playwright suite for the
  desktop and mobile projects on separate runners against that same `dist`.
  The required `pages-artifact` job runs only after the build and both browser
  projects succeed (and fails, rather than skipping, when either does not),
  re-verifies the transferred `dist`, and uploads it; pull requests cannot
  deploy. The required `source-quality` and `vector-data-full` checks cover
  source, generated-data, unit, and full-vector validation. Both checks are
  required directly; no pass-through aggregate job is needed. Failed browser
  jobs upload their Playwright report for seven days.
- A newer push to a pull request cancels its superseded CI and Pages runs; runs
  on `main` always complete.
- The separate CI `browser-smoke` job runs three `@smoke` Chromium cases for a
  fast signal. It does not replace the complete desktop/mobile suite in the
  Pages artifact job.
- A push to protected `main` must pass all required checks, then uploads the
  exact Pages artifact and deploys it through the `github-pages` environment.
- The deployment job alone receives `pages: write` and `id-token: write`.
- The live-smoke job uses the URL returned by `actions/deploy-pages` and checks
  HTTP success, the expected title, loaded resources, and a completed frame
  sample from the initial Other Side canvas on desktop and mobile viewports.

The workflow pins Node.js 22.23.1, pnpm 11.7.0, and immutable commits for the
official GitHub and pnpm actions. Production source maps are prohibited. The
artifact must include the code license, conservative production dependency
inventory, and exact bundled dependency notices.

The local `test:release-server` suite validates the optional literal-mount
rehearsal server and is kept outside the routine source gate because Pages is
served by GitHub's deployment action. Run it when exercising that local
`/mundus/` rehearsal; it does not substitute for artifact verification or live
smoke.

## Private rehearsal

Before public visibility, a successful pull-request `pages-artifact` job is the
accepted rehearsal when private Pages is unavailable. Download and unzip that
workflow artifact, extract the enclosed `artifact.tar`, and run the verifier on
the directory containing the extracted `index.html`:

```bash
pnpm release:verify /path/to/unpacked-artifact
```

Do not describe the site as live until the deployment and live-smoke jobs both
pass on public `main`.

## Rollback

Never edit hosted files manually. Identify the last successful Pages workflow
whose commit and artifact passed live smoke, then redeploy that exact run with
`gh run rerun <run-id>`. Immediately open a reviewed revert or corrective PR so
protected `main` again represents the intended production state. Record the
redeployed run URL and commit SHA in the release incident or follow-up PR.
