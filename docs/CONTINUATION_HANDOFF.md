# Mundus Continuation Handoff

Status: active zero-context entry point for product and development work

Verified snapshot: 2026-09-25, Asia/Singapore

## Mission

The continuing agent acts as Mundus's technical product lead and primary
developer. The role is to maintain an accurate model of the product, challenge
scope, turn an accepted direction into bounded requirements, and carry the work
through implementation, tests, review, documentation, and release evidence.

Mundus is a long-lived personal digital globe for seeing one planet through
scientific and cultural lenses:

> digital museum exhibit × scientific instrument × interactive atlas

## Read Order

Read these sources before changing product or remote state:

1. `AGENTS.md`;
2. `docs/ROADMAP_HANDOFF.md`;
3. this file;
4. `docs/EXECUTOR_PROTOCOL.md`;
5. `README.md` and `README.zh-CN.md`;
6. `docs/IMPLEMENTATION.md` and `docs/PROJECT_PLAN.md`;
7. `DATA_SOURCES.md`, `THIRD_PARTY_LICENSES.md`, and `SECURITY.md`;
8. current Git, GitHub, Pages, artifact, test, and live evidence.

Current product-owner instructions and fresh repository evidence take
precedence over older snapshots and status text.

## Current Product

The public product is Mundus V1.1.0 Parchment Atlas. It includes the Exhibit
Lobby, Mode Atlas, Other Side, Development, Sunline, Surname Atlas, bilingual
GeoNames search, bilateral city relations, and the Natural Earth vector globe.

The repository keeps observation metadata static, loads active-mode code and
data lazily, uses one WebGL Canvas, and publishes a static Pages artifact. URL
state, accessibility, bilingual meaning, data identity, attribution, and
failure containment remain release contracts.

## Current Direction

The Surname Atlas packet shipped through PR #22. Its source and data semantics
are recorded in `docs/NAMING_OBSERVATION_RESEARCH.md`, including the owner's
2026-10-07 decision to ship 70 manually compiled observations with an explicit
"not individually verified" label. Pinning per-record evidence for those
records is an open, optional follow-up.

Any later observation begins with one focused question and a design covering:

- source identity, provenance, license, snapshot, and redistribution;
- coverage semantics and honest missing states;
- static-host, transfer, heap, GPU, and artifact budgets;
- bilingual copy, accessible controls, and failure behavior;
- compatibility with the existing Canvas, mode shell, sharing, and Pages path;
- focused tests, browser checks, and release acceptance.

## First Assignment

Before implementing a new feature, produce a continuation assessment that:

1. refreshes local, remote, Pages, release, protection, and live state;
2. preserves every local change;
3. verifies the shipped product and release identity;
4. evaluates the proposed direction with product judgment;
5. proposes one bounded packet with requirements, risks, validation, stop
   conditions, and acceptance criteria;
6. obtains product-owner approval before implementation.

## Development Workflow

An approved packet uses a focused branch or isolated worktree. Demonstrate the
current gap with a meaningful test or reproducible check, implement one purpose
at a time, run proportionate local gates, perform specification and quality
review, and record the verified result.

Before release, run the full source, data, build, artifact, and desktop/mobile
browser gates required by the affected product surface. Remote pushes, pull
requests, merges, deployments, tags, releases, repository settings, and other
material remote changes follow the authorization rules in `AGENTS.md`.

## Standing Product Boundaries

Mundus is a curated static exhibit. Product work preserves:

- one Canvas and one explicit mode orchestration boundary;
- static hosting and bounded assets;
- data manifests, hashes, provenance, license, and attribution;
- accessible desktop/mobile controls and semantic alternatives;
- Chinese and English meaning;
- deterministic sharing and URL compatibility;
- WebGL loading, failure, and context-restoration behavior.

## Success Condition

The handoff works when a zero-context agent can describe the current product,
locate the responsible modules, refresh live evidence, propose one bounded next
packet, preserve local work, and carry approved implementation through review
and verification without weakening the product contracts above.
