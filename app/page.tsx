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
  const [busy, setBusy] = useState(false);
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
    void decodeURL(defaultPhoto.src)
      .then((image) => {
        if (!alive.current || mediaJob.current !== job) return;
        currentImage.current = image;
        renderer.current?.setImage(image);
      })
      .catch((e) => {
        if (alive.current && mediaJob.current === job) setError(message(e));
      });
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
              { type: 'number', minimum: min, maximum: max },
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
            value > range[1]
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
    if (!files.length || busy) return;
    if (await changeImage(files[0])) {
      setSelectedSample(null);
      imageFiles.current = files;
      imageIndex.current = 0;
      setFileCount(files.length);
      setStatus(
        files.length > 1
          ? `${files.length} images selected. Shuffle to switch.`
          : 'Image ready.',
      );
    }
  }
  async function chooseSample(index: number) {
    if (busy) return;
    if (await changeImage(samplePhotos[index].src)) {
      imageFiles.current = [];
      imageIndex.current = -1;
      setFileCount(0);
      setSelectedSample(index);
      setStatus(samplePhotos[index].label);
    }
  }
  async function shuffle() {
    if (busy) return;
    if (selectedSample !== null) {
      if (samplePhotos.length < 2) return;
      const next =
        (selectedSample +
          1 +
          Math.floor(Math.random() * (samplePhotos.length - 1))) %
        samplePhotos.length;
      await chooseSample(next);
      return;
    }
    const files = imageFiles.current;
    if (files.length < 2 || busy) return;
    const next =
      (imageIndex.current +
        1 +
        Math.floor(Math.random() * (files.length - 1))) %
      files.length;
    if (await changeImage(files[next])) imageIndex.current = next;
  }
  return (
    <Sheet
      open={panelOpen}
      onOpenChange={setPanelOpen}
      modal={false}
      disablePointerDismissal
    >
      <main className={`lab ${panelOpen ? 'panel-open' : ''}`}>
        <SheetTrigger
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
        <section
          className="demo"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void upload(Array.from(e.dataTransfer.files));
          }}
        >
          {/* The canvas is a keyboard-operable, continuously adjustable rendered surface. */}
          <canvas
            ref={canvas}
            tabIndex={0}
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
          {(selectedSample !== null
            ? samplePhotos.length > 1
            : fileCount > 1) && (
            <button
              className="glass shuffle"
              aria-label="Shuffle images"
              title="Shuffle images"
              disabled={busy}
              onClick={() => void shuffle()}
            >
              <Shuffle size={18} />
            </button>
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
            </div>
            <p className="hint">
              Drag to fold. Tap in landscape to open or close.
            </p>
            <div className="media-actions">
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
              <button
                className="glass upload"
                disabled={busy}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={17} />
                {busy ? 'Opening image…' : 'Upload landscape images'}
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
