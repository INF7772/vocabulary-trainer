# Development plan

## 1. Foundation and data layer — complete

- React, TypeScript, Vite, Tailwind, routing, i18n, PWA, linting, tests, and build tooling.
- Global Card model with reusable Lesson memberships.
- Versioned Dexie schema and repository layer for Cards, Lessons, memberships, per-Lesson progress, global statistics, and settings.
- Integration coverage for data ownership and deletion rules.

Acceptance criteria: dependencies install; typecheck, lint, unit, integration, component, E2E smoke, and production build pass.

## 2. Core learning, statistics, and Automate engines — complete

- Three-stage, maximum-ten-card batches; dirty/carry-over/remedial behavior; delayed retries and Give up.
- Exact typing, Unicode normalization, IME-safe submission, question timing, and confusion penalties.
- Quick Choice modes/lengths/options and Chaos rounds/matching/timing.
- Serializable Learn state, Dexie persistence, and atomic session/progress/statistics commits.

Acceptance criteria: required SPEC engine cases have deterministic unit tests; session/statistics persistence has integration tests; typecheck, lint, and production build pass.

## 3. Lesson authoring and media — complete

- Lesson creation/review workflow, duplicate resolution, translation-line validation, and incomplete-card validation.
- Image optimization and attribution, system TTS selection, and custom-audio capture/upload.
- Progressive automatic translation through the shared offline multilingual package and a user-driven Google Images picker with offline-safe manual fallbacks.

## 4. Learning and lesson UI — complete

- Home, onboarding/demo, Lesson detail/statistics, Learn screens, accessibility, keyboard controls, and responsive themes.
- Create Lesson from selected existing Cards without copying Cards.

## 5. Automate UI — complete

- Quick Choice and Chaos responsive interaction surfaces using the existing domain engines.
- Audio playback and feedback integration.

## 6. Portability and release hardening — complete

- Lesson import/export without personal statistics.
- Versioned full backup/restore with binary assets.
- Persistent-storage request, storage settings, offline and failure-state hardening.
- Full product E2E scenario, performance review, and static PWA deployment validation.

Acceptance criteria: validated Lesson packages and atomic full backups use separate binary assets; Settings exposes storage/backup controls; the built PWA reloads existing data offline; the mandatory production E2E workflow and complete quality gate pass.

## 7. Language-agnostic product revision — complete

- Optional images with global defaults and per-Lesson override.
- Central language registry plus arbitrary BCP-47 input; persistent target/translation/active-language defaults.
- Strict provider-based audio chain with matching system voices and opt-in lazy Japanese browser fallback.
- Unified Settings, explicit Japanese example, contextual attribution, schema v3 migration, Windows launch/build scripts, and revised browser workflows.

Acceptance criteria: German no-image practice, Japanese fallback selection without a Windows voice, multi-language Settings persistence, migration, portability, complete test suite, production E2E, and static build pass.

## 8. Multi-translation and latency revision — complete

- Multiple visible translations per Lesson and default visible-language Settings.
- Shared multilingual Meaning Blocks in Learn, Quick Choice, and Chaos, with readiness validation for every selected language.
- Immediate answer feedback, explicit user-controlled transition, non-blocking audio, and synthesized-audio caching.
- Schema v4 migration, portability coverage, performance regression tests, and Russian user documentation.

Acceptance criteria: an existing Lesson can show RU+EN+DE together; the selection survives migration/export/backup; engine, cache, and real browser transition latency tests pass.

## 9. Pre-generated local application speech — complete

- Generate Card audio during Lesson creation when an application TTS provider is enabled, with visible progress and partial-failure handling.
- Persist derived speech independently from custom audio, invalidate stale records, and preserve shared-Card records during Lesson deletion.
- Include generated speech in full backups while excluding it from portable Lesson packages.

Acceptance criteria: creation saves per-Card audio locally, a second preparation performs no synthesis, shared Cards retain their audio, production E2E verifies the generated store, and the complete quality gate passes.

## 10. Local library and practice usability revision — complete

- Self-host the pinned application voice model from the project/static build and keep provider imports off the normal startup path.
- Include generated speech in self-contained Lesson packages and automatically maintain them in a user-selected `lessons/` directory where the browser permits it.
- Replace automatic answer transitions with explicit Next/Enter confirmation and prevent consecutive completed questions for the same Card when alternatives exist.
- Remove the primary-translation control, synchronize shared global/Lesson preferences, eagerly render practice images, and show a broken-image fallback.
- Refresh Russian user documentation and preserve browser adapters for a future Capacitor/Tauri shell.

Acceptance criteria: no runtime model CDN dependency, explicit Learn/Quick Choice progression, deterministic anti-repeat tests, generated-audio Lesson round trip, local-library write coverage, and a complete quality gate.

## 11. Relearn and Windows desktop — complete

- Restart a completed Lesson by atomically clearing its Lesson-specific progress and queueing every Card without erasing global statistics.
- Package the existing product as sandboxed Windows x64 Electron output with the self-hosted voice model.
- Use native desktop storage beside the application for IndexedDB data and automatic `lessons/*.vtlesson` files.
- Provide unpacked and portable artifacts plus desktop smoke and real voice-performance checks.

Acceptance criteria: completed-Lesson restart passes repository and browser tests; unpacked/portable desktop smoke checks pass; the packaged voice benchmark creates eight recordings without remote model requests and replays stored audio below one second.

## 12. Distribution packaging — complete

- Produce a clean Windows x64 ZIP from the tested unpacked Electron build without `Vocabulary Trainer Data`.
- Produce a source-project ZIP containing code, tests, documentation, packaging scripts, and local voice assets without dependencies or generated output.
- Generate and verify SHA-256 checksums and document the end-user extraction/start workflow in Russian.

Acceptance criteria: the Windows archive contains the executable and complete runtime under one root folder; neither archive leaks personal data; the source archive includes the local voice model; checksums reproduce exactly.
