export const MAX_LONG_EDGE = 1280;
export const JPEG_QUALITY = 0.8;
export const MAX_UPLOAD_BYTES = 1_500_000;

export interface Dimensions {
  width: number;
  height: number;
}

export function targetSize(width: number, height: number, maxLongEdge = MAX_LONG_EDGE): Dimensions {
  const longest = Math.max(width, height);
  if (longest <= maxLongEdge || longest === 0) {
    return { width, height };
  }
  const scale = maxLongEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function toBitmap(source: Blob | HTMLVideoElement): Promise<ImageBitmap> {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return createImageBitmap(source);
  }
  return createImageBitmap(source as Blob, { imageOrientation: "from-image" });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("N\u00e3o consegui preparar a imagem."));
        }
      },
      "image/jpeg",
      quality
    );
  });
}

export async function prepareImage(source: Blob | HTMLVideoElement): Promise<Blob> {
  const bitmap = await toBitmap(source);
  try {
    const { width, height } = targetSize(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("N\u00e3o consegui processar a imagem.");
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await canvasToBlob(canvas, JPEG_QUALITY);
    if (blob.size > MAX_UPLOAD_BYTES) {
      throw new Error("A foto ficou muito grande. Tente tirar outra.");
    }
    return blob;
  } finally {
    bitmap.close();
  }
}
