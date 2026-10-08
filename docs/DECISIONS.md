# Technical decisions

## 2026-09-23 — Global Cards use an explicit join table

Cards are stored once. Lesson membership and per-Lesson progress use `[lessonId+cardId]` compound keys. This enforces reuse without copying Card content or global statistics.

## 2026-09-23 — Card identity is guarded at repository and database levels

The unique persisted key is `[targetLanguage+normalizedTarget]`, where the target uses Unicode NFC normalization. Repository creation returns the existing Card instead of silently creating a duplicate. A changed target that collides with another Card is rejected.

## 2026-09-23 — Lesson deletion is conservative by default

Deleting a Lesson removes its memberships and progress in one transaction but keeps global Cards and statistics. An explicit `deleteOrphanCards` option removes only Cards whose final membership disappeared; shared Cards can never be removed by that cleanup.

## 2026-09-23 — Statistics keep neutral empty values

`averageResponseTimeMs` is `null` until at least one question is complete, and calculated accuracy is `null` until a correct/error attempt exists. Repositories recompute the stored response-time average from totals, preventing inconsistent persisted aggregates.

## 2026-09-23 — IndexedDB migrations are append-only

Dexie schema version 1 is isolated in the database module. Future releases add new version declarations and explicit upgrade functions instead of mutating released schemas.

## 2026-09-24 — Exercise engines are serializable state machines

Learn, Quick Choice, and Chaos contain no React or IndexedDB calls. Inputs, states, and transition results are plain data. Randomness and clocks are injected, so scheduling, option order, and timing are reproducible in tests.

## 2026-09-24 — Statistics use explicit deltas

Engines emit Card-specific deltas rather than mutating persisted counters. Wrong choices can emit two error deltas while dirty Learn state changes only for the expected Card. Repositories apply all deltas from one interaction atomically.

## 2026-09-24 — Learn commits cross tables atomically

Dexie schema version 2 adds Learn session records. One transaction writes the session snapshot, global statistics, and per-Lesson progress, avoiding partial answer persistence after reloads or storage failures.

## 2026-09-24 — Delayed retry due positions count completed questions

An error schedules its retry after 5–10 subsequently completed questions. The failed question itself is not counted as one of those intervening questions. Dirty batches may carry queued retries forward; a clean final batch drains its own pending retries before marking Cards Learned.

## 2026-09-24 — Pause time is excluded from a resumed question

The serialized question retains timer state, but `resumeLearnSession` starts that question's timer again. Time while the PWA is closed is therefore not recorded as user response time.

## 2026-09-24 — Chaos mismatch begins a new selection attempt

An incorrect cross-side pair emits errors for both involved Cards, leaves both pairs uncompleted, and clears selection. The next click starts a fresh pair timer. Same-side clicks only replace selection and never emit errors.

## 2026-09-24 — React orchestrates engines but does not define their rules

Practice pages convert Lesson Cards to `PracticeCard` snapshots, render the current engine question, and persist returned transitions. They do not choose batches, penalties, retries, option identities, matches, or Learned state.

## 2026-09-24 — Browser media features use progressive capability adapters

Image optimization/search, local translation, Japanese reading generation, speech synthesis, audio playback, and MediaRecorder live in independent services. Network/capability failures are ordinary UI states and never replace the local authoring path. Stored image/audio Blobs and the installed multilingual translation package make existing Lessons and all canonical translation directions offline-safe.

## 2026-09-24 — Lesson readiness is a shared launch gate

Learn and Automate use the same readiness calculation as Lesson review. Active translation and audio availability are reported per Card with a direct edit route. Images are optional presentation data and never block practice.

## 2026-09-24 — Settings defaults are read-only until mutation

Reading missing application settings returns computed defaults without writing inside a Dexie live query. The first explicit settings change persists them, avoiding illegal read-write work inside reactive read transactions.

## 2026-09-24 — Portable data uses versioned ZIP containers

Lesson exports and full backups use a small JSON manifest plus separate binary asset entries. This avoids base64 expansion and permits independent size/path validation. Format version and database schema version are distinct: the former describes the container, while the latter guards restoration of persisted records.

## 2026-09-24 — Full restore validates before one replacement transaction

Archive parsing, asset hydration, entity validation, uniqueness checks, and referential-integrity checks all complete before data mutation. The actual clear-and-repopulate operation is a single Dexie transaction, so a storage error retains the prior database instead of exposing a partial restore.

## 2026-09-24 — Lesson import never overwrites local user history

Lesson packages omit progress and statistics. New memberships receive clean progress. When a normalized Card already exists locally, import reuses it and fills only missing content/media; it does not reset or import global statistics belonging to the current local profile.

## 2026-09-24 — PWA E2E runs against the built application

Playwright starts a production build through Vite preview rather than the development server. This makes service-worker registration, precache contents, static routing, and offline reload part of the normal browser quality gate.

## 2026-09-24 — Language capabilities come from one extensible registry

Known language names, preferred TTS locales, and aliases live in `src/config/languages.ts`. The registry provides convenient choices without closing the model: valid custom BCP-47 tags remain legal. Interface language, target language, and translation languages are separate persisted concepts.

## 2026-09-24 — Audio never falls through to a wrong-language voice

Audio source resolution is explicit and testable: custom audio, a system voice matching the configured locale, an enabled application provider, or unavailable. An unspecified system voice is not treated as safe because browsers may silently choose a voice in another language.

## 2026-09-25 — Application voice assets are an optional desktop package

The pinned Kokoro/Open JTalk model, five Japanese voice files, dictionary, Worker, and WASM are excluded from the base distribution. Electron downloads a fixed manifest atomically into `Vocabulary Trainer Data/tts-packages/kokoro-jp`, exposes progress/status/delete through a narrow IPC bridge, and serves installed files through the existing secure custom protocol. Runtime remote-model access is disabled during synthesis. Heavy provider modules stay behind dynamic imports, while per-Card output is prepared during Lesson authoring and persisted locally. The selected voice is encoded in the provider identifier and therefore participates in the generated-audio cache key.

The Open JTalk dictionary archive is served with a neutral `.bin` suffix. Serving its original `.tar.gz` name through a static server can add `Content-Encoding: gzip`, causing the browser to transparently alter the bytes before Open JTalk verifies its checksum. The setup script removes the obsolete generated `.gz` copy.

## 2026-09-24 — Images are a Lesson presentation preference

Application Settings supply the default `useImages` value for new Lessons, and each Lesson stores an override. Existing Card images and attribution are never deleted when display is disabled, so enabling images later or exporting the Card remains lossless.

## 2026-09-25 — Visible translations are the only user-facing selection

`visibleTranslationLanguages` is the non-empty ordered set used by readiness, engines, visual Meaning Blocks, accessibility labels, Lesson packages, and backups. `activeTranslationLanguage` remains only for backward-compatible persisted formats and is derived from the first visible language. There is no separate primary-language checkbox or selector.

## 2026-09-25 — Completed questions advance only on explicit confirmation

Answer feedback, the expected target, translations, and image remain visible until Next or Enter. Persistence and playback begin immediately but do not advance the screen. The next question timer is reset only after confirmation. Learn and Quick Choice track the last completed Card and avoid it at the next position when another Card is available.

## 2026-09-24 — Generated speech is a separate local derivative

When an application TTS provider is enabled, Lesson creation saves the Lesson first and then generates one audio Blob per eligible Card with visible progress. The provider model/runtime is shared, while results are persisted in the schema-v5 `generatedTtsAudio` store and reused across Lessons that share a Card. Generated audio never occupies `customAudio`, is invalidated when target/pronunciation content changes, and is included in both full backups and self-contained Lesson packages. System `SpeechSynthesis` remains playback-only because browsers do not expose its result as a portable Blob.

## 2026-09-25 — Local Lesson files use a replaceable filesystem adapter

The web build asks the user to select a root directory through File System Access, stores the granted handle outside portable backups, creates `lessons/`, and writes the canonical `.vtlesson` package. Unsupported browsers retain IndexedDB plus manual download. The adapter boundary is intentionally suitable for replacement by native Capacitor or Tauri filesystem access in future APK/desktop packaging.

## 2026-09-25 — Windows desktop uses a sandboxed Electron boundary

The desktop package serves the existing static build through a privileged standard/secure custom protocol rather than enabling Node in React. Context isolation and Chromium sandboxing remain enabled. A minimal preload/IPC API writes validated `.vtlesson` files beside the application; learning engines and Dexie repositories are unchanged.

Both an unpacked executable and a single-file portable executable are produced. The unpacked form is the performance-test target because the portable form must extract its approximately 405 MB bundled runtime/model before each launch.

## 2026-09-25 — Restarting Learn resets Lesson progress, not statistics

Restart is an atomic repository operation. It clears Learned and temporary state only for memberships of the selected Lesson, removes its obsolete sessions, and saves a new session containing every Card. Global Card statistics deliberately survive relearning.

## 2026-09-25 — Lesson preparation precedes filesystem synchronization

Import restores packaged audio, creates every missing application-TTS recording, and only then serializes the canonical `.vtlesson`. Opening an older Lesson runs the same preparation boundary before practice is enabled. This keeps synthesis latency out of normal exercises and repairs packages created before this ordering existed.

## 2026-09-25 — The shared renderer is retained for desktop and Android

The React/Vite application is not treated as a legacy browser fork. Electron runs its production output directly, and the planned Capacitor APK requires the same web renderer. Only packaging-specific adapters differ; moving the shared source or `dist` inputs into a legacy area would break desktop builds and increase future platform divergence.

## 2026-09-25 — Portable desktop uses the whole Electron profile beside the distribution

The packaged app points Electron `userData` at `Vocabulary Trainer Data` before creating the renderer. This deliberately keeps the established Dexie/IndexedDB domain database instead of introducing a risky second persistence model, while making Chromium's database, blobs, caches, automatic `lessons` packages, and optional model packages travel with the distribution. User-created full backups remain explicit `.vtbackup` exports.

An empty portable root receives a copy of a compatible legacy Electron profile and the source is retained. A write probe detects protected locations; failure falls back to the legacy profile with a user-visible warning. The shell reports actual directory bytes and filesystem free space, not an origin quota. The standard Electron menu is removed, native window controls use a theme-synchronized title-bar overlay, and graceful Exit is exposed only through the preload bridge.

## 2026-09-26 — Google Images is external discovery, not an embedded scraped provider

Google's supported programmatic image search requires a configured Programmable Search Engine and credentials; the Custom Search JSON API is closed to new customers and scheduled to end for existing customers in 2027. The application therefore does not scrape Google Images or claim Google results as an internal provider. Desktop loads the normal Google Images website in a sandboxed child window and uses Electron's context-menu event only after an explicit user selection; browser builds use the external browser fallback. Wikimedia search was removed by product decision.

Clipboard ingestion is deliberately source-agnostic: no source, author, or license is inferred. Upload, clipboard button, safe Ctrl+V, drag/drop, and provider downloads all converge on the existing optimizer. Text inputs retain normal paste behavior. Electron exposes only an image-only clipboard read through preload IPC; the browser uses Async Clipboard with explicit unavailable/no-image states.

## 2026-09-26 — Translation capabilities are explicit portable packages

Browser Translator API is no longer the production translation mechanism. `TranslationProvider` isolates inference from React, while Electron owns atomic package download, exact byte-size verification, portable storage, deletion, and restart discovery. Transformers.js is configured for local-only WASM inference and reuses cached pipelines.

Only verified directions are offered: English→German directly, Japanese→Russian through Japanese→English→Russian, and German→Russian through German→English→Russian. A pivot chain is packaged as one user-facing capability so its files and lifecycle stay coherent. Unsupported language pairs are reported immediately rather than sent to an implicit network fallback.

## 2026-09-26 — UI locales follow the canonical language registry

Every language offered as a translation language also has a complete interface catalog: German, English, Spanish, French, Italian, Japanese, Korean, Russian, Ukrainian, and Chinese. Catalogs share one key schema and are validated for exact key and interpolation-placeholder parity, so partial English fallback is not accepted. Language names are translated dynamically from the same registry.

The interface-language preference remains independent from Lesson target and translation languages. A fresh settings record selects a supported OS locale or English, while an existing saved preference is never replaced by later system-locale changes.

## 2026-10-02 — FSRS scheduling is global and begins after Learn

The three-stage Learn engine remains the mandatory acquisition path. A Card receives one global FSRS state only when it becomes Learned; reusing that Card in another Lesson does not create a second schedule. Existing Learned Cards migrate as immediately due so no prior progress is discarded.

The Today planner consumes SRS due state and Lesson membership order. The configured maximum is reduced to five new Cards when 30 or more reviews are due and to zero at 50 or more. Cards introduced earlier on the same local day count against that maximum. Manual difficult markers remain explicit user intent and never rewrite algorithmic difficulty or due dates.

## 2026-10-02 — Kana recall uses glyph choices instead of IME typing

Single-kana and supported contracted-syllable Cards are detected when practice snapshots are created; the flag is derived and is not stored in the database. Any exercise that would require typing that target is converted by the domain engine to a choice question. Glyphs are rendered directly with the platform font, which is sharper and more accessible than generated bitmap files. Handwriting is intentionally deferred because accepting a drawing without stroke recognition would create misleading correctness data.

Longer Japanese kana vocabulary keeps a recall-typing stage, but its exact Hepburn reading is an additional accepted answer alongside the Japanese target. This is derived from the target or saved kana pronunciation and is never guessed from an unknown kanji spelling. The choice removes knowledge of IME aliases such as `di`/`du` from the learning objective while preserving the correct Japanese spelling in feedback.

## 2026-10-04 — Learners can declare unknown or correct a false rejection

Every exercise engine owns a real unknown-answer transition rather than a UI-only skip. Learn makes the Card dirty and schedules another encounter; other modes record an error and completion while revealing the expected answer. Give up no longer waits for two failed attempts.

Pages retain the engine snapshot immediately before a rejected answer. If the learner selects “My answer was correct”, the engine completes from that snapshot and compensating statistics deltas remove only the just-recorded rejection before adding the correct completion. This preserves any earlier genuine mistakes and avoids resetting unrelated cumulative statistics.

## 2026-10-04 — Symbol Lessons use handwriting with honest self-assessment

Lesson content type is stored on the Lesson rather than the global Card, allowing the same character to participate in different learning contexts. Symbols replaces target typing with a pointer/touch canvas in Learn, Today, and configurable typing practice. After drawing, the learner compares against a font-rendered reference and grades the attempt; the product does not misrepresent visual similarity or stroke-order recognition as implemented.

The Lesson editor now exposes the authoring sequence as one ordered page and supports editing translations plus adding targets. Home separates study destinations from Lesson management: Learn and Custom practice stay visible, while Edit, Export, and Delete remain in the overflow menu.

## 2026-10-05 — Handwriting comparison is advisory and reversible

The canvas stores an answer as multiple independent strokes and treats pointer capture as optional, preventing pen/touch drivers from crashing the exercise when the hand is lifted. A local raster comparison normalizes both the user's ink and the rendered glyph, then reports a tolerant similarity score. It does not claim OCR or stroke-order knowledge.

The comparison is advisory until the learner confirms it. Both false rejection and false acceptance can be corrected explicitly, and the preserved drawing remains beside the reference during that decision. Learn and configurable practice then use the chosen outcome; Today keeps the same decision separate from the FSRS recall-speed rating.
