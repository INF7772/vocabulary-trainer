import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const projectRoot = resolve(import.meta.dirname, "..");
const publicRoot = join(projectRoot, "public", "voice-models");
const packageAssets = join(
  projectRoot,
  "node_modules",
  "kokoro-js-jp",
  "dist",
);
const japaneseRoot = join(publicRoot, "kokoro-js-jp");
const modelRoot = join(
  publicRoot,
  "models",
  "onnx-community",
  "Kokoro-82M-v1.0-ONNX",
);
const runtimeSource = join(projectRoot, "node_modules", "onnxruntime-web", "dist");
const runtimeRoot = join(publicRoot, "onnxruntime");
const modelBase =
  "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main";

const japaneseAssets = [
  ["open_jtalk_dic_utf_8-1.11.tar.gz", "open_jtalk_dic_utf_8-1.11.tar.bin"],
  ["openjtalk-voice.htsvoice", "openjtalk-voice.htsvoice"],
  ["browser/worker.js", "browser/worker.js"],
  ["openjtalk-wasm-wrapper-D6E3BSJO.js", "openjtalk-wasm-wrapper-D6E3BSJO.js"],
  ["openjtalk-wasm.wasm", "openjtalk-wasm.wasm"],
];
const runtimeAssets = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];
const modelAssets = [
  ["config.json", 1],
  ["tokenizer.json", 1],
  ["tokenizer_config.json", 1],
  ["onnx/model_q4.onnx", 300_000_000],
  ["voices/jf_alpha.bin", 1],
];

await mkdir(publicRoot, { recursive: true });
for (const [sourcePath, destinationPath] of japaneseAssets) {
  await copyLocalAsset(packageAssets, japaneseRoot, sourcePath, destinationPath);
}
// Older builds exposed the archive with a `.gz` suffix. Vite then added a
// Content-Encoding header and browsers transparently decompressed it, which
// broke Open JTalk's checksum validation. Remove that obsolete generated copy.
await rm(join(japaneseRoot, "open_jtalk_dic_utf_8-1.11.tar.gz"), {
  force: true,
});
for (const relativePath of runtimeAssets) {
  await copyLocalAsset(runtimeSource, runtimeRoot, relativePath);
}
for (const [relativePath, minimumBytes] of modelAssets) {
  await downloadAsset(
    `${modelBase}/${relativePath}`,
    join(modelRoot, relativePath),
    minimumBytes,
  );
}

const manifest = {
  provider: "kokoro-js-jp",
  providerVersion: "0.2.0",
  model: "onnx-community/Kokoro-82M-v1.0-ONNX",
  dtype: "q4",
  voice: "jf_alpha",
  installedAt: new Date().toISOString(),
};
await writeFile(
  join(publicRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(`Voice assets are ready in ${publicRoot}\n`);

async function copyLocalAsset(
  sourceRoot,
  destinationRoot,
  sourcePath,
  destinationPath = sourcePath,
) {
  const source = join(sourceRoot, sourcePath);
  const destination = join(destinationRoot, destinationPath);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function downloadAsset(url, destination, minimumBytes) {
  try {
    const current = await stat(destination);
    if (current.size >= minimumBytes) return;
  } catch {
    // Missing or incomplete files are downloaded below.
  }

  await mkdir(dirname(destination), { recursive: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`Unable to download ${url}: HTTP ${response.status}`);
  }
  const temporary = `${destination}.download`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
  const downloaded = await stat(temporary);
  if (downloaded.size < minimumBytes) {
    await rm(temporary, { force: true });
    throw new Error(`Downloaded file is unexpectedly small: ${url}`);
  }
  await rm(destination, { force: true });
  await rename(temporary, destination);
}
