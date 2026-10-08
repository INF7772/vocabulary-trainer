# Vocabulary Trainer — Agent Instructions

## Project

Vocabulary Trainer is a local-first vocabulary training PWA built with React, TypeScript, Vite, Tailwind CSS, Dexie/IndexedDB, and browser-native media APIs.

There is no backend.

## Source of truth

`docs/SPEC.md` is the authoritative product specification.

Do not change product behavior defined there unless the user explicitly requests a product change.

Do not reinterpret or replace the learning algorithm with a different system.

## Documentation

Read only documentation relevant to the current task.

- Use `docs/SPEC.md` for product behavior and requirements.
- Use `docs/PLAN.md` when implementing a milestone.
- Use `docs/ARCHITECTURE.md` for established implementation boundaries and technical decisions.
- Use `docs/TESTING.md` for validation commands.
- Use `docs/STATUS.md` to understand current implementation progress.

Do not require unrelated documentation to be read for every task.

## Architecture

Keep domain logic independent from React UI.

Learning, statistics, typing validation, batch scheduling, delayed retries, and Chaos matching logic must be implemented in testable modules outside visual components.

Cards are global entities and may belong to multiple Lessons.

Do not duplicate Cards merely because they are reused by another Lesson.

## Scope

Do not add features that are not required by `docs/SPEC.md`.

In particular, do not introduce SRS, scheduled reviews, streaks, XP, accounts, backend services, subscriptions, or other gamification.

Prefer the simplest reliable implementation that satisfies the specification.

## Implementation workflow

Keep each change scoped to the current milestone or task.

Do not start the next milestone automatically unless explicitly requested.

When a task changes architecture or introduces a meaningful technical decision, update `docs/ARCHITECTURE.md` or `docs/DECISIONS.md`.

When milestone progress changes, update `docs/STATUS.md`.

## Verification

Tests use local/disposable data and may be run without additional approval.

Run the validations relevant to the files changed.

### Test-selection rule

For every implementation task:

1. Keep a concrete list of files changed by the task.
2. Before running tests, inspect the proposed plan with
   `npm run test:changed -- <changed files> --list` when the scope is not
   obvious.
3. While iterating, run
   `npm run test:changed -- <changed files> --fast` or
   `npm run test:scope -- <feature> --fast`.
4. After the behavior is stable, run the same focused command without
   `--fast` so that only the tagged browser flows for that area are added.
5. Run `npm run test:gate` only for a release candidate, shared schema/model
   changes, test/build configuration changes, or a genuinely cross-cutting
   refactor.

Do not repeatedly run the full Vitest, Playwright, desktop, or model suites for
a localized change. Run `desktop:smoke` only for Electron shell/bridge/storage
changes or packaging. Real voice and translation-model benchmarks remain
explicit opt-in checks and are required only when their providers, assets, or
performance paths change.

Never delete, skip, weaken, or broadly rewrite an unrelated test merely to make
a focused run faster. If the selector chooses an obviously unrelated area,
correct the path-to-scope rules in `scripts/test-scope.mjs` instead of bypassing
the test.

Fix failures caused by the current change before considering the task complete.

Never change required product behavior merely to make a failing test pass.

Before declaring a milestone complete, verify its acceptance criteria from `docs/PLAN.md`.
