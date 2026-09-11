'use client';
/* eslint-disable jsx-a11y/prefer-tag-over-role -- The custom GPU canvas has keyboard slider semantics. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus,
  History,
  Trash2,
  Upload,
  Shuffle,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { BlurCurve } from '@/projects/001-duo-expansion/BlurCurve';
import { DuoRenderer } from '@/projects/001-duo-expansion/renderer';
import {
  defaults,
  clamp,
  ease,
  ranges,
  type Settings,
} from '@/projects/001-duo-expansion/settings';
import {
  defaultPhoto,
  samplePhotos,
} from '@/projects/001-duo-expansion/samples';
import { decodeImage, decodeURL } from '@/projects/001-duo-expansion/media';
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
}: {
  label: string;
  value: number;
  min?: number;
  max: number;
  step?: number;
  format: (n: number) => string;
  onChange: (n: number) => void;
}) {
  return (
    <div className="range">
      <div className="range-label">
        <span>{label}</span>
        <output>{format(value)}</output>
      </div>
      <Slider
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
    if (!open || !image.current) return;
    const element = image.current;
    const url = URL.createObjectURL(photo.blob);
    element.src = url;
    return () => {
      element.src = photo.thumbnail;
      URL.revokeObjectURL(url);
    };
  }, [photo.blob, photo.thumbnail, open]);
  // eslint-disable-next-line nextjs/no-img-element
  return <img ref={image} src={photo.thumbnail} alt="" loading="lazy" />;
}

export default function Home() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const renderer = useRef<DuoRenderer | null>(null);
  const currentImage = useRef<HTMLCanvasElement | null>(null);
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
  } | null>(null);
  const [settings, setSettings] = useState<Settings>({ ...defaults });
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(1.2);
  const [error, setError] = useState('');
  const [renderError, setRenderError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(true);
  const [personalPhotos, setPersonalPhotos] = useState<LocalPhoto[]>([]);
  const [galleryOpen, setGalleryOpen] = useState(false);
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
      window.addEventListener('keydown', escape);
      return () => window.removeEventListener('keydown', escape);
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
    renderer.current?.setProgress(n);
    setProgress(n);
  }, []);
  const animate = (n: number) => {
    renderer.current?.animate(n, duration, () => {
      if (alive.current) setProgress(n);
    });
  };

  const cancelFade = useCallback(() => {
    ++mediaJob.current;
    cancelAnimationFrame(fadeFrame.current);
  }, []);

  useEffect(() => {
    alive.current = true;
    // Browser-local versions must hydrate after SSR; this is a one-time external-storage read.
    try {
      // eslint-disable-next-line react/react-compiler
      setArchive(parseArchive(localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
      setArchiveError(message(e));
    }
    try {
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
        if (currentImage.current) r.setImage(currentImage.current);
        setRenderError('');
      } catch (e) {
        renderer.current = null;
        console.error('Duo renderer initialization failed:', e);
        setRenderError(message(e));
      }
    };
    initialize();
    const observer = new ResizeObserver(([entry]) =>
      renderer.current?.resize(
        entry.contentRect.width,
        entry.contentRect.height,
      ),
    );
    observer.observe(el);
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
              'Your saved photos could not be loaded. Browser storage may be unavailable.',
            );
        }
        if (!alive.current || mediaJob.current !== job) return;
        imageFiles.current = photos.map(photoFile);
        setFileCount(photos.length);
        setPersonalPhotos(photos);
        const index = photos.length - 1;
        imageIndex.current = index;
        setSelectedSample(index >= 0 ? null : 0);
        const image =
          index >= 0
            ? await decodeImage(imageFiles.current[index])
            : await decodeURL(defaultPhoto.src);
        if (!alive.current || mediaJob.current !== job) return;
        currentImage.current = image;
        renderer.current?.setImage(image);
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
      observer.disconnect();
      r?.dispose();
      renderer.current = null;
      el.removeEventListener('webglcontextlost', lost);
      el.removeEventListener('webglcontextrestored', initialize);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cancelFade]);

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
  async function changeImage(source: File | string = defaultPhoto.src) {
    const job = ++mediaJob.current;
    setBusy(true);
    setError('');
    // Stop an older fade at its current value. The old image stays until decode succeeds.
    cancelAnimationFrame(fadeFrame.current);
    if (renderer.current) {
      renderer.current.white = 0;
      renderer.current.requestDraw();
    }
    try {
      const image =
        typeof source === 'string'
          ? await decodeURL(source)
          : await decodeImage(source);
      if (!alive.current || job !== mediaJob.current) return false;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        currentImage.current = image;
        renderer.current?.setImage(image);
        setBusy(false);
        return true;
      }
      return await new Promise<boolean>((resolve) => {
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
            currentImage.current = image;
            r?.setImage(image);
            swapped = true;
          }
          if (r) {
            r.white = t < 0.5 ? ease(t * 2) : 1 - ease((t - 0.5) * 2);
            r.requestDraw();
          }
          if (t < 1) fadeFrame.current = requestAnimationFrame(tick);
          else {
            setBusy(false);
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
          prepared.push(await preparePhoto(await decodeImage(file), file.name));
        } catch {
          skipped.push(file.name);
        }
      }
      if (!prepared.length)
        throw new Error(
          'No photos could be opened. Try JPEG, PNG, WebP, or AVIF images under 30 MB.',
        );
      try {
        await savePhotos(prepared);
      } catch {
        throw new Error(
          'Could not save these photos on this device. Browser storage may be full or unavailable. Your existing rotation is unchanged.',
        );
      }
      const photos = await readPhotos();
      if (!alive.current) return;
      imageFiles.current = photos.map(photoFile);
      setFileCount(photos.length);
      setPersonalPhotos(photos);
      setSelectedSample(null);
      const index = photos.findIndex((photo) => photo.id === prepared[0].id);
      imageIndex.current = index;
      await changeImage(imageFiles.current[index]);
      setStatus(
        `${prepared.length} ${prepared.length === 1 ? 'photo' : 'photos'} added to your rotation.`,
      );
      if (skipped.length)
        setError(
          `${skipped.length} ${skipped.length === 1 ? 'file could' : 'files could'} not be opened. The other photos were saved.`,
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
      imageFiles.current = photos.map(photoFile);
      setPersonalPhotos(photos);
      setFileCount(photos.length);
      if (!photos.length) {
        imageIndex.current = -1;
        setSelectedSample(0);
        setGalleryOpen(false);
        await changeImage(defaultPhoto.src);
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
    if (imageFiles.current.length === 0) {
      if (samplePhotos.length < 2) return;
      const next =
        ((selectedSample ?? 0) +
          1 +
          // eslint-disable-next-line react/react-compiler -- Random choice runs only in the shuffle click handler.
          Math.floor(Math.random() * (samplePhotos.length - 1))) %
        samplePhotos.length;
      await chooseSample(next);
      return;
    }
    const files = imageFiles.current;
    if (!files.length || busy) return;
    const next =
      (imageIndex.current +
        1 +
        // eslint-disable-next-line react/react-compiler -- Random choice runs only in the shuffle click handler.
        Math.floor(Math.random() * Math.max(1, files.length - 1))) %
      files.length;
    if (await changeImage(files[next])) {
      imageIndex.current = next;
      setSelectedSample(null);
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
          accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
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
              renderer.current.stop();
              pointer.current = {
                id: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                progress: renderer.current.progress,
                moved: false,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const p = pointer.current;
              if (!p || p.id !== e.pointerId) return;
              const dx = e.clientX - p.x;
              if (Math.hypot(dx, e.clientY - p.y) > 5) p.moved = true;
              if (p.moved && Math.abs(dx) > Math.abs(e.clientY - p.y))
                scrub(
                  clamp(
                    p.progress -
                      dx / Math.max(140, e.currentTarget.clientWidth * 0.55),
                  ),
                );
            }}
            onPointerUp={(e) => {
              const p = pointer.current;
              if (!p || p.id !== e.pointerId) return;
              pointer.current = null;
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
              if (!p.moved && window.innerWidth > window.innerHeight)
                animate((renderer.current?.progress ?? 0) >= 0.5 ? 0 : 1);
            }}
            onPointerCancel={() => {
              pointer.current = null;
            }}
          />
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
                Your photos <span>{fileCount}</span>
              </h2>
            </div>
            <div className="gallery-grid">
              {personalPhotos.map((photo, index) => (
                <div
                  className="gallery-card"
                  key={photo.id}
                  style={
                    {
                      '--card-delay': `${Math.min(index, 6) * 45}ms`,
                      '--card-tilt': `${((index % 3) - 1) * 3}deg`,
                    } as React.CSSProperties
                  }
                >
                  <button
                    className="gallery-pick"
                    disabled={busy}
                    aria-label={`Use ${photo.name}`}
                    onClick={() => void choosePersonalPhoto(index)}
                  >
                    <GalleryPhoto photo={photo} open={galleryOpen} />
                  </button>
                  <button
                    className="gallery-remove"
                    disabled={busy}
                    aria-label={`Remove ${photo.name}`}
                    title="Remove photo"
                    onClick={() => void removePhoto(photo.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
          <div className="demo-photo-tools">
            <button
              className="glass shuffle"
              aria-label="Shuffle images"
              title="Shuffle images"
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
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              <Upload size={18} /> {busy ? 'Opening…' : 'Add photos'}
            </button>
            {fileCount > 0 && (
              <button
                ref={galleryTrigger}
                className="personal-rotation"
                aria-label={`View ${fileCount} uploaded ${fileCount === 1 ? 'photo' : 'photos'}`}
                aria-expanded={galleryOpen}
                onClick={() =>
                  galleryOpen ? closeGallery() : setGalleryOpen(true)
                }
              >
                <span className="photo-stack" aria-hidden="true">
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
                  {fileCount} {fileCount === 1 ? 'Photo' : 'Photos'}
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
                  <label htmlFor="closed-image-alignment">
                    Closed image:{' '}
                    {settings.closedImageAligned === 1
                      ? 'Left aligned'
                      : 'Center aligned'}
                  </label>
                  <Switch
                    id="closed-image-alignment"
                    className="alignment-switch"
                    aria-label="Left-align closed image"
                    title={
                      settings.closedImageAligned === 1
                        ? 'Switch to center alignment'
                        : 'Switch to left alignment'
                    }
                    checked={settings.closedImageAligned === 1}
                    onCheckedChange={(checked) =>
                      applySettings({
                        ...settingsRef.current,
                        closedImageAligned: checked ? 1 : 0,
                      })
                    }
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
                max={80}
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
                max={60}
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
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={17} />
                {busy ? 'Opening image…' : 'Upload images'}
              </button>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => void chooseSample(0)}
              >
                Use sample photo
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
                    title={photo.label}
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
