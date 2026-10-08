import type { StoredImage } from '../domain';

const MAX_IMAGE_DIMENSION = 1024;

export class ClipboardImageError extends Error {
  constructor(
    public readonly code: 'no-image' | 'unavailable',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ClipboardImageError';
  }
}

interface ClipboardImageBridge {
  readClipboardImage?: () => Promise<Uint8Array | null>;
}

interface ClipboardImageWindow extends Window {
  vocabularyTrainerDesktop?: ClipboardImageBridge;
}

interface ClipboardReader {
  read: () => Promise<ClipboardItems>;
}

export async function optimizeImage(blob: Blob): Promise<StoredImage> {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');

  if (!context) {
    bitmap.close();
    throw new Error('Image processing is unavailable in this browser.');
  }

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const preservesTransparency = blob.type === 'image/png';
  const mimeType = preservesTransparency ? 'image/png' : 'image/webp';
  const optimized = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result ? resolve(result) : reject(new Error('Image optimization failed.')),
      mimeType,
      preservesTransparency ? undefined : 0.84,
    );
  });

  return { blob: optimized, mimeType, width, height };
}

export async function downloadAndOptimizeImage(url: string): Promise<StoredImage> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error('The selected image could not be downloaded.');
  }

  return optimizeImage(await response.blob());
}

export function imageFromClipboardData(data: DataTransfer): Blob | null {
  const item = [...data.items].find(
    (entry) => entry.kind === 'file' && entry.type.startsWith('image/'),
  );
  return item?.getAsFile() ??
    [...data.files].find((file) => file.type.startsWith('image/')) ??
    null;
}

export async function readImageFromClipboard(
  reader: ClipboardReader | undefined = globalThis.navigator?.clipboard,
): Promise<Blob> {
  const desktop = (globalThis.window as ClipboardImageWindow | undefined)
    ?.vocabularyTrainerDesktop;

  if (desktop?.readClipboardImage) {
    try {
      const bytes = await desktop.readClipboardImage();
      if (!bytes) throw new ClipboardImageError('no-image', 'Clipboard contains no image.');
      return new Blob([Uint8Array.from(bytes).buffer], { type: 'image/png' });
    } catch (error) {
      if (error instanceof ClipboardImageError) throw error;
      throw new ClipboardImageError(
        'unavailable',
        'Clipboard access failed.',
        { cause: error },
      );
    }
  }

  if (!reader?.read) {
    throw new ClipboardImageError(
      'unavailable',
      'Clipboard image access is unavailable.',
    );
  }

  try {
    const items = await reader.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith('image/'));
      if (imageType) return await item.getType(imageType);
    }
  } catch (error) {
    throw new ClipboardImageError(
      'unavailable',
      'Clipboard access failed.',
      { cause: error },
    );
  }

  throw new ClipboardImageError('no-image', 'Clipboard contains no image.');
}
