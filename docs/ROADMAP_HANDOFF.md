# Mundus Roadmap And Handoff Index

Status: active handoff index

This document is the repository-visible entry point for work after Mundus V1.
It defines the planning layers, the current product direction, and the review
points required before implementation or release work.

## Current Product

Mundus V1.1.0 Parchment Atlas is the public Pages product. It provides a calm
globe lobby, curated observation entry points, bilingual GeoNames search,
bilateral city relations, the Development and Sunline observations, the Surname
Atlas, and the Natural Earth vector globe.

The current implementation is the protected-main product delivered through the
existing release and Pages workflow. Release identity, deployment evidence,
artifact checks, browser checks, and live checks remain separate records and
must be refreshed before a new release claim.

## Planning Layers

Mundus uses three planning layers:

1. **Product direction** records the next bounded observation or experience
   worth evaluating.
2. **Design packet** defines user behavior, data semantics, provenance,
   licensing, resource budgets, failure states, accessibility, and acceptance.
3. **Execution packet** names the owned files, tests, review steps, release
   gates, and stop conditions.

A direction becomes implementation work only after the design and execution
packets receive product-owner approval.

## Current Direction

The Surname Atlas is the most recently shipped observation (PR #22). Its data contract
and source decisions are recorded in
[`docs/NAMING_OBSERVATION_RESEARCH.md`](NAMING_OBSERVATION_RESEARCH.md).
The implementation uses a static community snapshot, explicit provenance and
missing states, and the existing one-Canvas shell.

The next product packet may extend the observation collection with one focused
cultural or naming experience. It must define a clear question, source
identity, license, coverage semantics, static-host budgets, bilingual meaning,
and browser and artifact acceptance before data collection or runtime work.

## Release Identity

- **V1.0.0** — verified public baseline at
  `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`.
- **V1.1.0 Parchment Atlas** — current public Pages product with the shipped
  lobby, observations, search, city relations, and vector globe.

`package.json` is private build metadata; its version is not a product release
identity. A release claim requires the matching commit, artifact, deployment,
browser, and live evidence.

## Execution Workflow

Before a new feature:

1. refresh local Git, remote, Pages, release, protection, and live state;
2. inspect and preserve every local change;
3. write a focused design and execution packet;
4. obtain product-owner approval;
5. implement in an isolated branch or worktree;
6. run focused tests, review, artifact checks, and proportionate browser gates;
7. update the implementation record with the verified result.

The normal repository gates are formatting, lint, type checking, generated-data
verification, unit tests, production build, Pages artifact verification, and
desktop/mobile browser checks. Release and remote-state actions follow their
separate authorization gates.

## Product Boundaries

Mundus remains a static digital exhibit with one Canvas, curated observations,
explicit data provenance, bilingual meaning, accessible controls, and bounded
resource usage. New work keeps the existing mode contract, sharing behavior,
WebGL fallback, static hosting, and release verification coherent.

## New-Agent Startup

A new agent reads `AGENTS.md`, this file, `docs/CONTINUATION_HANDOFF.md`,
`docs/EXECUTOR_PROTOCOL.md`, `README.md`, `docs/IMPLEMENTATION.md`, and
`docs/PROJECT_PLAN.md` before changing product or remote state. Current Git and
fresh runtime evidence take precedence over old snapshots and status text.
