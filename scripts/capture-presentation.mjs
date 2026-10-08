import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const baseUrl = process.env.PRESENTATION_URL ?? "http://127.0.0.1:4173";
const outputDirectory = resolve("landing", "assets", "screens");
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  locale: "en-US",
  colorScheme: "dark",
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

async function capture(name) {
  await page.screenshot({
    path: resolve(outputDirectory, `${name}.png`),
    fullPage: false,
  });
}

try {
  await page.goto(`${baseUrl}/?demo=1`, { waitUntil: "networkidle" });
  await page.getByText("Everyday English · Demo", { exact: true }).waitFor();
  await capture("01-home");

  await page.getByText("Everyday English · Demo", { exact: true }).click();
  await page.getByRole("heading", { name: "Everyday English · Demo" }).waitFor();
  await capture("02-lesson");

  await page.locator('main a[href$="/learn"]').click();
  await page.locator("main button").first().click();
  await page.getByText(/Stage 1 \/ 3/i).waitFor();
  await capture("03-learn");

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator('a[href*="/practice?lesson="]').click();
  await page.getByRole("heading", { name: "Practice builder", exact: true }).waitFor();
  await capture("04-practice");

  await page.goto(`${baseUrl}/today`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: "Everyday English · Demo", exact: true })
    .waitFor();
  await capture("05-today");
} finally {
  await browser.close();
}
