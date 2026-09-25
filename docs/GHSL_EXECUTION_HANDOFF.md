# GHSL Plan 1 Terminal Handoff

Status: terminal `STOP_GLOBAL_MORPHOLOGY`; no active GHSL execution

Updated: 2026-09-25, Asia/Shanghai

This tracked handoff records the verified end state of the GHSL Human
Morphology global feasibility proof. The separate migration packet that held
the raw source, checkpoints, and incomplete build outputs was retired on
2026-09-25. This document retains the terminal decision and measured results;
it is evidence and status, not permission to restart the 48-hour attempt,
resume a build, or begin a later GHSL plan.

## Identity

- execution worktree:
  `/Users/bytedance/Desktop/Zen/Mundus/.worktrees/codex-ghsl-global-proof`;
- branch: `codex/ghsl-global-proof`;
- terminal handoff commit:
  `6e396d90ef215085a3d5bc8dbf602b6e4f239051`;
- parent implementation commit:
  `e2d060518438b9b4b7c86cef53bbd5aeecd94341`;
- source handoff SHA-256 at the terminal commit:
  `934739a31a31957799ba7464abf837395ab01e4ee4740e3c6e3b46bcebae094e`.

V1.1.0 Parchment Atlas is the current public Pages product. The `v1.0.0` tag
and existing GitHub Release remain at
`a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`; no V1.1 tag or Release exists.
Human Morphology is not a public capability. It remains a stopped shared-overlay
proposal and reserves V1.2.0 only if the project is separately reopened and
Plans 1 through 7 plus their approval gates complete.

## Verified Evidence

- The strict read-only global audit passed with 15,576/15,576 complete tiles,
  100,070 retained roots, 10,345,449 retained runs, 56,909,478 retained cells,
  and zero topology findings. Inventory SHA-256:
  `971f23dbe2f4058c50b1585f7ab1594e1d4b8c6f286039d4dbfc14f5d3a1405a`.
- Representative review passed with 8,701 retained whole forms, 1,150,677
  scoped authoritative runs, zero false negatives, and all ten pinned manual
  review regions passing.
- At implementation commit `e2d060518438b9b4b7c86cef53bbd5aeecd94341`,
  independent Builds A and B each completed containment and outline with exactly
  100,070 successful outlines and zero failed or pending outline records.
- Build A reached the formal 10,000-fill projection gate at about 9,261
  records/hour. The projected full fill stage was about 10.81 hours, with 9.73
  hours remaining, exceeding the approved eight-hour fill-stage ceiling.
- Build A was checkpointed during fill. Build B was checkpointed after outline.
  Neither is a complete formal build, so no deterministic completed-build
  comparison or technical GO exists.

The terminal decision is `STOP_GLOBAL_MORPHOLOGY`. Plans 2 through 7 are frozen
and blocked unless the product owner separately reopens and approves the work.

## Retired Outputs

The following paths were present only in the retired migration packet and no
longer exist on this device:

- incomplete Build A:
  `.cache/ghsl/proof/formal-build-a-e2d0605`;
- incomplete Build B:
  `.cache/ghsl/proof/formal-build-b-e2d0605`;
- earlier diagnostic-only Build A:
  `.cache/ghsl/proof/formal-build-a-7a47638`;
- authenticated production CCL:
  `.cache/ghsl/production-ccl/ccl.sqlite`;
- strict audit evidence:
  `.cache/ghsl/production-ccl/audit.json`.

The incomplete and diagnostic outputs were never resumed, reused, copied,
counted as formal Build A/B, or represented as completed evidence. Their
terminal status is retained above; the raw files and checkpoints were deleted
with the retired packet.

The pinned source archive was also removed with the retired packet. Its
terminal identity was:

`/Users/bytedance/Desktop/Zen/Mundus/.worktrees/codex-ghsl-morphology-feasibility/.cache/ghsl/downloads/GHS_BUILT_S_E2020_GLOBE_R2023A_54009_100_V1_0.zip`

Its SHA-256 is
`6c13ff9a6ed61d7280566c2700ea1304eff5e0b8956ebe1b3d4e4887c1536d8a`.

## First Action

Read this terminal status and the terminal checkpoint summarized in
`docs/ROADMAP_HANDOFF.md`, then continue only the currently approved Mundus
work. Do not run recovery commands or restart the 48-hour attempt. Local plans
under `docs/superpowers/` are execution aids, not current authorization;
durable decisions and final evidence belong in tracked documents.

## Reopening Gate

Any future GHSL work requires explicit product-owner approval to reopen the
project and a reviewed plan that addresses the measured fill ceiling breach.
Plans 2 through 7 remain frozen until their original dependencies and approval
gates are satisfied. Reopening must not silently loosen the scientific
contract, global completeness, source, threshold, connectivity, containment,
fill fallback, zero-false-negative requirement, or measured resource ceilings.
