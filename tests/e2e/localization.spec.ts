import { expect, test } from "@playwright/test";

import { interfaceLanguageCodes } from "../../src/i18n/supported-locales";

test("fresh launch detects every supported system UI locale", { tag: ["@i18n", "@ui"] }, async ({ browser }) => {
  for (const code of interfaceLanguageCodes) {
    const context = await browser.newContext({ locale: `${code}-${code.toUpperCase()}` });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", code);
    await expect(page.locator("main h1")).toBeVisible();
    await context.close();
  }
});

test("saved interface language wins over the system locale", { tag: ["@i18n", "@settings"] }, async ({ browser }) => {
  const context = await browser.newContext({ locale: "ja-JP" });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("header details > summary").click();
  await page.locator("#interface-language").selectOption("ru");
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.locator("main h1")).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await page.locator("header details > summary").click();
  await expect(page.locator("#interface-language")).toHaveValue("ru");
  await context.close();
});

test("every locale renders core screens in dark and light themes without clipped labels", { tag: ["@i18n", "@ui"] }, async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.locator("header details > summary").click();
  await expect(page.locator("#interface-language option")).toHaveCount(
    interfaceLanguageCodes.length,
  );

  for (const code of interfaceLanguageCodes) {
    if (!(await page.locator("header details").evaluate((element) => element.hasAttribute("open")))) {
      await page.locator("header details > summary").click();
    }
    await page.locator("#interface-language").selectOption(code);
    await expect(page.locator("html")).toHaveAttribute("lang", code);
    await assertNoMissingKeysOrClippedLabels(page);

    await page.goto("/settings");
    await expect(page.locator("main h1")).toBeVisible();
    await assertNoMissingKeysOrClippedLabels(page);

    await page.goto("/lessons/new");
    await expect(page.locator("main h1")).toBeVisible();
    await assertNoMissingKeysOrClippedLabels(page);

    await page.locator("header details > summary").click();
    const themeButton = page.locator("header details button").first();
    await cycleToTheme(page, themeButton, false);
    await expect(page.locator("html")).not.toHaveClass(/dark/u);
    await assertNoMissingKeysOrClippedLabels(page);
    await cycleToTheme(page, themeButton, true);
    await expect(page.locator("html")).toHaveClass(/dark/u);
    await page.goto("/");
  }
});

async function cycleToTheme(
  page: import("@playwright/test").Page,
  button: import("@playwright/test").Locator,
  dark: boolean,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const isDark = await page.locator("html").evaluate((element) =>
      element.classList.contains("dark"),
    );
    if (isDark === dark) return;
    const previousLabel = await button.textContent();
    await button.click();
    await expect(button).not.toHaveText(previousLabel!);
  }
}

async function assertNoMissingKeysOrClippedLabels(page: import("@playwright/test").Page) {
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(
    /\b(?:nav|common|theme|language|home|lesson|wizard|card|audio|readiness|learn|automate|quick|chaos|credits|settings|languages|errors|notFound)\.[A-Za-z]/u,
  );
  const problems = await page.locator("button, a, label, h1, h2, h3").evaluateAll((elements) =>
    elements.flatMap((element) => {
      const html = element as HTMLElement;
      if (html.classList.contains("sr-only") && document.activeElement !== html) {
        return [];
      }
      const bounds = html.getBoundingClientRect();
      if (bounds.width < 2 || bounds.height < 2) return [];
      const style = getComputedStyle(html);
      const clipped =
        (style.overflowX === "hidden" && html.scrollWidth > html.clientWidth + 2) ||
        (style.overflowY === "hidden" && html.scrollHeight > html.clientHeight + 2);
      const outsideViewport =
        bounds.left < -2 ||
        (bounds.right > document.documentElement.clientWidth + 2 &&
          !html.closest(".overflow-x-auto"));
      return clipped || outsideViewport
        ? [`${html.tagName}: ${html.textContent?.trim().slice(0, 80)}`]
        : [];
    }),
  );
  expect(problems).toEqual([]);
}
