'use client';
/* eslint-disable jsx-a11y/prefer-tag-over-role -- The custom GPU canvas has keyboard slider semantics. */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Plus,
  Play,
  History,
  Trash2,
  Upload,
  Shuffle,
  SlidersHorizontal,
  ArrowLeft,
  X,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { observeDeferredHeight } from '@/lib/observe-height';
import { createFoldHint } from '@/lib/fold-hint';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { BlurCurve } from '@/projects/001-duo-expansion/BlurCurve';
import {
  releaseTarget,
  nextRotationIndex,
} from '@/projects/001-duo-expansion/interaction';
import { DuoRenderer } from '@/projects/001-duo-expansion/renderer';
import {
  defaults,
  clamp,
  ease,
  ranges,
  type Settings,
} from '@/projects/001-duo-expansion/settings';
import {
  defaultSampleIndex,
  shuffleSampleIndices,
  shouldPreferStillSamples,
  samplePhotos,
} from '@/projects/001-duo-expansion/samples';
import {
  decodeMedia,
  isVideo,
  type DecodedMedia,
} from '@/projects/001-duo-expansion/media';
import {
  readPhotos,
  deletePhoto,
  savePhotos,
  preparePhoto,
  photoFile,
  type LocalPhoto,
} from '@/projects/001-duo-expansion/photo-library';
import {
  addVersion,
  emptyArchive,
  parseArchive,
  STORAGE_KEY,
  type Archive,
} from '@/projects/001-duo-expansion/versions';

type ModelContext = {
  registerTool: (
    tool: {
      name: string;
      description: string;
      inputSchema: object;
      annotations: object;
      execute: (input: unknown) => unknown;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

function Range({
  label,
  value,
  min = 0,
  max,
  step = 0.01,
  format,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  format: (n: number) => string;
  onChange: (n: number) => void;
  onCommit?: (n: number) => void;
}) {
  return (
    <div className="range">
      <div className="range-label">
        <span>{label}</span>
        <output>{format(value)}</output>
      </div>
      <Slider
        onValueCommitted={(value) =>
          onCommit?.(typeof value === 'number' ? value : value[0])
        }
        aria-label={label}
        aria-valuetext={format(value)}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      />
    </div>
  );
}
const percent = (n: number) => `${Math.round(n * 100)}%`;
const pixels = (n: number) => `${Math.round(n)} px`;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function GalleryPhoto({ photo, open }: { photo: LocalPhoto; open: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (
      !open ||
      !image.current ||
      isVideo({ type: photo.blob.type, name: photo.name })
    )
      return;
    const element = image.current;
    const url = URL.createObjectURL(photo.blob);
    element.src = url;
    return () => {
      element.src = photo.thumbnail;
      URL.revokeObjectURL(url);
    };
  }, [photo.blob, photo.thumbnail, open]);
  // eslint-disable-next-line nextjs/no-img-element
  return (
    <img
      ref={image}
      src={photo.poster ?? photo.thumbnail}
      alt=""
      loading="lazy"
    />
  );
}

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoTools = useRef<HTMLDivElement>(null);
  const renderer = useRef<DuoRenderer | null>(null);
  const foldHint = useRef<ReturnType<typeof createFoldHint> | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const currentImage = useRef<HTMLCanvasElement | null>(null);
  const currentMedia = useRef<DecodedMedia | null>(null);
  const preferStillSamples = useRef(false);
  const pendingMedia = useRef<DecodedMedia | null>(null);
  const finishFade = useRef<((success: boolean) => void) | null>(null);
  const mediaPaused = useRef(false);
  const settingsRef = useRef<Settings>({ ...defaults });
  const alive = useRef(true);
  const mediaJob = useRef(0);
  const fadeFrame = useRef(0);
  const imageFiles = useRef<File[]>([]);
  const uploadLock = useRef(false);
  const imageIndex = useRef(-1);
  const pointer = useRef<{
    id: number;
    x: number;
    y: number;
    progress: number;
    moved: boolean;
    lastProgress: number;
    lastTime: number;
    velocity: number;
    dragged: boolean;
  } | null>(null);
  const [settings, setSettings] = useState<Settings>({ ...defaults });
  const [progress, setProgress] = useState(0);
  const [preciseDragging, setPreciseDragging] = useState(false);
  const [duration, setDuration] = useState(1.2);
  const [error, setError] = useState('');
  const [videoNeedsPlay, setVideoNeedsPlay] = useState(false);
  const [renderError, setRenderError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(true);
  const [personalPhotos, setPersonalPhotos] = useState<LocalPhoto[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const galleryGrid = useRef<HTMLDivElement>(null);
  const previousPhotoRects = useRef<Map<string, DOMRect> | null>(null);
  const capturePhotoPositions = () => {
    previousPhotoRects.current = new Map(
      Array.from(
        galleryGrid.current?.querySelectorAll<HTMLElement>('[data-photo-id]') ??
          [],
      ).map((element) => [
        element.dataset.photoId!,
        element.getBoundingClientRect(),
      ]),
    );
  };
  useLayoutEffect(() => {
    const previous = previousPhotoRects.current;
    previousPhotoRects.current = null;
    if (
      !previous ||
      !galleryOpen ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const elements = Array.from(
      galleryGrid.current?.querySelectorAll<HTMLElement>('[data-photo-id]') ??
        [],
    );
    // Cancel old layout motion before measuring the new layout. The captured
    // rectangles contain the currently visible positions, so interrupted moves stay continuous.
    for (const element of elements)
      for (const animation of element.getAnimations()) animation.cancel();
    const next = elements.map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
    }));
    for (const { element, rect } of next) {
      const old = previous.get(element.dataset.photoId!);
      if (old) {
        const dx = old.left - rect.left,
          dy = old.top - rect.top;
        if (
          Math.abs(dx) + Math.abs(dy) > 0.5 ||
          Math.abs(old.width - rect.width) > 0.5
        ) {
          element.animate(
            [
              {
                transform: `translate(${dx}px, ${dy}px) scale(${old.width / rect.width}, ${old.height / rect.height})`,
              },
              { transform: 'none' },
            ],
            { duration: 380, easing: 'cubic-bezier(.22, 1, .36, 1)' },
          );
        }
      } else {
        element.querySelector('.gallery-card')?.animate(
          [
            { opacity: 0, transform: 'translateY(22px) scale(.9)' },
            { opacity: 1, transform: 'translateY(0) scale(1)' },
          ],
          { duration: 320, easing: 'cubic-bezier(.22, 1, .36, 1)' },
        );
      }
    }
  }, [personalPhotos, galleryOpen]);
  const galleryClose = useRef<HTMLButtonElement>(null);
  const galleryTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (galleryOpen) {
      renderer.current?.stop();
      galleryClose.current?.focus({ preventScroll: true });
      const escape = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          setGalleryOpen(false);
          galleryTrigger.current?.focus({ preventScroll: true });
        }
      };
      const dismissOutside = (event: MouseEvent) => {
        if (!(event.target instanceof Element)) return;
        // Photo actions stay inside the gallery. Its trigger handles its own toggle.
        if (event.target.closest('[data-photo-id], .personal-rotation')) return;
        setGalleryOpen(false);
        galleryTrigger.current?.focus({ preventScroll: true });
      };
      window.addEventListener('keydown', escape);
      window.addEventListener('click', dismissOutside);
      return () => {
        window.removeEventListener('keydown', escape);
        window.removeEventListener('click', dismissOutside);
      };
    }
  }, [galleryOpen]);
  const closeGallery = () => {
    setGalleryOpen(false);
    galleryTrigger.current?.focus({ preventScroll: true });
  };
  const [fileCount, setFileCount] = useState(0);
  const [selectedSample, setSelectedSample] = useState<number | null>(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [archive, setArchive] = useState<Archive>(emptyArchive);
  const [archiveError, setArchiveError] = useState('');

  const applySettings = useCallback((next: Settings) => {
    settingsRef.current = next;
    setSettings(next);
    setStatus('');
    if (renderer.current) {
      renderer.current.settings = next;
      renderer.current.requestDraw();
    }
  }, []);
  const scrub = useCallback((n: number) => {
    foldHint.current?.complete();
    renderer.current?.setProgress(n);
    setProgress(n);
  }, []);
  const settle = (velocity = 0) => {
    const r = renderer.current;
    if (!r) return;
    const target = releaseTarget(r.progress, velocity, preciseDragging);
    if (target !== null)
      r.settle(target, velocity, () => {
        if (alive.current) setProgress(target);
      });
  };
  const animate = (n: number) => {
    foldHint.current?.complete();
    renderer.current?.animate(n, duration, () => {
      if (alive.current) setProgress(n);
    });
  };

  const activateMedia = useCallback((media: DecodedMedia) => {
    currentMedia.current?.dispose();
    setVideoNeedsPlay(false);
    currentMedia.current = media;
    pendingMedia.current = null;
    currentImage.current = media.canvas;
    renderer.current?.setImage(media.textureSource);
    media.setPaused(mediaPaused.current);
    media.start(
      () => renderer.current?.setImage(media.textureSource),
      (error) => {
        if (alive.current && currentMedia.current === media)
          setError(error.message);
      },
      (needed) => {
        if (alive.current && currentMedia.current === media)
          setVideoNeedsPlay(needed);
      },
    );
  }, []);

  useEffect(() => {
    mediaPaused.current = galleryOpen || !!renderError;
    currentMedia.current?.setPaused(mediaPaused.current);
  }, [galleryOpen, renderError]);

  const cancelFade = useCallback(() => {
    ++mediaJob.current;
    cancelAnimationFrame(fadeFrame.current);
    finishFade.current?.(false);
    finishFade.current = null;
    pendingMedia.current?.dispose();
    pendingMedia.current = null;
  }, []);

  useEffect(() => {
    alive.current = true;
    preferStillSamples.current = shouldPreferStillSamples({
      userAgent: navigator.userAgent,
      coarsePointer: matchMedia('(pointer: coarse)').matches,
      shortEdge: Math.min(screen.width, screen.height),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      saveData: !!(
        navigator as Navigator & { connection?: { saveData?: boolean } }
      ).connection?.saveData,
    });
    // Browser-local versions must hydrate after SSR; this is a one-time external-storage read.
    try {
      // eslint-disable-next-line react/react-compiler
      setArchive(parseArchive(localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
      setArchiveError(message(e));
    }
    try {
      setPreciseDragging(
        localStorage.getItem('lab.duo.precise-dragging') === '1',
      );
      const saved = localStorage.getItem('weblab.duo.duration');
      if (saved && Number.isFinite(Number(saved)))
        setDuration(clamp(Number(saved), 0.25, 6));
    } catch {
      /* Preferences are optional when browser storage is unavailable. */
    }
    let r: DuoRenderer | null = null;
    const el = canvas.current!;
    const initialize = () => {
      try {
        r?.dispose();
        r = new DuoRenderer(el);
        renderer.current = r;
        // Fill newly introduced settings when Fast Refresh retains an older state.
        settingsRef.current = { ...defaults, ...settingsRef.current };
        setSettings(settingsRef.current);
        r.settings = settingsRef.current;
        r.resize(el.clientWidth, el.clientHeight);
        if (currentMedia.current)
          r.setImage(currentMedia.current.textureSource);
        else if (currentImage.current) r.setImage(currentImage.current);
        setRenderError('');
      } catch (e) {
        renderer.current = null;
        console.error('Duo renderer initialization failed:', e);
        setRenderError(message(e));
      }
    };
    initialize();
    const resizeDemo = (width: number, height: number) => {
      renderer.current?.resize(width, height);
      // Match the renderer's closed cover size and perspective projection.
      const phoneHeight = Math.max(
        1,
        0.98 * Math.min((width - 48) / 1.44, (height - 40) / 1.26),
      );
      const rightEdge = width / 2 + (phoneHeight * 0.36 * 3.5) / (3.5 - 0.026);
      el.parentElement?.style.setProperty('--hint-left', `${rightEdge + 12}px`);
      el.parentElement?.style.setProperty('--hint-top', `${height / 2}px`);
    };
    resizeDemo(el.clientWidth, el.clientHeight);
    const observer = new ResizeObserver(([entry]) =>
      resizeDemo(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(el);
    // Reserve the actual toolbar height, including wrapped rows on narrow screens.
    const stopObservingTools = photoTools.current
      ? observeDeferredHeight(photoTools.current, (height) => {
          el.style.setProperty('--photo-tools-height', `${height}px`);
        })
      : () => {};
    const job = ++mediaJob.current;
    setBusy(true);
    void (async () => {
      try {
        let photos: LocalPhoto[] = [];
        try {
          photos = await readPhotos();
        } catch {
          if (alive.current && mediaJob.current === job)
            setError(
              'Your saved media could not be loaded. Browser storage may be unavailable.',
            );
        }
        if (!alive.current || mediaJob.current !== job) return;
        imageFiles.current = photos.map(photoFile);
        setFileCount(photos.length);
        setPersonalPhotos(photos);
        const index = photos.length - 1;
        imageIndex.current = index;
        setSelectedSample(
          index >= 0 ? null : defaultSampleIndex(preferStillSamples.current),
        );
        let media: DecodedMedia;
        try {
          media = await decodeMedia(
            index >= 0
              ? imageFiles.current[index]
              : samplePhotos[defaultSampleIndex(preferStillSamples.current)]
                  .src,
          );
        } catch (error) {
          if (index >= 0) throw error;
          // A failed or unsupported sample video must not leave a blank first visit.
          media = await decodeMedia(samplePhotos[defaultSampleIndex(true)].src);
          if (alive.current && mediaJob.current === job)
            setSelectedSample(defaultSampleIndex(true));
        }
        if (!alive.current || mediaJob.current !== job) {
          media.dispose();
          return;
        }
        activateMedia(media);
      } catch (e) {
        if (alive.current && mediaJob.current === job) setError(message(e));
      } finally {
        if (alive.current && mediaJob.current === job) setBusy(false);
      }
    })();
    const visibility = () => {
      if (document.hidden) {
        r?.stop();
        if (r) setProgress(r.progress);
      } else r?.requestDraw();
    };
    const lost = (e: Event) => {
      e.preventDefault();
      r?.stop();
      renderer.current = null;
      setRenderError(
        'The graphics context was interrupted. Restoring the demo…',
      );
    };
    el.addEventListener('webglcontextlost', lost);
    el.addEventListener('webglcontextrestored', initialize);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      alive.current = false;
      cancelFade();
      currentMedia.current?.dispose();
      currentMedia.current = null;
      observer.disconnect();
      stopObservingTools();
      r?.dispose();
      renderer.current = null;
      el.removeEventListener('webglcontextlost', lost);
      el.removeEventListener('webglcontextrestored', initialize);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancelFade, activateMedia]);

  useEffect(() => {
    const hint = createFoldHint({
      show: setHintVisible,
      nudge: () => {
        const r = renderer.current;
        if (
          !r ||
          r.progress > 0.005 ||
          pointer.current ||
          matchMedia('(prefers-reduced-motion: reduce)').matches
        )
          return () => {};
        let running = true;
        r.animate(0.095, 0.85, () => {
          if (!running) return;
          r.animate(0, 1.05, () => {
            running = false;
          });
        });
        return () => {
          if (!running) return;
          running = false;
          r.stop();
          r.setProgress(0);
        };
      },
    });
    foldHint.current = hint;
    return () => {
      hint.destroy();
      foldHint.current = null;
    };
  }, []);
  useEffect(() => {
    const sync = () => {
      if (
        !busy &&
        !galleryOpen &&
        !panelOpen &&
        !renderError &&
        !document.hidden &&
        !pointer.current
      )
        foldHint.current?.resume();
      else foldHint.current?.pause();
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      foldHint.current?.pause();
    };
  }, [busy, galleryOpen, panelOpen, renderError]);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: 'configure_duo',
      description:
        'Set Duo expansion and shader parameters using the same controls as the editor. Does not change images or save versions.',
      inputSchema: {
        type: 'object',
        properties: {
          expansion: { type: 'number', minimum: 0, maximum: 1 },
          ...Object.fromEntries(
            Object.entries(ranges).map(([k, [min, max]]) => [
              k,
              {
                type: 'number',
                minimum: min,
                maximum: max,
                ...(k === 'closedImageAligned' ? { enum: [0, 1] } : {}),
              },
            ]),
          ),
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        if (!renderer.current)
          throw new Error('The shader renderer is not ready.');
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('Expected a parameter object.');
        const next = { ...settingsRef.current };
        for (const [key, value] of Object.entries(input)) {
          const range =
            key === 'expansion' ? [0, 1] : ranges[key as keyof Settings];
          if (
            !range ||
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < range[0] ||
            value > range[1] ||
            (key === 'closedImageAligned' && value !== 0 && value !== 1)
          )
            throw new Error(`Invalid parameter: ${key}`);
          if (key !== 'expansion') next[key as keyof Settings] = value;
        }
        applySettings(next);
        if ('expansion' in input)
          scrub((input as { expansion: number }).expansion);
        return new Promise((resolve) =>
          requestAnimationFrame(() =>
            resolve({
              expansion: renderer.current?.progress,
              settings: settingsRef.current,
            }),
          ),
        );
      },
    };
    try {
      void Promise.resolve(
        context.registerTool(
          {
            name: 'read_duo_versions',
            description:
              'Read this browser’s locally saved Duo shader versions and current settings. Does not modify or upload images.',
            inputSchema: {
              type: 'object',
              properties: {},
              additionalProperties: false,
            },
            annotations: { readOnlyHint: true, untrustedContentHint: false },
            execute() {
              return {
                archive: parseArchive(localStorage.getItem(STORAGE_KEY)),
                settings: settingsRef.current,
              };
            },
          },
          { signal: lifecycle.signal },
        ),
      ).catch(() => {});
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Optional browser capability. */
    }
    return () => lifecycle.abort();
  }, [applySettings, scrub]);

  function updateArchive(next: Archive, text: string) {
    if (archiveError) {
      setError(archiveError);
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setArchive(next);
      setStatus(text);
      setError('');
    } catch {
      setError(
        'Could not save versions. Browser storage may be full or unavailable.',
      );
    }
  }
  async function changeImage(
    source: File | string = samplePhotos[
      defaultSampleIndex(preferStillSamples.current)
    ].src,
  ) {
    cancelFade();
    const job = mediaJob.current;
    setBusy(true);
    setError('');
    // Stop an older fade at its current value. The old image stays until decode succeeds.
    cancelAnimationFrame(fadeFrame.current);
    if (renderer.current) {
      renderer.current.white = 0;
      renderer.current.requestDraw();
    }
    try {
      const media = await decodeMedia(source);
      if (!alive.current || job !== mediaJob.current) {
        media.dispose();
        return false;
      }
      pendingMedia.current = media;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        activateMedia(media);
        setBusy(false);
        return true;
      }
      return await new Promise<boolean>((resolve) => {
        finishFade.current = resolve;
        const start = performance.now();
        let swapped = false;
        const tick = (now: number) => {
          if (!alive.current || job !== mediaJob.current) {
            resolve(false);
            return;
          }
          const t = clamp((now - start) / 480);
          const r = renderer.current;
          if (t >= 0.5 && !swapped) {
            activateMedia(media);
            swapped = true;
          }
          if (r) {
            r.white = t < 0.5 ? ease(t * 2) : 1 - ease((t - 0.5) * 2);
            r.requestDraw();
          }
          if (t < 1) fadeFrame.current = requestAnimationFrame(tick);
          else {
            setBusy(false);
            finishFade.current = null;
            resolve(true);
          }
        };
        fadeFrame.current = requestAnimationFrame(tick);
      });
    } catch (e) {
      if (alive.current && job === mediaJob.current) {
        setError(message(e));
        setBusy(false);
      }
      return false;
    }
  }
  async function upload(files: File[]) {
    if (!files.length || busy || uploadLock.current) return;
    uploadLock.current = true;
    setBusy(true);
    setError('');
    const prepared: LocalPhoto[] = [];
    const skipped: string[] = [];
    try {
      for (const file of files) {
        try {
          const media = await decodeMedia(file);
          try {
            prepared.push(
              await preparePhoto(
                media.canvas,
                file.name,
                media.kind === 'video' ? file : undefined,
              ),
            );
          } finally {
            media.dispose();
          }
        } catch {
          skipped.push(file.name);
        }
      }
      if (!prepared.length)
        throw new Error(
          'No files could be opened. Choose images under 30 MB or browser-playable videos under 100 MB (MP4 or WebM recommended).',
        );
      try {
        await savePhotos(prepared);
      } catch {
        throw new Error(
          'Could not save these files on this device. Browser storage may be full or unavailable. Your existing rotation is unchanged.',
        );
      }
      const photos = await readPhotos();
      if (!alive.current) return;
      imageFiles.current = photos.map(photoFile);
      setFileCount(photos.length);
      capturePhotoPositions();
      setPersonalPhotos(photos);
      setSelectedSample(null);
      const index = photos.findIndex((photo) => photo.id === prepared[0].id);
      imageIndex.current = index;
      await changeImage(imageFiles.current[index]);
      setStatus(
        `${prepared.length} ${prepared.length === 1 ? 'item' : 'items'} added to your rotation.`,
      );
      if (skipped.length)
        setError(
          `${skipped.length} ${skipped.length === 1 ? 'file could' : 'files could'} not be opened. The other files were saved.`,
        );
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      uploadLock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function removePhoto(id: string) {
    if (busy || uploadLock.current) return;
    uploadLock.current = true;
    setBusy(true);
    setError('');
    const activeId = personalPhotos[imageIndex.current]?.id;
    try {
      await deletePhoto(id);
      const photos = await readPhotos();
      if (!alive.current) return;
      const slot = Array.from(
        galleryGrid.current?.querySelectorAll<HTMLElement>('[data-photo-id]') ??
          [],
      ).find((element) => element.dataset.photoId === id);
      const card = slot?.querySelector<HTMLElement>('.gallery-card');
      if (card && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await card
          .animate(
            [
              {
                opacity: getComputedStyle(card).opacity,
                transform: getComputedStyle(card).transform,
              },
              { opacity: 0, transform: 'translateY(10px) scale(.86)' },
            ],
            {
              duration: 200,
              easing: 'cubic-bezier(.4, 0, 1, 1)',
              fill: 'forwards',
            },
          )
          .finished.catch(() => {});
      }
      if (!alive.current) return;
      imageFiles.current = photos.map(photoFile);
      capturePhotoPositions();
      setPersonalPhotos(photos);
      setFileCount(photos.length);
      if (!photos.length) {
        imageIndex.current = -1;
        setSelectedSample(defaultSampleIndex(preferStillSamples.current));
        setGalleryOpen(false);
        await changeImage(
          samplePhotos[defaultSampleIndex(preferStillSamples.current)].src,
        );
      } else if (selectedSample === null && activeId === id) {
        imageIndex.current = 0;
        await changeImage(imageFiles.current[0]);
      } else {
        imageIndex.current = photos.findIndex((photo) => photo.id === activeId);
      }
    } catch {
      if (alive.current)
        setError(
          'Could not remove this photo from browser storage. Please try again.',
        );
    } finally {
      uploadLock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function choosePersonalPhoto(index: number) {
    if (busy) return;
    if (await changeImage(imageFiles.current[index])) {
      imageIndex.current = index;
      setSelectedSample(null);
      closeGallery();
    }
  }
  async function chooseSample(index: number) {
    if (busy) return;
    if (await changeImage(samplePhotos[index].src)) {
      imageIndex.current = -1;
      setSelectedSample(index);
      setStatus(samplePhotos[index].label);
    }
  }
  async function shuffle() {
    if (busy) return;
    const files = imageFiles.current;
    const indices = files.length
      ? files.map((_, index) => index)
      : shuffleSampleIndices(preferStillSamples.current);
    // eslint-disable-next-line react/react-compiler -- Runs only in the shuffle click handler.
    const random = indices.length > 4 ? Math.random() : 0;
    const next = nextRotationIndex(
      files.length ? imageIndex.current : (selectedSample ?? -1),
      indices,
      random,
    );
    if (next === null) return;
    if (!files.length) {
      await chooseSample(next);
      return;
    }
    if (await changeImage(files[next])) {
      imageIndex.current = next;
      setSelectedSample(null);
      setStatus(files[next].name);
    }
  }

  return (
    <Sheet
      open={panelOpen}
      onOpenChange={setPanelOpen}
      modal={false}
      disablePointerDismissal
    >
      <main
        className={`lab ${panelOpen ? 'panel-open' : ''} ${galleryOpen ? 'gallery-active' : ''}`}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v"
          multiple
          hidden
          onChange={(e) => {
            void upload(Array.from(e.target.files ?? []));
            e.target.value = '';
          }}
        />
        <SheetTrigger
          tabIndex={galleryOpen ? -1 : 0}
          aria-hidden={galleryOpen}
          render={
            <button
              className="glass icon modify"
              aria-label="Modify"
              title="Modify"
            />
          }
        >
          <SlidersHorizontal size={19} />
        </SheetTrigger>
        <button
          ref={galleryClose}
          className="glass icon gallery-dismiss"
          aria-label="Close photo gallery"
          aria-hidden={!galleryOpen}
          tabIndex={galleryOpen ? 0 : -1}
          onClick={closeGallery}
        >
          <X size={19} />
        </button>
        <section
          className={`demo ${galleryOpen ? 'gallery-open' : ''}`}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          {/* The canvas is a keyboard-operable, continuously adjustable rendered surface. */}
          <canvas
            ref={canvas}
            tabIndex={galleryOpen ? -1 : 0}
            aria-hidden={galleryOpen}
            role="slider"
            aria-label="Duo expansion. Drag left to open, right to close. In landscape, tap to animate."
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            onKeyDown={(e) => {
              if (
                ['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(e.key)
              ) {
                e.preventDefault();
                const p = renderer.current?.progress ?? progress;
                if (e.key === ' ') animate(p >= 0.5 ? 0 : 1);
                else
                  scrub(
                    e.key === 'Home'
                      ? 0
                      : e.key === 'End'
                        ? 1
                        : clamp(p + (e.key === 'ArrowRight' ? 0.025 : -0.025)),
                  );
              }
            }}
            onPointerDown={(e) => {
              if (!renderer.current || e.button !== 0) return;
              foldHint.current?.pause();
              renderer.current.stop();
              pointer.current = {
                id: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                progress: renderer.current.progress,
                moved: false,
                dragged: false,
                lastProgress: renderer.current.progress,
                lastTime: e.timeStamp,
                velocity: 0,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const p = pointer.current;
              if (!p || p.id !== e.pointerId) return;
              const dx = e.clientX - p.x;
              if (Math.hypot(dx, e.clientY - p.y) > 5) p.moved = true;
              if (p.moved && Math.abs(dx) > Math.abs(e.clientY - p.y)) {
                const next = clamp(
                  p.progress -
                    dx / Math.max(140, e.currentTarget.clientWidth * 0.55),
                );
                const elapsed = e.timeStamp - p.lastTime;
                if (elapsed > 0)
                  p.velocity = (next - p.lastProgress) / (elapsed / 1000);
                p.lastProgress = next;
                p.lastTime = e.timeStamp;
                p.dragged = true;
                scrub(next);
              }
            }}
            onPointerUp={(e) => {
              const p = pointer.current;
              if (!p || p.id !== e.pointerId) return;
              pointer.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
              if (!p.moved && window.innerWidth > window.innerHeight)
                animate((renderer.current?.progress ?? 0) >= 0.5 ? 0 : 1);
              else {
                if (p.dragged)
                  settle(e.timeStamp - p.lastTime < 100 ? p.velocity : 0);
                if (!busy && !galleryOpen && !panelOpen)
                  foldHint.current?.resume();
              }
            }}
            onPointerCancel={() => {
              pointer.current = null;
              if (!busy && !galleryOpen && !panelOpen)
                foldHint.current?.resume();
            }}
          />
          <div
            className={`fold-hint ${hintVisible ? 'visible' : ''}`}
            aria-hidden={!hintVisible}
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Drag left to expand</span>
          </div>
          {renderError && (
            <p role="alert" className="error">
              {renderError}
            </p>
          )}
          <section
            className="personal-gallery"
            aria-labelledby="personal-gallery-title"
            aria-hidden={!galleryOpen}
            inert={!galleryOpen}
          >
            <div className="gallery-heading">
              <h2 id="personal-gallery-title">
                Your collection <span>{fileCount}</span>
              </h2>
            </div>
            <div ref={galleryGrid} className="gallery-grid">
              {personalPhotos.map((photo, index) => (
                <div
                  className="gallery-slot"
                  key={photo.id}
                  data-photo-id={photo.id}
                >
                  <div
                    className="gallery-card"
                    style={
                      {
                        '--card-delay': `${Math.min(index, 6) * 45}ms`,
                      } as React.CSSProperties
                    }
                  >
                    <div className="gallery-surface">
                      <button
                        className="gallery-pick"
                        disabled={busy}
                        aria-label={`Use ${photo.name}`}
                        onClick={() => void choosePersonalPhoto(index)}
                      >
                        <GalleryPhoto photo={photo} open={galleryOpen} />
                        {isVideo({
                          type: photo.blob.type,
                          name: photo.name,
                        }) && (
                          <span className="video-badge">
                            <Play size={14} fill="currentColor" /> Video
                          </span>
                        )}
                      </button>
                    </div>
                    <button
                      className="glass gallery-remove"
                      disabled={busy}
                      aria-label={`Remove ${photo.name}`}
                      title="Remove photo"
                      onClick={() => void removePhoto(photo.id)}
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <div ref={photoTools} className="demo-photo-tools">
            {videoNeedsPlay && !galleryOpen && (
              <button
                className="glass video-play"
                disabled={busy}
                onClick={() => currentMedia.current?.resume()}
              >
                <Play size={17} fill="currentColor" /> Play video
              </button>
            )}
            <button
              className="glass shuffle"
              aria-label="Shuffle media"
              title="Shuffle media"
              disabled={
                busy ||
                galleryOpen ||
                (fileCount === 1 && selectedSample === null)
              }
              onClick={() => void shuffle()}
            >
              <Shuffle size={18} />
            </button>
            <button
              className="glass photo-upload"
              aria-busy={busy}
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={18} /> Add media
            </button>
            {fileCount > 0 && (
              <button
                ref={galleryTrigger}
                className="personal-rotation"
                aria-label={`View ${fileCount} uploaded items`}
                aria-expanded={galleryOpen}
                onClick={() =>
                  galleryOpen ? closeGallery() : setGalleryOpen(true)
                }
              >
                <span
                  className="photo-stack"
                  aria-hidden="true"
                  style={
                    {
                      '--stack-count': Math.min(personalPhotos.length, 3),
                    } as React.CSSProperties
                  }
                >
                  {personalPhotos.slice(-3).map((photo, index) => (
                    // eslint-disable-next-line nextjs/no-img-element
                    <img
                      key={photo.id}
                      src={photo.thumbnail}
                      alt=""
                      style={
                        {
                          '--photo-index': index,
                          '--photo-count': Math.min(personalPhotos.length, 3),
                        } as React.CSSProperties
                      }
                    />
                  ))}
                </span>
                <span>
                  {fileCount}{' '}
                  {personalPhotos.some((p) =>
                    isVideo({ type: p.blob.type, name: p.name }),
                  )
                    ? fileCount === 1
                      ? 'Item'
                      : 'Items'
                    : fileCount === 1
                      ? 'Photo'
                      : 'Photos'}
                </span>
              </button>
            )}
          </div>
          {error && (
            <p className="photo-notice" role="alert">
              {error}
            </p>
          )}
        </section>
        <SheetContent className="controls" side="right" showCloseButton={false}>
          <SheetTitle className="sr-only">Modify shader</SheetTitle>
          <div className="control-inner">
            <div className="toolbar">
              <div className="version-actions">
                <button
                  className="glass icon"
                  aria-label="Save version"
                  title="Save version"
                  disabled={!!archiveError}
                  onClick={() =>
                    updateArchive(
                      addVersion(
                        archive,
                        settingsRef.current,
                        crypto.randomUUID(),
                        new Date().toISOString(),
                      ),
                      `Saved Version ${archive.nextNumber}`,
                    )
                  }
                >
                  <Plus size={19} />
                </button>
                <button
                  className={`glass icon ${historyOpen ? 'selected' : ''}`}
                  aria-label="Saved versions"
                  title="Saved versions"
                  aria-expanded={historyOpen}
                  onClick={() => setHistoryOpen(!historyOpen)}
                >
                  <History size={18} />
                </button>
              </div>
              <SheetClose
                render={
                  <button
                    className="glass icon"
                    aria-label="Close controls"
                    title="Close controls"
                  />
                }
              >
                <X size={18} />
              </SheetClose>
            </div>
            {(status || error || archiveError) && (
              <p
                className={`status ${error || archiveError ? 'failure' : ''}`}
                role={error || archiveError ? 'alert' : 'status'}
              >
                {error || archiveError || status}
              </p>
            )}
            {historyOpen && (
              <div className="versions">
                {!archive.versions.length && (
                  <p className="hint">No saved versions yet.</p>
                )}
                {archive.versions.map((v) => (
                  <div className="version" key={v.id}>
                    <div className="version-info">
                      <input
                        aria-label={`Name for ${v.name}`}
                        defaultValue={v.name}
                        maxLength={80}
                        onBlur={(e) => {
                          const name = e.target.value.trim();
                          if (!name) {
                            e.target.value = v.name;
                            return;
                          }
                          if (name !== v.name)
                            updateArchive(
                              {
                                ...archive,
                                versions: archive.versions.map((row) =>
                                  row.id === v.id ? { ...row, name } : row,
                                ),
                              },
                              'Version renamed.',
                            );
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                      <time dateTime={v.savedAt}>
                        {new Date(v.savedAt).toLocaleString(undefined, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </div>
                    <button
                      className="glass"
                      onClick={() => {
                        applySettings({ ...v.settings });
                        setStatus(`Restored ${v.name}`);
                      }}
                    >
                      Restore
                    </button>
                    <button
                      className="delete"
                      aria-label={`Delete ${v.name}`}
                      onClick={() =>
                        updateArchive(
                          {
                            ...archive,
                            versions: archive.versions.filter(
                              (row) => row.id !== v.id,
                            ),
                          },
                          `Deleted ${v.name}`,
                        )
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                <p className="hint">
                  Saved on this browser. Click a name to edit it.
                </p>
              </div>
            )}
            <div className="pose">
              <Range
                onCommit={() => settle()}
                label="Expansion"
                value={progress}
                max={1}
                step={0.001}
                format={percent}
                onChange={scrub}
              />
              <div className="presets">
                {[
                  ['Closed', 0],
                  ['Front', 0.25],
                  ['Inside', 0.75],
                  ['Open', 1],
                ].map(([name, n]) => (
                  <button
                    className="glass"
                    key={name}
                    onClick={() => animate(Number(n))}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            <div className="parameter-grid">
              <div className="range alignment-control">
                <div className="range-label">
                  <label htmlFor="precise-dragging">Precise dragging</label>
                  <Switch
                    id="precise-dragging"
                    className="alignment-switch"
                    checked={preciseDragging}
                    title="Stop exactly where you release, without snapping open or closed"
                    onCheckedChange={(checked) => {
                      setPreciseDragging(checked);
                      if (checked) {
                        renderer.current?.stop();
                        setProgress(renderer.current?.progress ?? progress);
                      }
                      try {
                        localStorage.setItem(
                          'lab.duo.precise-dragging',
                          checked ? '1' : '0',
                        );
                      } catch {
                        /* Session preference still applies. */
                      }
                    }}
                  />
                </div>
              </div>
              <Range
                label="Animation duration"
                value={duration}
                min={0.25}
                max={6}
                step={0.05}
                format={(n) => `${n.toFixed(2)} s`}
                onChange={(n) => {
                  setDuration(n);
                  try {
                    localStorage.setItem('weblab.duo.duration', String(n));
                  } catch {
                    /* Optional preference. */
                  }
                }}
              />
              <Range
                label="Progressive blur"
                value={settings.blurRadius}
                max={ranges.blurRadius[1]}
                step={1}
                format={pixels}
                onChange={(n) =>
                  applySettings({ ...settingsRef.current, blurRadius: n })
                }
              />
              <BlurCurve
                settings={settings}
                onChange={(patch) =>
                  applySettings({ ...settingsRef.current, ...patch })
                }
              />
              <Range
                label="Diagonal blur"
                value={settings.diagonalBlurRadius}
                max={ranges.diagonalBlurRadius[1]}
                step={1}
                format={pixels}
                onChange={(n) =>
                  applySettings({
                    ...settingsRef.current,
                    diagonalBlurRadius: n,
                  })
                }
              />
              <Range
                label="Crease blend width"
                value={settings.creaseBlendWidth}
                max={1}
                format={percent}
                onChange={(n) =>
                  applySettings({ ...settingsRef.current, creaseBlendWidth: n })
                }
              />
              <Range
                label="Blur easing"
                value={settings.creaseBlurEasing}
                min={1}
                max={4}
                step={0.1}
                format={(n) => n.toFixed(1)}
                onChange={(n) =>
                  applySettings({ ...settingsRef.current, creaseBlurEasing: n })
                }
              />
              <Range
                label="Edge darkening"
                value={settings.edgeDarkness}
                max={1}
                format={percent}
                onChange={(n) =>
                  applySettings({ ...settingsRef.current, edgeDarkness: n })
                }
              />
              <Range
                label="Right screen darkness"
                value={settings.rightScreenDarkness}
                max={1}
                format={percent}
                onChange={(n) =>
                  applySettings({
                    ...settingsRef.current,
                    rightScreenDarkness: n,
                  })
                }
              />
            </div>
            <p className="hint">
              Drag to fold. Tap in landscape to open or close.
            </p>
            <div className="media-actions">
              <button
                className="glass upload"
                aria-busy={busy}
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={17} />
                Upload media
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void chooseSample(
                    defaultSampleIndex(preferStillSamples.current),
                  )
                }
              >
                Use default sample
              </button>
            </div>
            <section
              className="sample-collection"
              aria-labelledby="italy-photos-title"
            >
              <h2 id="italy-photos-title">Italy</h2>
              <div className="sample-grid">
                {samplePhotos.map((photo, index) => (
                  <button
                    key={photo.id}
                    className="sample-photo"
                    disabled={busy}
                    aria-label={`Try ${photo.label}`}
                    aria-pressed={selectedSample === index}
                    title={
                      photo.kind === 'video' ? 'Play sample video' : photo.label
                    }
                    onClick={() => void chooseSample(index)}
                  >
                    {/* These are pre-sized static thumbnails; no image server is needed. */}
                    {/* eslint-disable-next-line nextjs/no-img-element */}
                    <img
                      src={photo.thumbnail}
                      alt=""
                      width={360}
                      height={240}
                      loading="lazy"
                    />
                    {photo.kind === 'video' && (
                      <span className="sample-video-badge">
                        <Play size={15} fill="currentColor" />
                        <span className="sr-only">Video</span>
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
            <div className="footer">
              <span className="hint">Your uploads stay on your device.</span>
            </div>
          </div>
        </SheetContent>
      </main>
    </Sheet>
  );
}
