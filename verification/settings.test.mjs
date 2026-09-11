import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'weblab-test-'));
for (const file of [
  'settings',
  'versions',
  'renderer',
  'media',
  'interaction',
  'samples',
  'photo-library',
]) {
  let source = await readFile(
    new URL(`../projects/001-duo-expansion/${file}.ts`, import.meta.url),
    'utf8',
  );
  if (file === 'renderer')
    source = source.replace(
      "import fragment from './duo.frag?raw';",
      "const fragment = '';",
    );
  const output = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace("'./settings'", "'./settings.mjs'")
    .replace("'./interaction'", "'./interaction.mjs'");
  await writeFile(join(dir, `${file}.mjs`), output);
}
const heightSource = await readFile(
  new URL('../lib/observe-height.ts', import.meta.url),
  'utf8',
);
await writeFile(
  join(dir, 'observe-height.mjs'),
  ts.transpileModule(heightSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText,
);
const { observeDeferredHeight } = await import(
  pathToFileURL(join(dir, 'observe-height.mjs'))
);
const hintSource = await readFile(
  new URL('../lib/fold-hint.ts', import.meta.url),
  'utf8',
);
await writeFile(
  join(dir, 'fold-hint.mjs'),
  ts.transpileModule(hintSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  }).outputText,
);
const { createFoldHint } = await import(
  pathToFileURL(join(dir, 'fold-hint.mjs'))
);
const { defaults, validSettings, ease, blurCurve, blurCurveTable } =
  await import(pathToFileURL(join(dir, 'settings.mjs')));
const { addVersion, parseArchive, emptyArchive } = await import(
  pathToFileURL(join(dir, 'versions.mjs'))
);
const { DuoRenderer } = await import(pathToFileURL(join(dir, 'renderer.mjs')));
const { decodeURL } = await import(pathToFileURL(join(dir, 'media.mjs')));
const { readPhotos, savePhotos, deletePhoto, photoFile } = await import(
  pathToFileURL(join(dir, 'photo-library.mjs'))
);
const { releaseTarget, settledProgress, nextRotationIndex } = await import(
  pathToFileURL(join(dir, 'interaction.mjs'))
);
const { decodeMedia, isVideo, videoCrop } = await import(
  pathToFileURL(join(dir, 'media.mjs'))
);
const {
  samplePhotos,
  defaultPhoto,
  defaultSampleIndex,
  shuffleSampleIndices,
  shouldPreferStillSamples,
} = await import(pathToFileURL(join(dir, 'samples.mjs')));

await rm(dir, { recursive: true, force: true });
test('saved settings round-trip independently; deleting does not reuse version numbers', () => {
  const effect = { ...defaults };
  const first = addVersion(
    emptyArchive(),
    effect,
    'one',
    '2026-09-10T12:00:00Z',
  );
  effect.blurRadius = 0;
  assert.equal(first.versions[0].settings.blurRadius, defaults.blurRadius);
  const decoded = parseArchive(JSON.stringify(first));
  assert.deepEqual(decoded, first);
  decoded.versions = [];
  const second = addVersion(decoded, defaults, 'two', '2026-09-10T12:01:00Z');
  assert.equal(second.versions[0].name, 'Version 2');
});
test('corrupt, unknown, duplicated and out-of-range archives are rejected', () => {
  const first = addVersion(
    emptyArchive(),
    defaults,
    'one',
    '2026-09-10T12:00:00Z',
  );
  for (const bad of [
    '{',
    JSON.stringify({ ...first, schemaVersion: 2 }),
    JSON.stringify({
      ...first,
      versions: [...first.versions, ...first.versions],
    }),
    JSON.stringify({
      ...first,
      versions: [
        { ...first.versions[0], settings: { ...defaults, blurRadius: 999 } },
      ],
    }),
  ])
    assert.throws(() => parseArchive(bad));
  assert.equal(validSettings({ ...defaults, edgeDarkness: NaN }), false);
  assert.equal(validSettings({ ...defaults, creaseBlurEasing: 0 }), false);
});
test('fold easing has exact endpoints and remains monotonic', () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const value = ease(i / 1000);
    assert.ok(value >= previous && value <= 1);
    previous = value;
  }
});

test('retired reflection and blur-shift values cannot override the fixed treatment', () => {
  const old = addVersion(
    emptyArchive(),
    defaults,
    'old',
    '2026-09-10T12:00:00Z',
  );
  old.versions[0].settings.blurEndShift = 0.95;
  old.versions[0].settings.glassReflection = 0.9;
  const migrated = parseArchive(JSON.stringify(old));
  assert.equal('blurEndShift' in migrated.versions[0].settings, false);
  assert.equal('glassReflection' in migrated.versions[0].settings, false);
  assert.equal(migrated.versions[0].settings.blurRadius, defaults.blurRadius);
});

test('blur curves keep endpoints and never reverse, including extreme handles', () => {
  for (const a of [0, 1 / 3, 0.5, 1])
    for (const b of [0, 0.4, 2 / 3, 1]) {
      assert.equal(blurCurve(0, a, b), 0);
      assert.equal(blurCurve(1, a, b), 1);
      let previous = 0;
      for (let i = 0; i <= 1000; i++) {
        const value = blurCurve(i / 1000, a, b);
        assert.ok(value >= previous - 1e-12 && value <= 1);
        previous = value;
      }
    }
  assert.ok(
    blurCurve(0.5, defaults.blurCurveStart, defaults.blurCurveEnd) < 0.35,
  );
});
test('older versions migrate to neutral handles, custom handles round trip', () => {
  const old = addVersion(
    emptyArchive(),
    defaults,
    'old',
    '2026-09-10T12:00:00Z',
  );
  delete old.versions[0].settings.blurCurveStart;
  delete old.versions[0].settings.blurCurveEnd;
  const migrated = parseArchive(JSON.stringify(old)).versions[0].settings;
  assert.equal(migrated.blurCurveStart, 1 / 3);
  assert.equal(migrated.blurCurveEnd, 2 / 3);
  const custom = addVersion(
    emptyArchive(),
    { ...defaults, blurCurveStart: 0.8, blurCurveEnd: 0.1 },
    'new',
    '2026-09-10T12:00:00Z',
  );
  assert.deepEqual(parseArchive(JSON.stringify(custom)), custom);
});

test('canvas resize redraws before returning, skips unchanged buffer sizes and retains pose', () => {
  const original = Object.fromEntries(
    ['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
      (k) => [k, globalThis[k]],
    ),
  );
  const events = [];
  let next = 0;
  const pending = new Map();
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = { hidden: false };
  globalThis.requestAnimationFrame = (fn) => {
    pending.set(++next, fn);
    return next;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  const gl = new Proxy(
    {},
    {
      get: (_, key) => {
        if (key === 'drawArrays') return () => events.push('draw');
        if (key === 'getShaderParameter' || key === 'getProgramParameter')
          return () => true;
        if (key.startsWith('create') || key === 'getUniformLocation')
          return () => ({});
        if (key.toUpperCase() === key) return 0;
        return () => {};
      },
    },
  );
  let width = 1,
    height = 1;
  const canvas = {
    getContext: () => gl,
    get width() {
      return width;
    },
    set width(n) {
      width = n;
      events.push('clear');
    },
    get height() {
      return height;
    },
    set height(n) {
      height = n;
      events.push('clear');
    },
  };
  try {
    const renderer = new DuoRenderer(canvas);
    renderer.setProgress(0.64);
    renderer.resize(800, 600);
    assert.deepEqual(events, ['clear', 'clear', 'draw']);
    assert.equal(pending.size, 0);
    assert.equal(renderer.progress, 0.64);
    events.length = 0;
    renderer.resize(800, 600);
    assert.deepEqual(events, ['draw']);
    events.length = 0;
    renderer.resize(650, 600);
    assert.deepEqual(events, ['clear', 'draw']);
    assert.equal(renderer.progress, 0.64);
    renderer.dispose();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('new sessions start with the exact captured tuning and curve', () => {
  assert.deepEqual(defaults, {
    blurRadius: 60,
    diagonalBlurRadius: 47,
    creaseBlendWidth: 0,
    creaseBlurEasing: 3.1,
    edgeDarkness: 0.55,
    rightScreenDarkness: 0.44,
    closedImageAligned: 0,
    blurCurveStartX: 1,
    blurCurveEndX: 1,
    blurCurveStart: 0,
    blurCurveEnd: 0.4869037828947368,
  });
});

test('freely moving handles produce extreme curves with finite, monotonic lookup samples', () => {
  for (const startX of [0, 0.5, 1])
    for (const endX of [0, 0.5, 1])
      for (const start of [0, 1])
        for (const end of [0, 1]) {
          const table = blurCurveTable({
            ...defaults,
            blurCurveStartX: startX,
            blurCurveEndX: endX,
            blurCurveStart: start,
            blurCurveEnd: end,
          });
          assert.equal(table[0], 0);
          assert.equal(table.at(-1), 1);
          for (let i = 1; i < table.length; i++)
            assert.ok(
              Number.isFinite(table[i]) &&
                table[i] >= table[i - 1] &&
                table[i] <= 1,
            );
        }
  assert.ok(blurCurve(0.5, 0, 0, 1, 1) < 0.01);
  assert.ok(blurCurve(0.5, 1, 1, 0, 0) > 0.99);
});

test('existing vertical-only curves migrate without changing their profile; XY handles persist', () => {
  const old = addVersion(
    emptyArchive(),
    defaults,
    'old',
    '2026-09-10T12:00:00Z',
  );
  old.versions[0].settings.blurCurveStart = 0;
  old.versions[0].settings.blurCurveEnd = 0.4;
  delete old.versions[0].settings.blurCurveStartX;
  delete old.versions[0].settings.blurCurveEndX;
  const migrated = parseArchive(JSON.stringify(old)).versions[0].settings;
  assert.equal(migrated.blurCurveStartX, 1 / 3);
  assert.equal(migrated.blurCurveEndX, 2 / 3);
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    assert.ok(
      Math.abs(
        blurCurve(
          x,
          migrated.blurCurveStart,
          migrated.blurCurveEnd,
          migrated.blurCurveStartX,
          migrated.blurCurveEndX,
        ) -
          (1.2 * (1 - x) * x * x + x * x * x),
      ) < 1e-12,
    );
  }
  const custom = addVersion(
    emptyArchive(),
    { ...defaults, blurCurveStartX: 1, blurCurveEndX: 0 },
    'xy',
    '2026-09-10T12:00:00Z',
  );
  assert.deepEqual(parseArchive(JSON.stringify(custom)), custom);
});

test('right-screen darkness preserves legacy shading and saves independently', () => {
  const old = addVersion(
    emptyArchive(),
    { ...defaults, edgeDarkness: 0.8 },
    'old-right',
    '2026-09-11T00:00:00Z',
  );
  delete old.versions[0].settings.rightScreenDarkness;
  assert.equal(
    parseArchive(JSON.stringify(old)).versions[0].settings.rightScreenDarkness,
    0.2,
  );
  const custom = addVersion(
    emptyArchive(),
    { ...defaults, rightScreenDarkness: 0.37, edgeDarkness: 0 },
    'custom-right',
    '2026-09-11T00:00:00Z',
  );
  assert.deepEqual(parseArchive(JSON.stringify(custom)), custom);
  assert.equal(validSettings({ ...defaults, rightScreenDarkness: 1.1 }), false);
});

test('image decoding centers portrait/square crops and retains landscape framing', async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const fixtures = {
    portrait: [3000, 4000],
    square: [1500, 1500],
    landscape: [6000, 4000],
    invalid: [0, 0],
    oversized: [10000, 10000],
  };
  let draw;
  globalThis.Image = class {
    async decode() {
      [this.naturalWidth, this.naturalHeight] = fixtures[this.src];
    }
  };
  globalThis.document = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect() {},
        drawImage(...args) {
          draw = args.slice(1);
        },
      }),
    }),
  };
  try {
    const portrait = await decodeURL('portrait');
    assert.deepEqual([portrait.width, portrait.height], [2048, 1365]);
    assert.deepEqual(draw, [0, 1000, 3000, 2000, 0, 0, 2048, 1365]);
    const square = await decodeURL('square');
    assert.deepEqual([square.width, square.height], [1500, 1000]);
    assert.deepEqual(draw, [0, 250, 1500, 1000, 0, 0, 1500, 1000]);
    const landscape = await decodeURL('landscape');
    assert.deepEqual([landscape.width, landscape.height], [2048, 1365]);
    assert.deepEqual(draw, [0, 0, 6000, 4000, 0, 0, 2048, 1365]);
    await assert.rejects(decodeURL('invalid'), /no usable dimensions/);
    await assert.rejects(decodeURL('oversized'), /80 megapixels/);
  } finally {
    if (originalImage === undefined) delete globalThis.Image;
    else globalThis.Image = originalImage;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test('closed-image alignment persists and older versions remain centered', () => {
  const old = addVersion(
    emptyArchive(),
    defaults,
    'alignment',
    '2026-09-11T00:00:00Z',
  );
  delete old.versions[0].settings.closedImageAligned;
  assert.equal(
    parseArchive(JSON.stringify(old)).versions[0].settings.closedImageAligned,
    0,
  );
  const aligned = addVersion(
    emptyArchive(),
    { ...defaults, closedImageAligned: 1 },
    'aligned',
    '2026-09-11T00:00:00Z',
  );
  assert.deepEqual(parseArchive(JSON.stringify(aligned)), aligned);
  assert.equal(validSettings({ ...defaults, closedImageAligned: 0.5 }), false);
});

test('personal rotation persists blobs across connections and appends instead of replacing', async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    assert.deepEqual(await readPhotos(), []);
    const first = {
      id: 'first',
      name: 'my-photo.jpg',
      blob: new Blob(['photo-one'], { type: 'image/webp' }),
      thumbnail: 'data:image/webp;base64,one',
      addedAt: 1,
    };
    const second = {
      ...first,
      id: 'second',
      name: 'next.png',
      blob: new Blob(['photo-two'], { type: 'image/webp' }),
      addedAt: 2,
    };
    await savePhotos([first]);
    await savePhotos([second]);
    const restored = await readPhotos();
    assert.deepEqual(
      restored.map((p) => p.id),
      ['first', 'second'],
    );
    assert.equal(await restored[0].blob.text(), 'photo-one');
    assert.equal(await photoFile(restored[1]).text(), 'photo-two');
    assert.equal(photoFile(restored[1]).type, 'image/webp');
    assert.equal(restored[0].thumbnail, first.thumbnail);
    await savePhotos([]);
    assert.equal((await readPhotos()).length, 2);
    await deletePhoto('first');
    assert.deepEqual(
      (await readPhotos()).map((p) => p.id),
      ['second'],
    );
    await deletePhoto('missing');
    assert.equal((await readPhotos()).length, 1);
    await deletePhoto('second');
    assert.deepEqual(await readPhotos(), []);
  } finally {
    globalThis.indexedDB = previous;
  }
});

test('toolbar measurements defer layout writes, coalesce changes, and cancel on cleanup', () => {
  const original = {
    ResizeObserver: globalThis.ResizeObserver,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const frames = new Map();
  let callback,
    id = 0,
    disconnected = false;
  globalThis.ResizeObserver = class {
    constructor(fn) {
      callback = fn;
    }
    observe() {}
    disconnect() {
      disconnected = true;
    }
  };
  globalThis.requestAnimationFrame = (fn) => {
    frames.set(++id, fn);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => frames.delete(id);
  const writes = [];
  const notify = (height) => callback([{ contentRect: { height } }]);
  const flush = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((fn) => fn());
  };
  try {
    const stop = observeDeferredHeight({}, (height) => writes.push(height));
    notify(42);
    notify(88);
    assert.deepEqual(writes, [], 'no layout mutation inside observer delivery');
    assert.equal(frames.size, 1);
    flush();
    assert.deepEqual(
      writes,
      [88],
      'only the latest wrapped toolbar size is applied',
    );
    notify(88);
    assert.equal(frames.size, 0, 'unchanged size causes no extra frame');
    notify(44);
    notify(88);
    flush();
    assert.deepEqual(
      writes,
      [88],
      'returning to the applied height cancels stale work',
    );
    notify(44);
    stop();
    flush();
    notify(120);
    flush();
    assert.equal(disconnected, true);
    assert.deepEqual(
      writes,
      [88],
      'no writes after cleanup, including late notifications',
    );
  } finally {
    Object.assign(globalThis, original);
  }
});

test('fold guidance waits for idle, stops after interaction, and restarts on a fresh visit', () => {
  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    localStorage: globalThis.localStorage,
  };
  let clock = 0,
    id = 0,
    nudges = 0,
    cancelled = 0,
    writes = 0;
  const timers = new Map(),
    storage = new Map([['lab.fold-hint.completed', '1']]),
    visibility = [];
  const schedule = (fn, delay, repeat) => {
    timers.set(++id, { fn, at: clock + delay, repeat });
    return id;
  };
  globalThis.setTimeout = (fn, ms) => schedule(fn, ms, 0);
  globalThis.setInterval = (fn, ms) => schedule(fn, ms, ms);
  globalThis.clearTimeout = globalThis.clearInterval = (id) =>
    timers.delete(id);
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => {
      writes++;
      storage.set(key, value);
    },
  };
  const advance = (ms) => {
    const end = clock + ms;
    while (true) {
      const entry = [...timers]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [key, timer] = entry;
      clock = timer.at;
      if (timer.repeat) timer.at += timer.repeat;
      else timers.delete(key);
      timer.fn();
    }
    clock = end;
  };
  const options = {
    show: (visible) => visibility.push(visible),
    nudge: () => {
      nudges++;
      return () => cancelled++;
    },
  };
  try {
    const hint = createFoldHint(options);
    hint.resume();
    hint.resume();
    advance(2999);
    assert.deepEqual(visibility, []);
    advance(1);
    assert.deepEqual(visibility, [true]);
    advance(1000);
    assert.equal(nudges, 1);
    advance(4000);
    assert.equal(nudges, 2);
    hint.pause();
    assert.equal(cancelled, 2);
    assert.equal(visibility.at(-1), false);
    advance(12000);
    assert.equal(nudges, 2);
    hint.resume();
    advance(3000);
    assert.equal(visibility.at(-1), true);
    hint.complete();
    hint.complete();
    assert.equal(writes, 0, 'completion stays in memory for this visit');
    hint.resume();
    advance(12000);
    assert.equal(nudges, 2);
    hint.destroy();
    const nextVisit = createFoldHint(options);
    nextVisit.resume();
    advance(2999);
    assert.equal(visibility.at(-1), false);
    advance(1);
    assert.equal(visibility.at(-1), true);
    advance(1000);
    assert.equal(nudges, 3);
    nextVisit.complete();
    nextVisit.resume();
    advance(12000);
    assert.equal(nudges, 3);
    nextVisit.destroy();
    assert.equal(timers.size, 0);
  } finally {
    Object.assign(globalThis, original);
  }
});

test('sample collection starts with dog, then video, lake and friend', () => {
  assert.equal(defaultPhoto.id, 'p1001338');
  assert.equal(defaultPhoto.kind, 'image');
  assert.deepEqual(
    samplePhotos.map((p) => p.label),
    ['Dog', 'Italy video', 'Lake', 'Friend'],
  );
});

test('release physics attract nearby endpoints, respect momentum and allow precise poses', () => {
  assert.equal(releaseTarget(0.15, 0, false), 0);
  assert.equal(releaseTarget(0.85, 0, false), 1);
  assert.equal(releaseTarget(0.5, 0, false), null);
  assert.equal(
    releaseTarget(0.5, 100, false),
    null,
    'long flicks cannot skip across the whole fold',
  );
  assert.equal(releaseTarget(0.75, 0.5, false), 1);
  assert.equal(releaseTarget(0.25, -0.5, false), 0);
  for (const p of [0.01, 0.15, 0.5, 0.85, 0.99])
    assert.equal(releaseTarget(p, 1, true), null);
  for (const [from, to] of [
    [0.18, 0],
    [0.82, 1],
  ]) {
    let previous = from;
    for (let i = 0; i <= 85; i++) {
      const p = settledProgress(from, to, 0, i / 100);
      assert.ok(p >= 0 && p <= 1);
      assert.ok(Math.abs(p - to) <= Math.abs(previous - to));
      previous = p;
    }
    assert.equal(previous, to);
  }
});

test('video formats and portrait crops preserve the centered landscape window', () => {
  assert.equal(isVideo({ name: 'clip.MOV', type: '' }), true);
  assert.equal(isVideo({ name: 'clip', type: 'video/mp4' }), true);
  assert.equal(isVideo({ name: 'image.mp4', type: 'image/webp' }), false);
  assert.deepEqual(videoCrop(1080, 1920), {
    y: 600,
    cropHeight: 720,
    width: 1080,
    height: 720,
  });
  assert.deepEqual(videoCrop(3840, 2160), {
    y: 0,
    cropHeight: 2160,
    width: 1280,
    height: 720,
  });
});

test('video resource updates only new frames and pauses/releases its decoder and URL', async () => {
  const original = {
    document: globalThis.document,
    fetch: globalThis.fetch,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  const callbacks = new Map();
  const draws = [];
  let callbackId = 0,
    plays = 0,
    pauses = 0,
    updates = 0,
    revoked = 0;
  class FakeVideo extends EventTarget {
    videoWidth = 1080;
    videoHeight = 1920;
    readyState = 2;
    currentTime = 0;
    src = '';
    load() {
      if (this.src)
        queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')));
    }
    play() {
      plays++;
      return Promise.resolve();
    }
    pause() {
      pauses++;
    }
    removeAttribute() {
      this.src = '';
    }
    requestVideoFrameCallback(callback) {
      callbacks.set(++callbackId, callback);
      return callbackId;
    }
    cancelVideoFrameCallback(id) {
      callbacks.delete(id);
    }
  }
  const video = new FakeVideo();
  const doc = new EventTarget();
  doc.hidden = false;
  doc.createElement = (tag) =>
    tag === 'video'
      ? video
      : {
          width: 0,
          height: 0,
          getContext: () => ({ drawImage: (...args) => draws.push(args) }),
        };
  globalThis.document = doc;
  let fetches = 0;
  globalThis.fetch = async () => {
    fetches++;
    return new Response(new Blob(['sample-video'], { type: 'video/mp4' }));
  };
  URL.createObjectURL = () => 'blob:test-video';
  URL.revokeObjectURL = () => revoked++;
  try {
    const media = await decodeMedia(
      new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
    );
    assert.equal(video.muted, true);
    assert.equal(video.loop, true);
    assert.equal(video.playsInline, true);
    assert.deepEqual([media.canvas.width, media.canvas.height], [1080, 720]);
    assert.equal(
      media.textureSource,
      media.canvas,
      'portrait videos retain the bounded centered crop',
    );
    assert.deepEqual(draws[0].slice(1), [0, 600, 1080, 720, 0, 0, 1080, 720]);
    media.start(() => updates++, assert.fail);
    await Promise.resolve();
    const tick = (now, time, mediaTime = time) => {
      const [id, fn] = callbacks.entries().next().value;
      callbacks.delete(id);
      video.currentTime = time;
      fn(now, { mediaTime });
    };
    tick(0, 0);
    tick(40, 0.01, 0);
    tick(50, 0.033);
    tick(60, 0.066);
    tick(90, 0.099);
    assert.equal(updates, 3, 'duplicates and updates above 60fps are skipped');
    media.setPaused(true);
    assert.equal(callbacks.size, 0);
    media.setPaused(false);
    await Promise.resolve();
    assert.equal(callbacks.size, 1);
    doc.hidden = true;
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 0);
    doc.hidden = false;
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    assert.equal(callbacks.size, 1);
    assert.ok(plays >= 3);
    assert.ok(pauses >= 2);
    media.dispose();
    media.dispose();
    assert.equal(callbacks.size, 0);
    assert.equal(revoked, 1);
    assert.equal(video.src, '');
    video.videoWidth = 1280;
    video.videoHeight = 852;
    const remote = await decodeMedia('/photos/italy/p1001308.mp4?version=1');
    assert.equal(video.src, 'blob:test-video');
    assert.equal(remote.kind, 'video');
    assert.equal(
      remote.textureSource,
      video,
      'bounded landscape video goes directly to WebGL',
    );
    const posterDraws = draws.length;
    remote.start(() => updates++, assert.fail);
    await Promise.resolve();
    tick(150, 0.2);
    tick(190, 0.233);
    assert.equal(
      draws.length,
      posterDraws,
      'direct playback never copies live frames through the 2D canvas',
    );
    remote.dispose();
    assert.equal(
      revoked,
      2,
      'buffered sample URLs are released just like uploads',
    );
    const cached = await decodeMedia('/photos/italy/p1001308.mp4?version=1');
    assert.equal(
      fetches,
      1,
      'returning to the small sample reuses its compressed bytes',
    );
    cached.dispose();
    assert.equal(revoked, 3, 'each playback still owns and releases its URL');
    doc.dispatchEvent(new Event('visibilitychange'));
    assert.equal(callbacks.size, 0);
  } finally {
    globalThis.document = original.document;
    globalThis.fetch = original.fetch;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

test('video blobs and posters survive library round trips without changing image entries', async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = new IDBFactory();
  try {
    const video = {
      id: 'video',
      name: 'clip.mov',
      blob: new Blob(['original-video'], { type: 'video/quicktime' }),
      thumbnail: 'thumb',
      poster: 'poster',
      addedAt: 2,
    };
    const photo = {
      id: 'photo',
      name: 'old.jpg',
      blob: new Blob(['photo'], { type: 'image/webp' }),
      thumbnail: 'thumb',
      addedAt: 1,
    };
    await savePhotos([photo, video]);
    const restored = await readPhotos();
    assert.equal(restored[0].poster, undefined);
    assert.equal(restored[1].poster, 'poster');
    const file = photoFile(restored[1]);
    assert.equal(file.type, 'video/quicktime');
    assert.equal(await file.text(), 'original-video');
    await deletePhoto('video');
    assert.deepEqual(
      (await readPhotos()).map((p) => p.id),
      ['photo'],
    );
  } finally {
    globalThis.indexedDB = previous;
  }
});

test('unsupported video decoding cleans up its source and oversized videos allocate nothing', async () => {
  const original = {
    document: globalThis.document,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  let allocated = 0,
    revoked = 0;
  class BrokenVideo extends EventTarget {
    src = '';
    load() {
      if (this.src)
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
    }
    pause() {}
    removeAttribute() {
      this.src = '';
    }
  }
  const doc = new EventTarget();
  doc.createElement = () => new BrokenVideo();
  globalThis.document = doc;
  globalThis.cancelAnimationFrame = () => {};
  URL.createObjectURL = () => {
    allocated++;
    return 'blob:broken';
  };
  URL.revokeObjectURL = () => revoked++;
  try {
    const tooLarge = new File([], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(tooLarge, 'size', { value: 101 * 1024 * 1024 });
    await assert.rejects(decodeMedia(tooLarge), /100 MB/);
    assert.equal(allocated, 0);
    await assert.rejects(
      decodeMedia(new File(['bad'], 'bad.mp4', { type: 'video/mp4' })),
      /cannot be played/,
    );
    assert.equal(allocated, 1);
    assert.equal(revoked, 1);
  } finally {
    globalThis.document = original.document;
    globalThis.cancelAnimationFrame = original.cancelAnimationFrame;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

test('phones and motion/data preferences avoid automatic video loads and shuffle picks', () => {
  const desktop = {
    userAgent: 'Macintosh',
    coarsePointer: false,
    shortEdge: 900,
    reducedMotion: false,
    saveData: false,
  };
  assert.equal(shouldPreferStillSamples(desktop), false);
  for (const change of [
    { userAgent: 'iPhone' },
    { userAgent: 'Linux; Android 14; Mobile' },
    { coarsePointer: true, shortEdge: 390 },
    { reducedMotion: true },
    { saveData: true },
  ])
    assert.equal(shouldPreferStillSamples({ ...desktop, ...change }), true);
  assert.equal(defaultSampleIndex(false), 0);
  assert.equal(samplePhotos[defaultSampleIndex(true)].id, 'p1001338');
  assert.deepEqual(shuffleSampleIndices(false), [0, 1, 2, 3]);
  assert.deepEqual(shuffleSampleIndices(true), [0, 2, 3]);
  assert.ok(
    shuffleSampleIndices(true).every(
      (index) => samplePhotos[index].kind === 'image',
    ),
  );
});

test('small rotations advance in order and large rotations shuffle without repeats', () => {
  for (const count of [1, 2, 3, 4]) {
    const indices = Array.from({ length: count }, (_, i) => i);
    assert.equal(nextRotationIndex(-1, indices, 0.99), 0);
    for (let i = 0; i < count; i++)
      assert.equal(nextRotationIndex(i, indices, 0.99), (i + 1) % count);
  }
  assert.equal(nextRotationIndex(0, [0, 2, 3], 0), 2);
  assert.equal(nextRotationIndex(3, [0, 2, 3], 0), 0);
  assert.equal(nextRotationIndex(1, [0, 2, 3], 0), 0);
  assert.equal(nextRotationIndex(0, [], 0), null);
  for (const random of [0, 0.2, 0.5, 0.99])
    assert.notEqual(nextRotationIndex(2, [0, 1, 2, 3, 4], random), 2);
  assert.equal(nextRotationIndex(0, [0, 1, 2, 3, 4], 0.99), 4);
});

test('blocked playback resumes directly from a gesture and stale interruptions are ignored', async () => {
  const original = {
    document: globalThis.document,
    create: URL.createObjectURL,
    revoke: URL.revokeObjectURL,
  };
  let calls = 0,
    callbackId = 0;
  const frames = new Map(),
    pending = [],
    needed = [],
    errors = [];
  class Video extends EventTarget {
    src = '';
    videoWidth = 1280;
    videoHeight = 720;
    readyState = 2;
    currentTime = 0;
    mode = 'blocked';
    load() {
      if (this.src)
        queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')));
    }
    play() {
      calls++;
      if (this.mode === 'blocked')
        return Promise.reject(
          new DOMException('gesture required', 'NotAllowedError'),
        );
      if (this.mode === 'pending')
        return new Promise((resolve, reject) =>
          pending.push({ resolve, reject }),
        );
      return Promise.resolve();
    }
    pause() {}
    removeAttribute() {
      this.src = '';
    }
    requestVideoFrameCallback(fn) {
      frames.set(++callbackId, fn);
      return callbackId;
    }
    cancelVideoFrameCallback(id) {
      frames.delete(id);
    }
  }
  const video = new Video();
  const doc = new EventTarget();
  doc.hidden = false;
  doc.createElement = (tag) =>
    tag === 'video'
      ? video
      : { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
  globalThis.document = doc;
  URL.createObjectURL = () => 'blob:policy-test';
  URL.revokeObjectURL = () => {};
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };
  try {
    const media = await decodeMedia(
      new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
    );
    media.start(
      () => {},
      (e) => errors.push(e),
      (value) => needed.push(value),
    );
    await flush();
    assert.deepEqual(needed, [true]);
    assert.equal(errors.length, 0);
    video.mode = 'ok';
    const before = calls;
    media.resume();
    assert.equal(
      calls,
      before + 1,
      'play runs synchronously inside resume, preserving the click gesture',
    );
    await flush();
    assert.equal(needed.at(-1), false);
    assert.equal(frames.size, 1);
    media.setPaused(true);
    video.mode = 'pending';
    media.setPaused(false);
    media.setPaused(true);
    media.setPaused(false);
    pending[0].reject(new DOMException('interrupted', 'AbortError'));
    await flush();
    assert.equal(needed.at(-1), false);
    assert.equal(errors.length, 0);
    pending[1].resolve();
    await flush();
    assert.equal(frames.size, 1);
    media.setPaused(true);
    media.setPaused(false);
    media.dispose();
    pending[2].reject(new DOMException('disposed', 'AbortError'));
    await flush();
    assert.equal(frames.size, 0);
    assert.equal(errors.length, 0);
    video.mode = 'ok';
    const failedMedia = await decodeMedia(
      new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
    );
    failedMedia.start(
      () => {},
      (error) => errors.push(error),
      (value) => needed.push(value),
    );
    await flush();
    video.dispatchEvent(new Event('error'));
    assert.equal(frames.size, 0);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /decoding stopped/);
    const callsAfterFailure = calls;
    failedMedia.resume();
    assert.equal(
      calls,
      callsAfterFailure,
      'a broken decoder cannot start a retry loop',
    );
    failedMedia.dispose();
  } finally {
    globalThis.document = original.document;
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});

test('renderer coalesces video uploads before drawing and reuses texture between animation frames', () => {
  const keys = [
    'window',
    'document',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];
  const original = Object.fromEntries(keys.map((k) => [k, globalThis[k]]));
  let id = 0;
  const pending = new Map();
  const events = [];
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = { hidden: false };
  globalThis.requestAnimationFrame = (fn) => {
    pending.set(++id, fn);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => pending.delete(id);
  const gl = new Proxy(
    {},
    {
      get: (_, key) => {
        if (['getShaderParameter', 'getProgramParameter'].includes(key))
          return () => true;
        if (key.startsWith('create') || key === 'getUniformLocation')
          return () => ({});
        if (key.toUpperCase() === key) return key;
        return (...args) => {
          if (
            [
              'texImage2D',
              'texSubImage2D',
              'generateMipmap',
              'drawArrays',
              'useProgram',
            ].includes(key)
          )
            events.push({ key, args });
        };
      },
    },
  );
  const canvas = { width: 1, height: 1, getContext: () => gl };
  try {
    const renderer = new DuoRenderer(canvas);
    events.length = 0;
    const a = { videoWidth: 1280, videoHeight: 852 },
      b = { videoWidth: 1280, videoHeight: 852 };
    renderer.setImage(a);
    renderer.setImage(b);
    assert.equal(
      events.length,
      0,
      'decoding callbacks do not interrupt the GPU draw pipeline',
    );
    assert.equal(pending.size, 1);
    renderer.resize(800, 600);
    const upload = events.find((e) => e.key === 'texImage2D');
    assert.equal(upload.args.at(-1), b);
    assert.equal(events.filter((e) => e.key === 'generateMipmap').length, 1);
    assert.ok(
      events.indexOf(upload) < events.findIndex((e) => e.key === 'useProgram'),
    );
    events.length = 0;
    renderer.resize(800, 600);
    assert.equal(
      events.filter((e) => e.key === 'generateMipmap').length,
      0,
      'unchanged video frames reuse the blur pyramid',
    );
    renderer.setImage(a);
    renderer.resize(800, 600);
    assert.equal(
      events.filter((e) => e.key === 'texSubImage2D').length,
      1,
      'same-sized video frames update existing storage',
    );
    renderer.dispose();
  } finally {
    for (const key of keys) globalThis[key] = original[key];
  }
});
