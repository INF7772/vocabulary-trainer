# Testing

Install dependencies with `npm ci` before running checks.

## Default workflow: test only the changed area

Do not start with the complete suite for a localized change. Pass the files you
changed to the test selector:

```powershell
npm run test:changed -- src/pages/HomePage.tsx src/components/AppShell.tsx
```

The selector uses Vitest's dependency graph for unit/component/integration
coverage and Playwright feature tags for the relevant browser flows. Normal
runs use compact output; `--list` prints the detailed plan. Useful options are:

```powershell
# Unit/component/integration only while iterating
npm run test:changed -- src/services/image.ts --fast

# Show the selected checks without running them
npm run test:changed -- src/pages/TrainingPage.tsx --list

# Browser flows only
npm run test:changed -- src/pages/SettingsPage.tsx --browser-only
```

Documentation-only paths intentionally run no executable tests. Shared domain
models, test configuration, package manifests, and other cross-cutting files
automatically escalate to the full ordinary gate instead of guessing.

## Feature scopes

When the change is conceptual rather than tied to a short file list, select one
or more named scopes:

```powershell
npm run test:scope -- learning --fast
npm run test:scope -- image
npm run test:scope -- lessons storage
```

| Scope | Main coverage |
| --- | --- |
| `shell`, `ui` | routing shell, Home, responsive layout and shared components |
| `lessons` | creation, reuse, detail, import and Lesson data |
| `learning` | Learn engine, typing, timing, keyboard and statistics |
| `practice` | Practice Builder, Quick Choice, Chaos and selection |
| `translation` | wizard translation, kana readings and package states |
| `image` | optimization, clipboard, search and Meaning Block |
| `audio` | voice selection, preparation and stored audio |
| `settings` | preferences and their persistence |
| `storage` | IndexedDB, import/export, backup and portable workflow |
| `i18n` | all locale catalogs, system locale and visual clipping |
| `desktop` | Electron smoke only; use for desktop-shell changes |

`--fast`, `--browser-only`, and `--list` work with feature scopes too.

## Full ordinary gate

Use the full gate only for a release candidate or a genuinely cross-cutting
change:

```powershell
npm run test:gate
```

It runs typecheck, lint, every ordinary Vitest test, the production frontend
build, and the ordinary Playwright suite. The build is performed once by the
Playwright web server. It does not download or execute optional large models.

The lower-level commands remain available for diagnosis:

```bash
npm run typecheck
npm run lint
npm test
```

`npm test` runs every unit, repository integration, and component test. The
directory-level commands are:

```bash
npm run test:unit
npm run test:integration
npm run test:component
```

Repository tests use uniquely named disposable fake IndexedDB databases and do not touch application data.

## Direct browser tests

Install the Playwright browser once, then run E2E tests:

```bash
npx playwright install chromium
npm run test:e2e
```

The ordinary E2E tests are tagged by feature (`@lessons`, `@learning`,
`@practice`, `@translation`, `@image`, `@audio`, `@settings`, `@storage`,
`@i18n`, `@shell`, and `@ui`). Prefer the selector above instead of manually
constructing `--grep` expressions.

For an existing Chromium-compatible executable, set `PLAYWRIGHT_EXECUTABLE_PATH` to its absolute path before running the command.

The ordinary E2E run skips the real Japanese model benchmark. Run it explicitly after voice-provider or performance changes:

```bash
# PowerShell
$env:RUN_LOCAL_VOICE_E2E='1'; npm run test:e2e:voice
```

This test imports a valid `.vtlesson` with deliberately missing generated audio, verifies that import prepares it, rejects model-host requests during synthesis, verifies IndexedDB audio persistence, measures the renderer heartbeat during preparation, and measures stored playback latency. It requires the optional voice assets under `public/voice-models`; the test flag streams them from the preview server without adding them to the production build. It is not part of the ordinary run.

The real offline-translation responsiveness check is also opt-in because it requires an installed 646 MB model package and a packaged desktop executable:

```powershell
$env:LOCAL_TRANSLATION_TEST_EXECUTABLE='C:\path\to\Vocabulary Trainer.exe'
$env:LOCAL_TRANSLATION_MODEL_ROOT='C:\path\to\Vocabulary Trainer Data\translation-models\multilingual-v1'
npx playwright test tests/e2e/local-translation-performance.spec.ts
```

The check hard-links the installed model into a disposable application profile, translates the five Japanese vocabulary entries from the reported multilingual-hallucination regression into Russian, verifies expected meanings and absence of Thai-script tails, verifies that the renderer heartbeat continues during model initialization, enforces a one-minute translation budget, and then removes only the disposable profile.

## Production build only

```bash
npm run build
```

The build command includes strict TypeScript validation and produces the PWA in
`dist/`. It is already exercised by any Playwright run, so do not run it again
after a successful browser check unless an artifact is needed.

## Windows desktop

```powershell
npm run desktop:smoke
npm run desktop:build
```

`desktop:smoke` verifies the renderer, IndexedDB, storage/shell bridges, absent
application menu, light/dark title-bar synchronization, Exit, and fresh optional
package states. Run it only after changes under `desktop/`, to desktop bridges,
or before packaging. `desktop:build` writes unpacked and portable Windows output
to `release/`.
