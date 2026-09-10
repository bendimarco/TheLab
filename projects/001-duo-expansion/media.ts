// Decode locally, respect image orientation, and bound texture memory before upload.
export async function decodeImage(file: File): Promise<HTMLCanvasElement> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml')
    throw new Error('Choose a JPEG, PNG, WebP, or AVIF image.');
  if (file.size > 30 * 1024 * 1024)
    throw new Error('Choose an image smaller than 30 MB.');
  const url = URL.createObjectURL(file);
  try {
    return await decodeURL(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function decodeURL(url: string): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    throw new Error(
      'This image could not be opened. Try exporting it as JPEG or PNG.',
    );
  }
  if (image.naturalWidth <= image.naturalHeight)
    throw new Error('Choose a landscape image that is wider than it is tall.');
  if (image.naturalWidth * image.naturalHeight > 80000000)
    throw new Error(
      'This image is too large. Choose an image under 80 megapixels.',
    );
  const scale = Math.min(
    1,
    2048 / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}
