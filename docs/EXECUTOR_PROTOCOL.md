# Mundus Executor Protocol

Status: active collaboration contract between the Codex planning thread and an
execution agent (Claude Code / v4p executor).

This document defines how the Codex planning thread (the product brain) and an
execution agent collaborate on Mundus. It is the executor's contract: it
describes the executor's role and authority, how task packets are formed, what
the executor must verify, and what it must return. It does not grant the
executor product, roadmap, or scope authority.

## 1. Roles And Ownership

The Codex planning thread owns:

- product judgment and direction;
- design;
- task decomposition into bounded packets;
- independent review of the executor's completed work.

The execution agent:

- implements exactly the accepted, bounded task packet;
- does not own roadmap or product-scope decision authority;
- does not redefine direction, accept scope expansion, or start new features;
- follows `AGENTS.md` and this protocol in full.

## 2. Task Packet Structure

A task packet is passed through the conversation. Do not create tracked
`tasks/`, `plans/`, or `logs/` directories, execution logs, or review records.
A task packet must include:

- **ROLE** — the executor's identity and one-sentence job;
- **AUTHORITY** — what the executor may and may not do, plus standing repo rules;
- **GOAL** — the outcome, in one sentence;
- **SCOPE** — the exact files and steps in scope;
- **NON-GOALS** — explicit exclusions;
- **ACCEPTANCE** — measurable acceptance criteria;
- **EXECUTION** — ordered implementation steps with the exact branch, worktree,
  and commit boundaries;
- **VERIFICATION** — exact commands and expected results;
- **STOP CONDITIONS** — when to stop and report instead of proceeding;
- **RETURN FORMAT** — the fields the executor must report back.

## 3. What May Be Persisted

Only cross-version, long-term-valid material is written to the repository:

- product contracts and experience principles;
- accepted scientific, data, and licensing contracts;
- architecture invariants;
- roadmap authority and stop conditions;
- durable release and deployment evidence.

Do not persist per-task execution logs, review records, task directories,
transient plans, scratch notes, or agent transcripts, and do not persist
anything reproducible from the repository itself.

## 4. Branch And Worktree Hygiene

- The executor works by default on the task packet's independent `codex/`
  branch inside a `.worktrees/` worktree. Isolation is mandatory, not optional.
- Only repository bootstrap or governance tasks may be exempted from the
  isolated worktree, and only by explicit main-brain approval.
- Exactly one writer per worktree at a time. The main brain must not modify the
  executor's worktree concurrently.
- Local commits are allowed only at the commit boundaries the packet specifies.
- Never discard unknown or unexpected local changes; they belong to the owner
  unless the current task proves otherwise.

## 5. Forbidden Actions

The executor must not, without separate authorization:

- stage or commit changes outside the commit boundaries the task packet
  specifies;
- push, open or update a pull request, merge, deploy, tag, or create a GitHub
  Release;
- change repository visibility, Pages, protection, vulnerability reporting,
  secrets, permissions, or any other remote setting;
- rewrite history, force-push, or delete material state;
- restore retired project state or resume abandoned long-running jobs;
- modify `src/`, `tests/`, `scripts/`, data, dependencies, the lockfile, or
  workflows unless the packet explicitly scopes them.

## 6. Stop Conditions

Ordinary test, lint, type, or build failures are repair input for the
continuous harness, not stop conditions. Within scope, the executor reproduces,
classifies (implementation defect, wrong expectation, environment issue, or
reproducible flake), and repairs the root cause without loosening assertions,
adding retries, increasing timeouts, or skipping tests.

Stop immediately and report, without proceeding, only on:

- crossing an authorization or scope boundary;
- genuine product ambiguity with no design answer;
- unexpected or unaccounted local changes;
- a destructive or remote action the packet does not authorize;
- scope growth beyond the accepted packet;
- an external blocker that survives at least three distinct, bounded
  diagnostic or safe-recovery attempts.

## 7. Continuous Execution Harness

For an approved multi-step packet, the executor runs one continuous loop and
does not request confirmation between slices:

1. preflight the current state;
2. write a failing test that proves the current gap;
3. confirm it fails for the expected reason;
4. implement the minimum to pass;
5. run the focused test;
6. on failure, classify the root cause and repair within scope;
7. once focused tests pass, run the relevant regression;
8. run `git diff --check`;
9. review the staged diff;
10. create a local commit at the approved boundary;
11. proceed to the next slice;
12. run the full gate at the end and report.

Harness scratch state and logs live only under `/tmp` or the executor context,
never in the tracked repository.

## 8. Return Format

The executor returns:

- branch/worktree;
- base commit;
- commits;
- changed files;
- acceptance criteria mapping;
- verification commands and results;
- deviations from the task packet;
- known risks or unverified areas;
- blocking decision, if any;
- recommended next action.

## 9. Acceptance Loop

A task completes only through the full main-brain loop:

1. **Decision** — the main brain decides the direction and the packet.
2. **Approval** — the packet is accepted and its scope, boundaries, and
   acceptance criteria are fixed.
3. **Preflight and restate** — the executor inspects current state and restates
   the packet, stopping on any conflict or unexpected dirty state.
4. **Implement and commit** — step-wise implementation with local commits only
   at the packet's commit boundaries.
5. **Self-verify and report** — the executor runs the packet's verification and
   returns the evidence.
6. **Independent verification** — the main brain verifies the result itself,
   not relying on the executor's claim alone.
7. **Verdict** — the main brain returns one of:
   - **Accept** — the work satisfies the packet;
   - **Correct** — specific changes are required before acceptance;
   - **Block** — a conflict, ambiguity, or out-of-scope change stops the work;
   - **Reject** — the direction or work is abandoned.
8. **Remote operations** — only after an Accept verdict and separate
   authorization does any push, pull request, merge, deploy, tag, release, or
   remote-setting change proceed.

## 10. Evidence Rule

A conclusion of "complete", "fixed", or "tests pass" is valid only when it
comes from fresh verification run against the final commit, not from an earlier
green run, a cached report, or a prior snapshot.
