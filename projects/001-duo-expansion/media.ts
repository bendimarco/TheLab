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
  textureSource: HTMLCanvasElement | HTMLVideoElement;
  kind: 'image' | 'video';
  start: (
    onFrame: () => void,
    onError: (error: Error) => void,
    onNeedsPlay?: (needed: boolean) => void,
  ) => void;
  resume: () => void;
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

// Retain only one small compressed sample, never a decoder or GPU resource.
// Cycling back to it avoids fetching/buffering the same clip again.
let sampleCache: { source: string; blob: Blob } | null = null;
async function fetchSampleVideo(source: string): Promise<Blob> {
  if (sampleCache?.source === source) return sampleCache.blob;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // Buffer samples locally: some static hosts ignore the decoder's HTTP Range.
    const response = await fetch(source, { signal: controller.signal });
    if (!response.ok)
      throw new Error(
        'The sample video could not be downloaded. Please try again.',
      );
    if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024)
      throw new Error('Choose a video smaller than 100 MB.');
    const blob = await response.blob();
    if (blob.size > 100 * 1024 * 1024)
      throw new Error('Choose a video smaller than 100 MB.');
    sampleCache = blob.size <= 12 * 1024 * 1024 ? { source, blob } : null;
    return blob;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error('The video download took too long. Please try again.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    return {
      canvas,
      textureSource: canvas,
      kind: 'image',
      start() {},
      resume() {},
      setPaused() {},
      dispose() {},
    };
  }
  if (typeof source !== 'string' && source.size > 100 * 1024 * 1024)
    throw new Error('Choose a video smaller than 100 MB.');
  const video = document.createElement('video');
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'auto';
  const blob =
    typeof source === 'string' ? await fetchSampleVideo(source) : source;
  const url = URL.createObjectURL(blob);
  let disposed = false;
  let failed = false;
  let paused = false;
  let started = false;
  let frame = 0;
  let lastTime = -1;
  let lastUpload = -Infinity;
  let onFrame = () => {};
  let onError = (_error: Error) => {};
  let onNeedsPlay = (_needed: boolean) => {};
  let playRequest = 0;
  let playPending = false;
  const nativeFrames = typeof video.requestVideoFrameCallback === 'function';
  const cancelFrame = () => {
    if (nativeFrames) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = 0;
  };
  const syncPlayback = () => {
    if (disposed || failed) return;
    if (!started || paused || document.hidden) {
      ++playRequest;
      playPending = false;
      video.pause();
      cancelFrame();
      return;
    }
    if (playPending || frame) return;
    const request = ++playRequest;
    playPending = true;
    // Called synchronously by resume() inside the Play button's click handler.
    // Deferring this behind image decoding or a fade loses Safari's user gesture.
    void video
      .play()
      .then(() => {
        if (disposed || request !== playRequest || paused || document.hidden)
          return;
        playPending = false;
        onNeedsPlay(false);
        if (!frame) schedule();
      })
      .catch((error: unknown) => {
        if (disposed || request !== playRequest || paused || document.hidden)
          return;
        playPending = false;
        const name = error instanceof Error ? error.name : '';
        if (name === 'NotAllowedError' || name === 'AbortError') {
          onNeedsPlay(true);
        } else {
          onError(
            new Error(
              'This video could not play. Try an H.264 MP4 or a different video.',
            ),
          );
        }
      });
  };
  const runtimeError = () => {
    if (disposed || failed) return;
    failed = true;
    ++playRequest;
    playPending = false;
    cancelFrame();
    onNeedsPlay(false);
    if (started)
      onError(
        new Error('Video decoding stopped. Try selecting another video.'),
      );
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    ++playRequest;
    cancelFrame();
    document.removeEventListener('visibilitychange', syncPlayback);
    video.removeEventListener('error', runtimeError);
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };
  let draw = () => {};
  let directVideoTexture = false;
  let hasPresentedFrame = false;
  const tick = (now: number, metadata?: VideoFrameCallbackMetadata) => {
    frame = 0;
    if (disposed || failed || paused || document.hidden) return;
    // currentTime can move between decoded frames. Prefer a decoded-frame identity.
    const quality =
      !metadata && typeof video.getVideoPlaybackQuality === 'function'
        ? video.getVideoPlaybackQuality()
        : undefined;
    const stamp =
      metadata?.mediaTime ?? quality?.totalVideoFrames ?? video.currentTime;
    // Upload decoded frames at most 60 times/second; no work for duplicate frames.
    if (
      video.readyState >= 2 &&
      stamp !== lastTime &&
      now - lastUpload >= 1000 / 60 - 1
    ) {
      if (!directVideoTexture) draw();
      hasPresentedFrame = true;
      lastTime = stamp;
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
    // Seek a small distance to force a decoded poster, instead of relying on
    // loadeddata's initial frame (which can still be blank on some decoders).
    if (Number.isFinite(video.duration) && video.duration > 0.05) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          video.removeEventListener('seeked', ready);
          video.removeEventListener('error', failed);
        };
        const ready = () => {
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(
            new Error('Could not decode a video preview. Try another video.'),
          );
        };
        const timeout = setTimeout(failed, 5000);
        video.addEventListener('seeked', ready);
        video.addEventListener('error', failed);
        video.currentTime = Math.min(0.1, video.duration / 2);
      });
    }
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
    if (video.currentTime > 0) video.currentTime = 0;
    // Uncropped, bounded videos (including our sample) can go straight to WebGL.
    // Larger/portrait uploads retain the bounded canvas path to preserve their crop.
    directVideoTexture =
      video.videoWidth === canvas.width && video.videoHeight === canvas.height;
    document.addEventListener('visibilitychange', syncPlayback);
    video.addEventListener('error', runtimeError);
    return {
      canvas,
      get textureSource() {
        // Until playback supplies a frame, use the stable poster even if the
        // browser refuses autoplay. Do not upload a paused/unpresented video.
        return directVideoTexture && hasPresentedFrame ? video : canvas;
      },
      kind: 'video',
      start(update, error, needsPlay) {
        onNeedsPlay = needsPlay ?? (() => {});
        onFrame = update;
        onError = error;
        started = true;
        if (failed) {
          onError(
            new Error('Video decoding stopped. Try selecting another video.'),
          );
          return;
        }
        syncPlayback();
      },
      resume() {
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
