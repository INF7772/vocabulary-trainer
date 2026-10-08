const {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  net,
  nativeTheme,
  protocol,
  shell,
} = require("electron");
const {
  accessSync,
  constants: fsConstants,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const {
  mkdir,
  opendir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile,
} = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { pathToFileURL } = require("node:url");

const APP_SCHEME = "vocabulary-trainer";
const APP_HOST = "app";
const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;
const launchStartedAt = performance.now();
const smokeOutput = readArgument("--smoke-test-output=");
const portableSmokeOutput = readArgument("--portable-smoke-output=");
const portableSmokeMode = readValueArgument("--portable-smoke-mode=") ?? "read";
const exitSmokeOutput = readArgument("--exit-smoke-output=");
const diagnosticOutput = smokeOutput ?? portableSmokeOutput ?? exitSmokeOutput;
const legacyUserDataRoot =
  process.env.VOCABULARY_TRAINER_LEGACY_DATA_DIR ?? app.getPath("userData");
let portableDataState = {
  root: legacyUserDataRoot,
  portable: false,
  migratedFrom: null,
  warning: null,
};
let currentWindowTheme = "dark";
const pendingDesktopWrites = new Set();
const JAPANESE_VOICE_PACKAGE_ID = "kokoro-jp";
const JAPANESE_VOICE_PACKAGE_BYTES = 367_088_960;
const JAPANESE_VOICE_FILES = [
  ["manifest.json", null],
  ["kokoro-js-jp/open_jtalk_dic_utf_8-1.11.tar.bin", "https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/open_jtalk_dic_utf_8-1.11.tar.gz"],
  ["kokoro-js-jp/openjtalk-voice.htsvoice", "https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/openjtalk-voice.htsvoice"],
  ["kokoro-js-jp/browser/worker.js", "https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/browser/worker.js"],
  ["kokoro-js-jp/openjtalk-wasm-wrapper-D6E3BSJO.js", "https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/openjtalk-wasm-wrapper-D6E3BSJO.js"],
  ["kokoro-js-jp/openjtalk-wasm.wasm", "https://cdn.jsdelivr.net/npm/kokoro-js-jp@0.2.0/dist/openjtalk-wasm.wasm"],
  ...["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"].map((file) => [`onnxruntime/${file}`, `https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/${file}`]),
  ...["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model_q4.onnx", "voices/jf_alpha.bin", "voices/jf_gongitsune.bin", "voices/jf_nezumi.bin", "voices/jf_tebukuro.bin", "voices/jm_kumo.bin"].map((file) => [`models/onnx-community/Kokoro-82M-v1.0-ONNX/${file}`, `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/${file}`]),
];
const TRANSLATION_MODEL_REVISIONS = {
  "Xenova/m2m100_418M": "9c374f0b7aca709787cea97b047bfbbd1559d177",
};
const TRANSLATION_MODEL_FILES = {
  "Xenova/m2m100_418M": translationModelFiles("Xenova/m2m100_418M", {
    "config.json": 908,
    "generation_config.json": 233,
    "sentencepiece.bpe.model": 2423393,
    "special_tokens_map.json": 1559,
    "tokenizer.json": 7988527,
    "tokenizer_config.json": 1813,
    "vocab.json": 3708092,
    "onnx/decoder_model_merged_quantized.onnx": 344128178,
    "onnx/encoder_model_quantized.onnx": 287856370,
  }),
};
const TRANSLATION_PACKAGES = {
  "multilingual-v1": {
    sourceLanguage: "mul",
    targetLanguage: "mul",
    models: ["Xenova/m2m100_418M"],
    estimatedBytes: 646107932,
  },
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      codeCache: true,
      allowServiceWorkers: true,
    },
  },
]);

app.setName("Vocabulary Trainer");
app.setAppUserModelId("local.vocabularytrainer.app");

if (smokeOutput) {
  app.setPath(
    "userData",
    path.join(os.tmpdir(), `vocabulary-trainer-desktop-check-${process.pid}`),
  );
  portableDataState = {
    root: app.getPath("userData"),
    portable: false,
    migratedFrom: null,
    warning: null,
  };
} else if (app.isPackaged) {
  portableDataState = configurePortableDataDirectory(legacyUserDataRoot);
}

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();

app.on("second-instance", () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  protocol.handle(APP_SCHEME, serveApplicationFile);
  registerDesktopStorage();
  const window = createWindow();

  try {
    await window.loadURL(APP_URL);
    if (smokeOutput) await runSmokeTest(window, smokeOutput);
    if (portableSmokeOutput) {
      await runPortableSmokeTest(
        window,
        portableSmokeOutput,
        portableSmokeMode,
      );
    }
    if (exitSmokeOutput) await runExitSmokeTest(window);
  } catch (error) {
    if (diagnosticOutput) {
      await writeSmokeResult(diagnosticOutput, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
      app.exit(1);
      return;
    }
    throw error;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const window = createWindow();
    void window.loadURL(APP_URL);
  }
});

app.on("window-all-closed", () => app.quit());

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 600,
    show: false,
    backgroundColor: "#020617",
    title: "Vocabulary Trainer",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: titleBarColors("dark"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
    },
  });
  window.removeMenu();

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(APP_URL)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });
  window.once("ready-to-show", () => {
    if (!diagnosticOutput) window.show();
  });
  return window;
}

function registerDesktopStorage() {
  ipcMain.handle("desktop-storage:root", () => app.getPath("userData"));
  ipcMain.handle("desktop-storage:info", () => getDesktopStorageInfo());
  ipcMain.handle("desktop-clipboard:read-image", () => {
    const image = clipboard.readImage();
    return image.isEmpty() ? null : image.toPNG();
  });
  ipcMain.handle("desktop-image-search:open", (event, query, labels) =>
    openImageSearchWindow(event.sender, query, labels),
  );
  ipcMain.handle("desktop-storage:save-lesson", (_event, fileName, data) =>
    trackDesktopWrite(async () => {
      const filePath = lessonFilePath(fileName);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, Buffer.from(data));
      return filePath;
    }),
  );
  ipcMain.handle("desktop-storage:remove-lesson", (_event, fileName) =>
    trackDesktopWrite(async () => {
      const filePath = lessonFilePath(fileName);
      try {
        await unlink(filePath);
      } catch (error) {
        if (!error || error.code !== "ENOENT") throw error;
      }
    }),
  );
  ipcMain.handle("desktop-voice-package:status", (_event, packageId) =>
    voicePackageStatus(packageId),
  );
  ipcMain.handle("desktop-voice-package:install", (event, packageId) =>
    trackDesktopWrite(() =>
      installVoicePackage(packageId, (progress) =>
        event.sender.send("desktop-voice-package:progress", progress),
      ),
    ),
  );
  ipcMain.handle("desktop-voice-package:delete", (_event, packageId) =>
    trackDesktopWrite(async () => {
      assertVoicePackageId(packageId);
      await rm(voicePackageRoot(packageId), { recursive: true, force: true });
      return voicePackageStatus(packageId);
    }),
  );
  ipcMain.handle("desktop-system:open-voice-settings", async () => {
    await shell.openExternal("ms-settings:speech");
    return true;
  });
  ipcMain.handle("desktop-translation-package:status", (_event, packageId) =>
    translationPackageStatus(packageId),
  );
  ipcMain.handle("desktop-translation-package:install", (event, packageId) =>
    trackDesktopWrite(() =>
      installTranslationPackage(packageId, (progress) =>
        event.sender.send("desktop-translation-package:progress", progress),
      ),
    ),
  );
  ipcMain.handle("desktop-translation-package:delete", (_event, packageId) =>
    trackDesktopWrite(async () => {
      await rm(translationPackageRoot(packageId), {
        recursive: true,
        force: true,
      });
      return translationPackageStatus(packageId);
    }),
  );
  ipcMain.handle("desktop-window:set-theme", (event, theme) => {
    if (theme !== "dark" && theme !== "light") {
      throw new Error("Invalid window theme.");
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) applyWindowTheme(window, theme);
  });
  ipcMain.handle("desktop-app:exit", async () => {
    await Promise.allSettled([...pendingDesktopWrites]);
    if (exitSmokeOutput) {
      await writeSmokeResult(exitSmokeOutput, {
        ok: true,
        packaged: app.isPackaged,
        pendingWrites: pendingDesktopWrites.size,
      });
    }
    setImmediate(() => app.quit());
    return true;
  });
}

async function openImageSearchWindow(sender, query, labels) {
  const normalizedQuery = typeof query === "string" ? query.trim().slice(0, 300) : "";
  if (!normalizedQuery) return null;
  const parent = BrowserWindow.fromWebContents(sender);
  if (!parent || parent.isDestroyed()) return null;

  const selectLabel =
    typeof labels?.selectImage === "string" && labels.selectImage.trim()
      ? labels.selectImage.trim().slice(0, 80)
      : "Use this image";
  const sourceLabel =
    typeof labels?.openSource === "string" && labels.openSource.trim()
      ? labels.openSource.trim().slice(0, 80)
      : "Open image source";
  const searchUrl = new URL("https://www.google.com/search");
  searchUrl.searchParams.set("tbm", "isch");
  searchUrl.searchParams.set("q", normalizedQuery);

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const picker = new BrowserWindow({
      parent,
      width: Math.max(720, Math.min(parent.getBounds().width - 80, 1200)),
      height: Math.max(560, Math.min(parent.getBounds().height - 80, 850)),
      minWidth: 640,
      minHeight: 480,
      title: "Google Images",
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    picker.removeMenu();
    picker.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    picker.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("https://")) void picker.loadURL(url);
      return { action: "deny" };
    });
    picker.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith("https://")) return;
      event.preventDefault();
    });
    picker.webContents.on("context-menu", (_event, params) => {
      if (params.mediaType !== "image" || !params.hasImageContents || !params.srcURL) return;
      const template = [
        {
          label: selectLabel,
          click: async () => {
            try {
              const selected = await downloadSelectedImage(params.srcURL, params.linkURL, params.pageURL);
              finish(selected);
              if (!picker.isDestroyed()) picker.close();
            } catch (error) {
              fail(error);
              if (!picker.isDestroyed()) picker.close();
            }
          },
        },
      ];
      if (params.linkURL?.startsWith("https://")) {
        template.push({
          label: sourceLabel,
          click: () => void picker.loadURL(params.linkURL),
        });
      }
      Menu.buildFromTemplate(template).popup({ window: picker });
    });
    picker.on("closed", () => finish(null));
    void picker.loadURL(searchUrl.toString()).catch(() => {
      finish(null);
      if (!picker.isDestroyed()) picker.close();
    });
  });
}

async function downloadSelectedImage(imageUrl, linkUrl, pageUrl) {
  if (!imageUrl.startsWith("https://") && !imageUrl.startsWith("data:image/")) {
    throw new Error("Unsupported image URL.");
  }
  const response = await net.fetch(imageUrl, { redirect: "follow" });
  if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);
  const mimeType = response.headers.get("content-type")?.split(";", 1)[0] ?? "";
  if (!mimeType.startsWith("image/")) throw new Error("Selected URL is not an image.");
  const declaredBytes = Number(response.headers.get("content-length")) || 0;
  if (declaredBytes > 25 * 1024 * 1024) throw new Error("Selected image is too large.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) {
    throw new Error("Selected image is empty or too large.");
  }
  const sourceUrl = linkUrl?.startsWith("https://") ? linkUrl : pageUrl;
  return { bytes, mimeType, sourceUrl: sourceUrl?.startsWith("https://") ? sourceUrl : null };
}

function trackDesktopWrite(operation) {
  const pending = Promise.resolve().then(operation);
  pendingDesktopWrites.add(pending);
  return pending.finally(() => pendingDesktopWrites.delete(pending));
}

function configurePortableDataDirectory(legacyRoot) {
  const applicationDirectory =
    process.env.PORTABLE_EXECUTABLE_DIR ?? path.dirname(process.execPath);
  const portableRoot =
    process.env.VOCABULARY_TRAINER_PORTABLE_DATA_DIR ??
    path.join(applicationDirectory, "Vocabulary Trainer Data");
  let createdForMigration = false;
  let migratedFrom = null;
  try {
    mkdirSync(portableRoot, { recursive: true });
    assertDirectoryWritable(portableRoot);
    const portableWasEmpty = readdirSync(portableRoot).length === 0;
    if (
      portableWasEmpty &&
      path.resolve(legacyRoot) !== path.resolve(portableRoot) &&
      hasLegacyApplicationData(legacyRoot)
    ) {
      createdForMigration = true;
      cpSync(legacyRoot, portableRoot, {
        recursive: true,
        force: false,
        errorOnExist: false,
      });
      migratedFrom = legacyRoot;
    }
    app.setPath("userData", portableRoot);
    return { root: portableRoot, portable: true, migratedFrom, warning: null };
  } catch (error) {
    if (createdForMigration) {
      try {
        rmSync(portableRoot, { recursive: true, force: true });
      } catch {
        // The original AppData copy remains authoritative even if cleanup fails.
      }
    }
    app.setPath("userData", legacyRoot);
    return {
      root: legacyRoot,
      portable: false,
      migratedFrom: null,
      warning:
        error instanceof Error
          ? error.message
          : "The application directory is not writable.",
    };
  }
}

function assertDirectoryWritable(directory) {
  accessSync(directory, fsConstants.W_OK);
  const probe = path.join(directory, `.write-test-${process.pid}`);
  writeFileSync(probe, "portable storage check", { flag: "wx" });
  unlinkSync(probe);
}

function hasLegacyApplicationData(directory) {
  if (!existsSync(directory)) return false;
  return ["IndexedDB", "Local Storage", "WebStorage"].some((entry) =>
    existsSync(path.join(directory, entry)),
  );
}

async function getDesktopStorageInfo() {
  const root = app.getPath("userData");
  const [applicationBytes, freeBytes] = await Promise.all([
    directorySize(root).catch(() => null),
    statfs(root)
      .then((value) => Number(value.bavail) * Number(value.bsize))
      .then((value) => (Number.isFinite(value) ? value : null))
      .catch(() => null),
  ]);
  return {
    ...portableDataState,
    root,
    applicationBytes,
    freeBytes,
    windowTheme: currentWindowTheme,
    menuPresent: Menu.getApplicationMenu() !== null,
  };
}

async function directorySize(root) {
  let total = 0;
  const directory = await opendir(root);
  for await (const entry of directory) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) total += await directorySize(entryPath);
    else if (entry.isFile()) total += (await stat(entryPath)).size;
  }
  return total;
}

function titleBarColors(theme) {
  return theme === "dark"
    ? { color: "#020617", symbolColor: "#f8fafc", height: 36 }
    : { color: "#ffffff", symbolColor: "#0f172a", height: 36 };
}

function applyWindowTheme(window, theme) {
  currentWindowTheme = theme;
  nativeTheme.themeSource = theme;
  window.setBackgroundColor(theme === "dark" ? "#020617" : "#f8fafc");
  window.setTitleBarOverlay(titleBarColors(theme));
}

function assertVoicePackageId(packageId) {
  if (packageId !== JAPANESE_VOICE_PACKAGE_ID) {
    throw new Error("Unknown voice package.");
  }
}

function voicePackageRoot(packageId) {
  assertVoicePackageId(packageId);
  return path.join(app.getPath("userData"), "tts-packages", packageId);
}

function voicePackageStatus(packageId) {
  const root = voicePackageRoot(packageId);
  const installed = JAPANESE_VOICE_FILES.every(([file]) =>
    isFile(path.join(root, file)),
  );
  return {
    packageId,
    installed,
    estimatedBytes: JAPANESE_VOICE_PACKAGE_BYTES,
    directory: root,
  };
}

async function installVoicePackage(packageId, onProgress) {
  assertVoicePackageId(packageId);
  const current = voicePackageStatus(packageId);
  if (current.installed) return current;
  const destination = voicePackageRoot(packageId);
  const temporary = `${destination}.download`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  let completedBytes = 0;
  try {
    for (const [relativePath, url] of JAPANESE_VOICE_FILES) {
      if (!url) continue;
      const target = path.join(temporary, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      const response = await net.fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`Voice download failed: HTTP ${response.status}`);
      }
      const size = Number(response.headers.get("content-length")) || 0;
      let fileBytes = 0;
      const stream = Readable.fromWeb(response.body);
      stream.on("data", (chunk) => {
        fileBytes += chunk.length;
        onProgress({
          packageId,
          downloadedBytes: completedBytes + fileBytes,
          totalBytes: JAPANESE_VOICE_PACKAGE_BYTES,
        });
      });
      await pipeline(stream, createWriteStream(target));
      completedBytes += size || fileBytes;
    }
    await writeFile(
      path.join(temporary, "manifest.json"),
      `${JSON.stringify({ provider: "kokoro-js-jp", providerVersion: "0.2.0", model: "onnx-community/Kokoro-82M-v1.0-ONNX", dtype: "q4", voices: ["jf_alpha", "jf_gongitsune", "jf_nezumi", "jf_tebukuro", "jm_kumo"], installedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(temporary, destination);
    return voicePackageStatus(packageId);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function translationModelFiles(modelId, sizes) {
  const revision = TRANSLATION_MODEL_REVISIONS[modelId];
  if (!revision) throw new Error("Translation model revision is not pinned.");
  return Object.entries(sizes).map(([relativePath, size]) => [
    path.join("models", modelId, relativePath),
    `https://huggingface.co/${modelId}/resolve/${revision}/${relativePath}`,
    size,
  ]);
}

function translationPackageDescriptor(packageId) {
  const descriptor = TRANSLATION_PACKAGES[packageId];
  if (!descriptor) throw new Error("Unknown translation package.");
  return descriptor;
}

function translationPackageRoot(packageId) {
  translationPackageDescriptor(packageId);
  return path.join(app.getPath("userData"), "translation-models", packageId);
}

function translationPackageFiles(packageId) {
  const descriptor = translationPackageDescriptor(packageId);
  return descriptor.models.flatMap((modelId) => TRANSLATION_MODEL_FILES[modelId]);
}

function translationPackageStatus(packageId) {
  const descriptor = translationPackageDescriptor(packageId);
  const root = translationPackageRoot(packageId);
  const installed =
    isFile(path.join(root, "manifest.json")) &&
    translationPackageFiles(packageId).every((entry) => {
      const relativePath = entry[0];
      const expectedBytes = entry[2];
      const filePath = path.join(root, relativePath);
      return isFile(filePath) && statSync(filePath).size === expectedBytes;
    });
  return {
    packageId,
    installed,
    estimatedBytes: descriptor.estimatedBytes,
    directory: root,
    supported: true,
  };
}

async function installTranslationPackage(packageId, onProgress) {
  const descriptor = translationPackageDescriptor(packageId);
  const current = translationPackageStatus(packageId);
  if (current.installed) return current;
  const destination = translationPackageRoot(packageId);
  const temporary = `${destination}.download`;
  await rm(temporary, { recursive: true, force: true });
  await mkdir(temporary, { recursive: true });
  let completedBytes = 0;
  try {
    for (const [relativePath, url, expectedBytes] of translationPackageFiles(
      packageId,
    )) {
      const target = path.join(temporary, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      const response = await net.fetch(url, { redirect: "follow" });
      if (!response.ok || !response.body) {
        throw new Error(`Translation package download failed: HTTP ${response.status}`);
      }
      let fileBytes = 0;
      const stream = Readable.fromWeb(response.body);
      stream.on("data", (chunk) => {
        fileBytes += chunk.length;
        onProgress({
          packageId,
          downloadedBytes: completedBytes + fileBytes,
          totalBytes: descriptor.estimatedBytes,
        });
      });
      await pipeline(stream, createWriteStream(target));
      if (fileBytes !== expectedBytes) {
        throw new Error(`Translation package verification failed for ${relativePath}.`);
      }
      completedBytes += fileBytes;
    }
    await writeFile(
      path.join(temporary, "manifest.json"),
      `${JSON.stringify({ packageId, sourceLanguage: descriptor.sourceLanguage, targetLanguage: descriptor.targetLanguage, models: descriptor.models, modelRevisions: Object.fromEntries(descriptor.models.map((modelId) => [modelId, TRANSLATION_MODEL_REVISIONS[modelId]])), installedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
    await rm(destination, { recursive: true, force: true });
    await mkdir(path.dirname(destination), { recursive: true });
    await rename(temporary, destination);
    return translationPackageStatus(packageId);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

function lessonFilePath(fileName) {
  if (!/^[a-zA-Z0-9_-]+\.vtlesson$/u.test(fileName)) {
    throw new Error("Invalid Lesson file name.");
  }
  return path.join(app.getPath("userData"), "lessons", fileName);
}

function serveApplicationFile(request) {
  const requestUrl = new URL(request.url);
  if (requestUrl.host !== APP_HOST) {
    return new Response("Not found", { status: 404 });
  }

  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const isVoiceAsset = decodedPath.startsWith("/voice-models/");
  const translationMatch = decodedPath.match(
    /^\/translation-models\/([a-z0-9-]+)\/(.+)$/u,
  );
  const distributionRoot = path.join(app.getAppPath(), "dist");
  let root = distributionRoot;
  let relativePath = decodedPath.slice(1);
  if (isVoiceAsset) {
    root = voicePackageRoot(JAPANESE_VOICE_PACKAGE_ID);
    relativePath = decodedPath.slice("/voice-models/".length);
  } else if (translationMatch?.[1] && translationMatch[2]) {
    try {
      root = translationPackageRoot(translationMatch[1]);
      relativePath = translationMatch[2];
    } catch {
      return new Response("Unknown translation package", { status: 404 });
    }
  }
  const requestedFile = resolveInside(root, relativePath || "index.html");

  if (!requestedFile) {
    return new Response("Invalid path", { status: 400 });
  }

  const isPortableAsset = isVoiceAsset || Boolean(translationMatch);
  const fileToServe = isFile(requestedFile)
    ? requestedFile
    : isPortableAsset
      ? null
      : resolveInside(path.join(app.getAppPath(), "dist"), "index.html");
  if (!fileToServe || !isFile(fileToServe)) {
    return new Response("Application file not found", { status: 404 });
  }

  return net.fetch(pathToFileURL(fileToServe).toString());
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return resolved;
}

function isFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isExternalUrl(url) {
  return url.startsWith("https://") || url.startsWith("http://");
}

function readArgument(prefix) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? path.resolve(argument.slice(prefix.length)) : null;
}

function readValueArgument(prefix) {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : null;
}

async function runSmokeTest(window, outputPath) {
  const renderer = await window.webContents.executeJavaScript(`
    (async () => {
      const databaseAvailable = await new Promise((resolve) => {
        const request = indexedDB.open("vocabulary-trainer-desktop-smoke");
        request.onsuccess = () => {
          request.result.close();
          resolve(true);
        };
        request.onerror = () => resolve(false);
      });
      const desktopStorageAvailable = Boolean(
        window.vocabularyTrainerDesktop?.saveLessonFile,
      );
      const desktopShellAvailable = Boolean(
        window.vocabularyTrainerDesktop?.getStorageInfo &&
        window.vocabularyTrainerDesktop?.setWindowTheme &&
        window.vocabularyTrainerDesktop?.exitApplication,
      );
      const voicePackageAvailable = Boolean(
        window.vocabularyTrainerDesktop?.getVoicePackageStatus,
      );
      const systemVoiceSettingsAvailable = Boolean(
        window.vocabularyTrainerDesktop?.openSystemVoiceSettings,
      );
      const translationPackageAvailable = Boolean(
        window.vocabularyTrainerDesktop?.getTranslationPackageStatus &&
        window.vocabularyTrainerDesktop?.installTranslationPackage &&
        window.vocabularyTrainerDesktop?.deleteTranslationPackage,
      );
      const clipboardImageAvailable = Boolean(
        window.vocabularyTrainerDesktop?.readClipboardImage,
      );
      const imageSearchAvailable = Boolean(
        window.vocabularyTrainerDesktop?.openImageSearch,
      );
      const voicePackage = voicePackageAvailable
        ? await window.vocabularyTrainerDesktop.getVoicePackageStatus("kokoro-jp")
        : null;
      const translationPackage = translationPackageAvailable
        ? await window.vocabularyTrainerDesktop.getTranslationPackageStatus("multilingual-v1")
        : null;
      let desktopStorageRoot = null;
      let storageInfo = null;
      let lightThemeApplied = false;
      let darkThemeApplied = false;
      if (desktopStorageAvailable) {
        desktopStorageRoot =
          await window.vocabularyTrainerDesktop.getStorageRoot();
        await window.vocabularyTrainerDesktop.saveLessonFile(
          "desktop-smoke.vtlesson",
          new TextEncoder().encode("desktop smoke").buffer,
        );
        await window.vocabularyTrainerDesktop.removeLessonFile(
          "desktop-smoke.vtlesson",
        );
        storageInfo = await window.vocabularyTrainerDesktop.getStorageInfo();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await window.vocabularyTrainerDesktop.setWindowTheme("light");
        lightThemeApplied =
          (await window.vocabularyTrainerDesktop.getStorageInfo()).windowTheme ===
          "light";
        await window.vocabularyTrainerDesktop.setWindowTheme("dark");
        darkThemeApplied =
          (await window.vocabularyTrainerDesktop.getStorageInfo()).windowTheme ===
          "dark";
      }
      const navigation = performance.getEntriesByType("navigation")[0];
      return {
        title: document.title,
        url: location.href,
        databaseAvailable,
        desktopStorageAvailable,
        desktopShellAvailable,
        desktopStorageRoot,
        storageInfo,
        lightThemeApplied,
        darkThemeApplied,
        exitButtonAvailable: Boolean(
          document.querySelector('[data-testid="desktop-exit"]'),
        ),
        clipboardImageAvailable,
        imageSearchAvailable,
        systemVoiceSettingsAvailable,
        voicePackageAvailable,
        voicePackage,
        translationPackageAvailable,
        translationPackage,
        rendererLoadMs: navigation ? navigation.duration : null,
      };
    })()
  `);
  const result = {
    ok:
      renderer.title === "Vocabulary Trainer" &&
      renderer.databaseAvailable === true &&
      renderer.desktopStorageAvailable === true &&
      renderer.desktopShellAvailable === true &&
      renderer.storageInfo?.menuPresent === false &&
      renderer.lightThemeApplied === true &&
      renderer.darkThemeApplied === true &&
      renderer.exitButtonAvailable === true &&
      renderer.clipboardImageAvailable === true &&
      renderer.systemVoiceSettingsAvailable === true &&
      renderer.voicePackageAvailable === true &&
      renderer.voicePackage?.installed === false &&
      renderer.translationPackageAvailable === true &&
      renderer.translationPackage?.supported === true &&
      renderer.translationPackage?.installed === false &&
      renderer.translationPackage?.directory?.includes("translation-models"),
    packaged: app.isPackaged,
    mainLaunchMs: Number((performance.now() - launchStartedAt).toFixed(1)),
    ...renderer,
  };
  await writeSmokeResult(outputPath, result);
  app.exit(result.ok ? 0 : 1);
}

async function runPortableSmokeTest(window, outputPath, mode) {
  const renderer = await window.webContents.executeJavaScript(`
    (async () => {
      const mode = ${JSON.stringify(mode)};
      const token = "portable-storage-state-v1";
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("vocabulary-trainer-portable-smoke", 1);
        request.onupgradeneeded = () =>
          request.result.createObjectStore("state");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (mode === "write" || mode === "fallback") {
        await new Promise((resolve, reject) => {
          const transaction = database.transaction("state", "readwrite");
          transaction.objectStore("state").put(token, "token");
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      }
      const storedToken = await new Promise((resolve, reject) => {
        const request = database
          .transaction("state", "readonly")
          .objectStore("state")
          .get("token");
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      database.close();
      return {
        storedToken,
        storageInfo: await window.vocabularyTrainerDesktop.getStorageInfo(),
      };
    })()
  `);
  const result = {
    ok:
      (mode === "write" || mode === "read" || mode === "fallback") &&
      renderer.storedToken === "portable-storage-state-v1" &&
      renderer.storageInfo?.portable === (mode !== "fallback") &&
      renderer.storageInfo?.menuPresent === false,
    mode,
    packaged: app.isPackaged,
    ...renderer,
  };
  await writeSmokeResult(outputPath, result);
  app.exit(result.ok ? 0 : 1);
}

async function runExitSmokeTest(window) {
  await window.webContents.executeJavaScript(`
    (() => {
      const button = document.querySelector('[data-testid="desktop-exit"]');
      if (!button) throw new Error("Desktop Exit button is unavailable.");
      button.click();
    })()
  `);
}

async function writeSmokeResult(outputPath, result) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}
