// Shrinks a photo on the phone before upload: longest side 1280px, JPEG
// ~0.78 quality. A typical 3–5 MB camera photo becomes ~150–300 KB, which
// keeps uploads fast on mobile data and the free Blob storage going further.

const MAX_SIDE = 1280;
const QUALITY = 0.78;
const MAX_UPLOAD_BYTES = 1.5 * 1024 * 1024;

export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bitmap) throw new Error("Couldn't read that photo.");
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process that photo.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let quality = QUALITY;
  let blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  // Very detailed photos can still be large; step quality down until it fits.
  while (blob && blob.size > MAX_UPLOAD_BYTES && quality > 0.4) {
    quality -= 0.15;
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  if (!blob) throw new Error("Couldn't process that photo.");
  return blob;
}
