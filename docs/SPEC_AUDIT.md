# SPEC audit

Audit date: 2026-09-25

Status meanings: **implemented** is fully local application behavior; **browser fallback** is implemented with the fallback required by the specification when an optional platform/network API is absent.

| SPEC area | Status | Evidence / fallback |
| --- | --- | --- |
| 1–5 product, stack, global Card/Lesson model | implemented | React/TypeScript/Vite/Tailwind/Dexie; global Cards, join memberships, per-Lesson progress, global statistics. |
| 6–7 interface vs target/translation languages | implemented | Interface language is independent. A centralized extensible registry provides known BCP-47 codes/names/locales/aliases while custom valid tags remain supported. Users select one non-empty set of simultaneously visible translations; the compatibility active field is derived rather than separately controlled. |
| 8–10 audio, TTS settings, custom audio | browser fallback | Strict custom audio → matching system voice → enabled application provider → unavailable chain; locale/voice/rate; MediaRecorder/upload/reset. Wrong-language system defaults are rejected. Japanese has an opt-in client-side Kokoro/Open JTalk provider. |
| 11 images | implemented | Images are optional with global default and per-Lesson override. Picker/drop/paste, 1024 px optimization, PNG transparency preservation, WebP conversion, Blob persistence, and lazy thumbnails remain available. Translation-only Meaning Blocks are valid. |
| 12 Image discovery | desktop picker + browser fallback | Sandboxed Google Images selection, local optimized copy, source URL when available; offline/failure keeps upload and clipboard paths available. |
| 13 Browser Translator API | browser fallback | Availability/download/progress states and editable output; line-aligned manual input remains the complete fallback. |
| 14–16 manual translation, wizard, duplicates | implemented | Seven-step workflow, exact line validation, normalized duplicate detection and global Card reuse. |
| 17–24 Learn stages/batches/errors/retries | implemented | Pure serialized engine; max 10, difficult-first fill, persistent dirty status, 5–10-question retry window, Give up and remedial batches. |
| 25–28 typing, IME, audio, timing | implemented | Unicode NFC + case-insensitive exact comparison; IME-safe Enter; answer audio priority; accumulated completed-question response time. |
| 29–32 global statistics/confusion rules | implemented | Correct/error/completion/time/average/accuracy; choice and exact-other-target dual penalties; random typo expected-only; only expected Card becomes dirty. |
| 33–34 Automate / Quick Choice | implemented | Both directions, Mixed, 10/20/50/Endless, unique randomized visible options and statistics/timing hooks. |
| 35–40 Chaos | implemented | Tap/click columns, same-side replacement, cross-side match/mismatch, dual penalty, pair timing, completion and responsive round sizes. |
| 41–43 selection, Lesson Detail, Home | implemented | Reuse without duplication; metadata/metrics/sorting/readiness/editing; responsive My Lessons and explicitly labelled optional Japanese example. |
| 44 resumable Learn | implemented | Versioned serializable state and atomic session/progress/statistics commits; resume/restart UI. |
| 45 full backup | implemented | Versioned ZIP manifest plus binary assets, including generated TTS; full entity/settings/session coverage; validation and atomic rollback-safe restore. |
| 46 Lesson export/import | implemented | Content/media/attribution/generated speech only; no personal statistics/progress; clean imported Lesson progress. |
| 47 storage | browser fallback | Best-effort first-save `persist()`; Settings shows persistence/usage and manages a user-selected automatic `lessons/` folder through File System Access, with manual export elsewhere. |
| 48–49 PWA/deployment | implemented | Generated manifest, any/maskable icons, Workbox service worker, offline app shell, no backend/localhost production dependency. |
| 50–51 onboarding/example | implemented | Concise language-neutral Home onboarding; reusable eight-Card Japanese example with local SVG assets. Japanese is neither the product default nor required. |
| 52–56 visual/feedback/keyboard/accessibility | implemented | Responsive semantic UI, visible focus, text plus color feedback, touch targets, reduced-motion CSS, 1–4/Enter/Space/Escape behavior and no emoji/confetti. |
| 57 performance | implemented | Optimized stored images, eager practice images/lazy list thumbnails, route chunks, memoized derived Card ordering/maps, user-controlled answer transitions, non-blocking TTS, local self-hosted model assets, and pre-generated Card audio. |
| 58 error states | implemented / browser fallback | Empty/incomplete Lesson gates; friendly media/network/capability/import/storage failures; route error boundary; finite metric formatting; no raw exceptions rendered. |
| 59 deletion | implemented | Lesson deletion preserves shared/global Cards and their generated speech; repository blocks deletion of an in-use Card unless explicit force is requested and removes generated speech with a deleted Card. |
| 60 automated tests | implemented | Required engine, typing, statistics, Chaos, language registry, optional-image readiness/layout, strict audio priority, generated-audio lifecycle, settings migration/persistence, database reuse, portability, and exclusion tests are present. |
| 61 mandatory E2E | implemented | Production browser scenario covers 12-Card creation, media/readiness, dirty/retry/carry-over/complete Learn, stats, Quick Choice, Chaos dual penalty, Lesson portability and full restore. |
| 62 quality gate | implemented | Commands and current results are recorded in `STATUS.md`; Playwright runs the built PWA. |
| 63–70 boundaries/revision/final goal | implemented | Domain engines remain React-independent; provider/demo/filesystem adapters are isolated; multiple visible translations, anti-repeat scheduling, and manual answer progression are regression-tested; application TTS is self-hosted and pre-generated to IndexedDB; canonical Lesson files are auto-saved where browser permissions allow. |

## Browser-dependent capabilities

- System TTS depends on installed browser/device voices. A matching voice is required; custom audio and configured application providers are the fallbacks.
- The Japanese application provider requires modern browser WASM/DecompressionStream support. Its files are installed into the project by `npm run setup:voices`; no model network request occurs during practice. Lesson creation is saved before synthesis; a provider failure leaves Card data intact. Generated Card audio is stored locally and included in both Lesson packages and full backups.
- Automatic files in a user-selected `lessons/` directory require File System Access. Unsupported browsers use IndexedDB and manual `.vtlesson` downloads.
- Recording depends on MediaRecorder and microphone permission; file upload is the fallback.
- Automatic translation depends on the Browser Translator API; exact line-aligned manual translation remains available.
- Google Images requires network access; file/drop/paste images remain available offline.
- Persistent-storage retention is a browser decision; full backup remains available even when persistence is denied or unsupported.

No mandatory product requirement was found missing in this audit.
