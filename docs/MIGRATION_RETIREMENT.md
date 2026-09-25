# Mundus Migration Retirement

Status: complete

Date: 2026-09-25, Asia/Shanghai

The dedicated Mundus device-migration packet was historical recovery evidence,
not a runtime dependency. Before retirement, the current checkout and the
terminal GHSL handoff were checked against the packet inventory.

Retired material:

- private repository `0mn1si2i5/Mundus-migration-2026-08` and release
  `migration-2026-08-01-20260801T094906Z`;
- local restore packet `/Users/ostrovsky/Mundus-restore`;
- stale unregistered GHSL worktree `.worktrees/codex-ghsl-reopen`;
- ignored local GHSL execution plans under `docs/superpowers/plans/`;
- the unreferenced Docker volume `mundus-benchmark-bridge-6b3ad60e65edc2645b6c53e30e4c90ee`;
- the raw GHSL source archive, production CCL, checkpoints, and proof outputs
  held only by that packet.

The current product did not import any of these paths at runtime. The terminal
GHSL result remains `STOP_GLOBAL_MORPHOLOGY`: the strict audit and
representative review passed, but the projected formal fill stage exceeded the
approved time ceiling and Builds A and B were incomplete. The terminal source
identity was SHA-256
`6c13ff9a6ed61d7280566c2700ea1304eff5e0b8956ebe1b3d4e4887c1536d8a`; the
terminal production CCL identity was
`e401f92585ab43b9feae7536e09304780af29f7b2418be171190e46c316c8854`.

The tracked [GHSL terminal handoff](GHSL_EXECUTION_HANDOFF.md) is the durable
record of the decision and measurements. It does not preserve raw inputs or
authorize a restart. Future GHSL work requires a separately approved design,
source, budget, and execution plan.
