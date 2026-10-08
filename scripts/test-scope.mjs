import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const scopes = {
  shell: {
    vitest: ["tests/component/app.test.tsx"],
    tags: ["shell"],
  },
  ui: {
    vitest: ["tests/component", "tests/unit/localization.test.ts"],
    tags: ["ui"],
  },
  lessons: {
    vitest: [
      "tests/unit/lesson-data.test.ts",
      "tests/unit/lesson-library.test.ts",
      "tests/unit/lesson-preparation.test.ts",
      "tests/integration/database.test.ts",
    ],
    tags: ["lessons"],
  },
  learning: {
    vitest: [
      "tests/unit/learning-engine.test.ts",
      "tests/unit/typing.test.ts",
      "tests/unit/timing.test.ts",
      "tests/unit/keyboard.test.ts",
      "tests/unit/statistics.test.ts",
      "tests/unit/lesson-data.test.ts",
    ],
    tags: ["learning"],
  },
  practice: {
    vitest: [
      "tests/unit/custom-training.test.ts",
      "tests/unit/training-selection.test.ts",
      "tests/unit/quick-choice.test.ts",
      "tests/unit/chaos.test.ts",
      "tests/unit/statistics.test.ts",
    ],
    tags: ["practice"],
  },
  translation: {
    vitest: [
      "tests/unit/translation.test.ts",
      "tests/unit/language-audio.test.ts",
    ],
    tags: ["translation"],
  },
  image: {
    vitest: [
      "tests/unit/image.test.ts",
      "tests/component/meaning-block.test.tsx",
    ],
    tags: ["image"],
  },
  audio: {
    vitest: [
      "tests/unit/language-audio.test.ts",
      "tests/unit/lesson-preparation.test.ts",
    ],
    tags: ["audio"],
  },
  settings: {
    vitest: [
      "tests/unit/localization.test.ts",
      "tests/unit/language-audio.test.ts",
      "tests/integration/database.test.ts",
    ],
    tags: ["settings"],
  },
  storage: {
    vitest: [
      "tests/integration/database.test.ts",
      "tests/integration/portability.test.ts",
      "tests/unit/lesson-library.test.ts",
      "tests/unit/lesson-preparation.test.ts",
    ],
    tags: ["storage"],
  },
  i18n: {
    vitest: [
      "tests/unit/localization.test.ts",
      "tests/component/app.test.tsx",
    ],
    tags: ["i18n"],
  },
  desktop: {
    vitest: [],
    tags: [],
    desktop: true,
  },
};

const pathRules = [
  [/^(?:src\/app|src\/components\/AppShell|src\/pages\/(?:Home|AppError|NotFound)|src\/styles)/u, ["shell", "ui"]],
  [/^src\/components/u, ["ui"]],
  [/^src\/(?:i18n|config\/languages)|Language(?:Combobox|Input)|TargetText/u, ["i18n"]],
  [/SettingsPage|LessonSettingsPage|settings-repository/u, ["settings"]],
  [/LessonWizardPage|translator|translation-packages|kana-study-reading|japanese-readings/u, ["translation"]],
  [/image|CardImage|MeaningBlock|CardEditorPage/u, ["image"]],
  [/audio|voice|tts|useAudioAvailability|useVoices|CardEditorPage/u, ["audio"]],
  [/domain\/learning|LearnPage|typing|statistics|timing|keyboard/u, ["learning"]],
  [/custom-training|training-selection|quick-choice|chaos|TrainingPage|QuickChoicePage|ChaosPage|AutomatePage/u, ["practice"]],
  [/LessonDetailPage|lesson-data|lesson-library|lesson-preparation|lesson-repository|card-repository/u, ["lessons"]],
  [/^src\/(?:data|services\/(?:portability|storage))|database/u, ["storage"]],
  [/^desktop\//u, ["desktop"]],
];

const args = process.argv.slice(2);
const fastOnly = removeFlag(args, "--fast");
const browserOnly = removeFlag(args, "--browser-only");
const listOnly = removeFlag(args, "--list");
const help = removeFlag(args, "--help") || removeFlag(args, "-h");

if (help || args.length === 0) {
  printHelp();
  process.exit(help ? 0 : 1);
}

if (fastOnly && browserOnly) {
  fail("Use either --fast or --browser-only, not both.");
}

const selectedScopes = new Set();
const explicitScopes = new Set();
const relatedFiles = new Set();
const directVitestFiles = new Set();
const directE2eFiles = new Set();
let fullGate = false;
let hasExecutableTarget = false;

for (const rawTarget of args) {
  const target = normalize(rawTarget);
  if (target === "all" || target === "release") {
    fullGate = true;
    hasExecutableTarget = true;
    continue;
  }
  if (Object.hasOwn(scopes, target)) {
    selectedScopes.add(target);
    explicitScopes.add(target);
    hasExecutableTarget = true;
    continue;
  }
  if (/^(?:docs\/|README\.md$|AGENTS\.md$)/u.test(target)) {
    continue;
  }
  if (/^(?:package(?:-lock)?\.json|vite\.config\.ts|vitest\.config\.ts|playwright\.config\.ts|tsconfig\.json|eslint\.config\.js|tests\/setup\.ts)$/u.test(target)) {
    fullGate = true;
    hasExecutableTarget = true;
    continue;
  }
  if (/^tests\/e2e\/.*\.spec\.ts$/u.test(target)) {
    directE2eFiles.add(target);
    hasExecutableTarget = true;
    continue;
  }
  if (/^tests\/.*\.(?:test|spec)\.(?:ts|tsx)$/u.test(target)) {
    directVitestFiles.add(target);
    hasExecutableTarget = true;
    continue;
  }
  if (/^(?:src\/|desktop\/)/u.test(target)) {
    relatedFiles.add(target);
    let matched = false;
    for (const [pattern, matches] of pathRules) {
      if (pattern.test(target)) {
        matched = true;
        matches.forEach((scope) => selectedScopes.add(scope));
      }
    }
    if (!matched) fullGate = true;
    hasExecutableTarget = true;
    continue;
  }
  if (existsSync(path.resolve(target))) {
    fullGate = true;
    hasExecutableTarget = true;
    continue;
  }
  fail(`Unknown scope or path: ${rawTarget}`);
}

if (!hasExecutableTarget) {
  console.log("Documentation-only change: no executable tests are required.");
  process.exit(0);
}

const vitestTargets = new Set(directVitestFiles);
const browserTags = new Set();
let desktopSmoke = false;
for (const scopeName of selectedScopes) {
  const definition = scopes[scopeName];
  definition.vitest.forEach((file) => vitestTargets.add(file));
  definition.tags.forEach((tag) => browserTags.add(tag));
  desktopSmoke ||= Boolean(definition.desktop);
}

const plan = {
  mode: fullGate ? "full" : "focused",
  scopes: [...selectedScopes].sort(),
  relatedFiles: [...relatedFiles].sort(),
  vitestTargets: fullGate ? ["all"] : [...vitestTargets].sort(),
  e2eTargets: fullGate
    ? ["all ordinary E2E"]
    : [
        ...[...directE2eFiles].sort(),
        ...[...browserTags].sort().map((tag) => `@${tag}`),
      ],
  desktopSmoke,
  fastOnly,
  browserOnly,
};
if (listOnly) {
  console.log(`Test plan:\n${JSON.stringify(plan, null, 2)}`);
  process.exit(0);
}
console.log(
  `Test plan: ${plan.mode}; scopes=${plan.scopes.join(",") || "all"}; ` +
    `vitest=${browserOnly ? "skip" : plan.vitestTargets.length}; ` +
    `e2e=${fastOnly ? "skip" : plan.e2eTargets.join(",") || "none"}; ` +
    `desktop=${plan.desktopSmoke ? "yes" : "no"}`,
);

const root = process.cwd();
const vitestCli = path.join(root, "node_modules", "vitest", "vitest.mjs");
const playwrightCli = path.join(
  root,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
);
const typescriptCli = path.join(root, "node_modules", "typescript", "bin", "tsc");
const eslintCli = path.join(root, "node_modules", "eslint", "bin", "eslint.js");

if (!browserOnly) {
  if (fullGate) {
    run("TypeScript", process.execPath, [typescriptCli, "--noEmit"]);
    run("Lint", process.execPath, [eslintCli, ".", "--max-warnings=0"]);
  }
  if (fullGate) {
    run("Vitest full suite", process.execPath, [vitestCli, "run"]);
  } else {
    if (relatedFiles.size > 0) {
      run("Vitest related tests", process.execPath, [
        vitestCli,
        "related",
        "--run",
        "--passWithNoTests",
        "--reporter=dot",
        ...relatedFiles,
      ]);
    }
    if (vitestTargets.size > 0 && (relatedFiles.size === 0 || explicitScopes.size > 0)) {
      run("Vitest feature tests", process.execPath, [
        vitestCli,
        "run",
        "--reporter=dot",
        ...vitestTargets,
      ]);
    }
  }
}

if (!fastOnly) {
  if (fullGate) {
    run("Playwright ordinary E2E", process.execPath, [
      playwrightCli,
      "test",
      "--reporter=dot",
    ]);
  } else if (directE2eFiles.size > 0 || browserTags.size > 0) {
    const e2eArgs = [playwrightCli, "test", ...directE2eFiles];
    if (browserTags.size > 0) {
      e2eArgs.push("--grep", `@(?:${[...browserTags].join("|")})`);
    }
    e2eArgs.push("--reporter=dot");
    run("Playwright focused E2E", process.execPath, e2eArgs);
  }
  if (desktopSmoke) {
    if (process.platform === "win32") {
      run("Electron desktop smoke", process.env.ComSpec ?? "cmd.exe", [
        "/d",
        "/s",
        "/c",
        "npm.cmd run desktop:smoke",
      ]);
    } else {
      run("Electron desktop smoke", "npm", ["run", "desktop:smoke"]);
    }
  }
}

function run(label, command, commandArgs) {
  console.log(`\n=== ${label} ===`);
  const childEnvironment = {
    ...process.env,
    NO_COLOR: "1",
    NODE_NO_WARNINGS: "1",
  };
  delete childEnvironment.FORCE_COLOR;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: childEnvironment,
    stdio: "inherit",
  });
  if (result.error) fail(`${label} could not start: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function normalize(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function removeFlag(values, flag) {
  const index = values.indexOf(flag);
  if (index < 0) return false;
  values.splice(index, 1);
  return true;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function printHelp() {
  console.log(`Usage:
  npm run test:scope -- <scope> [scope...] [--fast|--browser-only|--list]
  npm run test:changed -- <changed-file> [changed-file...] [--fast|--browser-only|--list]

Scopes:
  shell ui lessons learning practice translation image audio settings storage i18n desktop all

Examples:
  npm run test:scope -- learning --fast
  npm run test:scope -- image
  npm run test:changed -- src/pages/HomePage.tsx src/components/AppShell.tsx
  npm run test:changed -- docs/TESTING.md`);
}
