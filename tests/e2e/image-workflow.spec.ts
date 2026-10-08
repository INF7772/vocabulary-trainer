import { expect, test } from "@playwright/test";

test("handles clipboard images, replacement, optimization, and offline search", { tag: "@image" }, async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/lessons/new");
  await page.getByLabel("Lesson name").fill("Image workflow");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Target language").fill("ger");
  await page.getByRole("option", { name: /German/i }).getByRole("button").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Paste words").fill("Fuchs");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Paste translation list" }).click();
  await page.locator("#bulk-translations").fill("fox");
  await page.getByRole("button", { name: "Apply translations" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Generate Cards" }).click();
  await page.getByRole("link", { name: "Fuchs" }).last().click();

  await page.getByText("Image search", { exact: true }).click();
  await expect(page.getByLabel("Image search")).toHaveValue(
    '"fox" "Fuchs" German language',
  );

  const dropZone = page.getByTestId("image-drop-zone");
  await expect(dropZone).toBeVisible();

  await page.evaluate(async () => {
    await navigator.clipboard.writeText("plain text only");
  });
  await page.getByRole("button", { name: "Paste from clipboard" }).click();
  await expect(page.getByText("The clipboard does not contain an image.")).toBeVisible();

  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 12;
    canvas.height = 8;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, 12, 8);
    context.fillStyle = "rgba(255, 0, 0, 0.5)";
    context.fillRect(0, 0, 6, 8);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await page.getByRole("button", { name: "Paste from clipboard" }).click();
  const preview = dropZone.locator("img");
  await expect(preview).toBeVisible();
  await expect(page.getByText("Image ready. Save the Card to keep it.")).toBeVisible();
  const transparentPngUrl = await preview.getAttribute("src");

  await dispatchClipboardImage(page, "image/png", 2048, 1024);
  await expect
    .poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBe(1024);
  await expect
    .poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalHeight))
    .toBe(512);

  const beforeTextPaste = await preview.getAttribute("src");
  await page.getByLabel("Target word").evaluate(async (input) => {
    const canvas = document.createElement("canvas");
    canvas.width = 3;
    canvas.height = 3;
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((value) => resolve(value!), "image/png"),
    );
    const data = new DataTransfer();
    data.items.add(new File([blob], "ignored.png", { type: "image/png" }));
    input.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }),
    );
  });
  expect(await preview.getAttribute("src")).toBe(beforeTextPaste);

  await dispatchClipboardImage(page, "image/jpeg", 40, 20);
  await expect
    .poll(() => preview.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBe(40);
  expect(await preview.getAttribute("src")).not.toBe(transparentPngUrl);

  await context.setOffline(true);
  await page.getByRole("button", { name: "Search Google Images" }).click();
  await expect(page.locator("#main-content p[role='status']")).toContainText(
    "You are offline",
  );
  await context.setOffline(false);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Image workflow" })).toBeVisible();
});

async function dispatchClipboardImage(
  page: import("@playwright/test").Page,
  mimeType: "image/png" | "image/jpeg",
  width: number,
  height: number,
) {
  await page.getByTestId("image-drop-zone").evaluate(
    async (target, input) => {
      const canvas = document.createElement("canvas");
      canvas.width = input.width;
      canvas.height = input.height;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#2563eb";
      context.fillRect(0, 0, input.width, input.height);
      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((value) => resolve(value!), input.mimeType, 0.9),
      );
      const data = new DataTransfer();
      data.items.add(
        new File([blob], input.mimeType === "image/png" ? "paste.png" : "paste.jpg", {
          type: input.mimeType,
        }),
      );
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    },
    { mimeType, width, height },
  );
}
