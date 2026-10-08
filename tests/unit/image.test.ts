import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ClipboardImageError,
  optimizeImage,
  readImageFromClipboard,
} from "../../src/services/image";
import {
  buildVisualImageSearchQuery,
  createImageSearchSeed,
  googleImagesSearchUrl,
} from "../../src/services/image-search";

describe("image workflow", () => {
  const drawImage = vi.fn();
  const close = vi.fn();
  let bitmapSize = { width: 640, height: 480 };

  beforeEach(() => {
    bitmapSize = { width: 640, height: 480 };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => ({ ...bitmapSize, close })),
    );
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      (callback, type) => callback(new Blob(["optimized"], { type })),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads PNG and JPEG clipboard items", async () => {
    for (const type of ["image/png", "image/jpeg"]) {
      const source = new Blob([type], { type });
      const result = await readImageFromClipboard({
        read: async () => [
          {
            types: ["text/plain", type],
            getType: async (requested) => {
              expect(requested).toBe(type);
              return source;
            },
            presentationStyle: "unspecified",
          },
        ],
      });
      expect(result).toBe(source);
    }
  });

  it("reports a clipboard with no image without inventing content", async () => {
    await expect(
      readImageFromClipboard({
        read: async () => [
          {
            types: ["text/plain"],
            getType: async () => new Blob(["text"], { type: "text/plain" }),
            presentationStyle: "unspecified",
          },
        ],
      }),
    ).rejects.toMatchObject<Partial<ClipboardImageError>>({ code: "no-image" });
  });

  it("reports denied clipboard access as unavailable", async () => {
    await expect(
      readImageFromClipboard({
        read: async () => {
          throw new DOMException("Permission denied", "NotAllowedError");
        },
      }),
    ).rejects.toMatchObject<Partial<ClipboardImageError>>({ code: "unavailable" });
  });

  it("preserves PNG encoding so transparent pixels remain representable", async () => {
    const result = await optimizeImage(
      new Blob(["transparent-png"], { type: "image/png" }),
    );
    expect(result.mimeType).toBe("image/png");
    expect(result.blob.type).toBe("image/png");
  });

  it("converts JPEG input to optimized WebP", async () => {
    const result = await optimizeImage(new Blob(["jpeg"], { type: "image/jpeg" }));
    expect(result.mimeType).toBe("image/webp");
    expect(result).toMatchObject({ width: 640, height: 480 });
  });

  it("reduces a large image to a 1024 px maximum dimension", async () => {
    bitmapSize = { width: 4096, height: 2048 };
    const result = await optimizeImage(new Blob(["large"], { type: "image/jpeg" }));
    expect(result).toMatchObject({ width: 1024, height: 512 });
  });

  it("replaces the previous optimized value when a second source is assigned", async () => {
    const first = await optimizeImage(new Blob(["first"], { type: "image/png" }));
    const second = await optimizeImage(new Blob(["second"], { type: "image/jpeg" }));
    const draft = { image: first };
    draft.image = second;
    expect(draft.image.mimeType).toBe("image/webp");
    expect(draft.image).not.toBe(first);
  });

  it("combines the translated meaning and target word as search context", () => {
    expect(createImageSearchSeed("frozen", "eingefroren", "de")).toBe(
      '"frozen" "eingefroren" German language',
    );
    expect(createImageSearchSeed("Fuchs", "fuchs", "de")).toBe(
      '"Fuchs" German language',
    );
    expect(createImageSearchSeed("and", "と", "ja")).toBe(
      '"and" "と" Japanese language',
    );
  });

  it("refines a short query toward a beginner educational illustration", () => {
    expect(buildVisualImageSearchQuery('"love" "Liebe" German language')).toBe(
      '"love" "Liebe" German language beginner vocabulary flashcard educational illustration',
    );
  });

  it("respects an explicitly requested visual style", () => {
    expect(buildVisualImageSearchQuery("red fox wildlife photo")).toBe(
      "red fox wildlife photo",
    );
  });

  it("builds an encoded Google Images query without excluding educational diagrams", () => {
    const url = new URL(
      googleImagesSearchUrl('"red fox" "Fuchs" German language'),
    );
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("tbm")).toBe("isch");
    expect(url.searchParams.get("tbs")).toBeNull();
    expect(url.searchParams.get("q")).toBe(
      '"red fox" "Fuchs" German language beginner vocabulary flashcard educational illustration',
    );
  });
});
