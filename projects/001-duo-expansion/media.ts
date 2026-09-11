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
  if (image.naturalWidth < 1 || image.naturalHeight < 1)
    throw new Error('This image has no usable dimensions.');
  if (image.naturalWidth * image.naturalHeight > 80000000)
    throw new Error(
      'This image is too large. Choose an image under 80 megapixels.',
    );
  // Portrait/square sources use the center of a 3:2 landscape window.
  // Crop before resizing so discarded rows do not consume the texture budget.
  const cropWidth = image.naturalWidth;
  const cropHeight =
    image.naturalWidth <= image.naturalHeight
      ? cropWidth / 1.5
      : image.naturalHeight;
  const cropY = (image.naturalHeight - cropHeight) / 2;
  const scale = Math.min(1, 2048 / Math.max(cropWidth, cropHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(cropWidth * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not prepare this image. Please try again.');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(
    image,
    0,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  return canvas;
}

export function isVideo(file: Pick<File, 'type' | 'name'>): boolean {
  return (
    file.type.startsWith('video/') ||
    (!file.type && /\.(mp4|m4v|mov|webm)$/i.test(file.name))
  );
}

export type DecodedMedia = {
  canvas: HTMLCanvasElement;
  kind: 'image' | 'video';
  start: (onFrame: () => void, onError: (error: Error) => void) => void;
  setPaused: (paused: boolean) => void;
  dispose: () => void;
};

// Video frames share the same centered landscape crop as still images.
export function videoCrop(width: number, height: number) {
  const cropHeight = width <= height ? width / 1.5 : height;
  const scale = Math.min(1, 1280 / Math.max(width, cropHeight));
  return {
    y: (height - cropHeight) / 2,
    cropHeight,
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(cropHeight * scale)),
  };
}

export async function decodeMedia(
  source: File | string,
): Promise<DecodedMedia> {
  const videoSource =
    typeof source === 'string'
      ? isVideo({ type: '', name: source.split(/[?#]/)[0] })
      : isVideo(source);
  if (!videoSource) {
    const canvas =
      typeof source === 'string'
        ? await decodeURL(source)
        : await decodeImage(source);
    return { canvas, kind: 'image', start() {}, setPaused() {}, dispose() {} };
  }
  if (typeof source !== 'string' && source.size > 100 * 1024 * 1024)
    throw new Error('Choose a video smaller than 100 MB.');
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  const ownsURL = typeof source !== 'string';
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  let disposed = false;
  let paused = false;
  let started = false;
  let frame = 0;
  let lastTime = -1;
  let lastUpload = -Infinity;
  let onFrame = () => {};
  let onError = (_error: Error) => {};
  const nativeFrames = typeof video.requestVideoFrameCallback === 'function';
  const cancelFrame = () => {
    if (nativeFrames) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = 0;
  };
  const syncPlayback = () => {
    if (disposed) return;
    if (!started || paused || document.hidden) {
      video.pause();
      cancelFrame();
    } else {
      void video
        .play()
        .then(() => {
          if (!disposed && !paused && !document.hidden && !frame) schedule();
        })
        .catch(() => {
          if (!disposed && !paused && !document.hidden)
            onError(
              new Error(
                'Video playback was blocked. Select the video again to retry.',
              ),
            );
        });
    }
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelFrame();
    document.removeEventListener('visibilitychange', syncPlayback);
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (ownsURL) URL.revokeObjectURL(url);
  };
  let draw = () => {};
  const tick = (now: number) => {
    frame = 0;
    if (disposed || paused || document.hidden) return;
    // Upload decoded frames at most 60 times/second; no work for duplicate frames.
    if (
      video.readyState >= 2 &&
      video.currentTime !== lastTime &&
      now - lastUpload >= 1000 / 60 - 1
    ) {
      draw();
      lastTime = video.currentTime;
      lastUpload = now;
      onFrame();
    }
    schedule();
  };
  function schedule() {
    frame = nativeFrames
      ? video.requestVideoFrameCallback(tick)
      : requestAnimationFrame(tick);
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('error', failed);
      };
      const ready = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(
          new Error(
            'This video cannot be played by your browser. Try an H.264 MP4 or WebM video.',
          ),
        );
      };
      const timeout = setTimeout(failed, 15000);
      video.addEventListener('loadeddata', ready);
      video.addEventListener('error', failed);
      video.src = url;
      video.load();
    });
    if (!video.videoWidth || !video.videoHeight)
      throw new Error('This video has no usable dimensions.');
    const crop = videoCrop(video.videoWidth, video.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = crop.width;
    canvas.height = crop.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Could not prepare this video.');
    draw = () =>
      context.drawImage(
        video,
        0,
        crop.y,
        video.videoWidth,
        crop.cropHeight,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    draw();
    document.addEventListener('visibilitychange', syncPlayback);
    return {
      canvas,
      kind: 'video',
      start(update, error) {
        onFrame = update;
        onError = error;
        started = true;
        syncPlayback();
      },
      setPaused(value) {
        paused = value;
        syncPlayback();
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
