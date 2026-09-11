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
    .outputText.replace("'./settings'", "'./settings.mjs'");
  await writeFile(join(dir, `${file}.mjs`), output);
}
const { defaults, validSettings, ease, blurCurve, blurCurveTable } =
  await import(pathToFileURL(join(dir, 'settings.mjs')));
const { addVersion, parseArchive, emptyArchive } = await import(
  pathToFileURL(join(dir, 'versions.mjs'))
);
const { DuoRenderer } = await import(pathToFileURL(join(dir, 'renderer.mjs')));
const { decodeURL } = await import(pathToFileURL(join(dir, 'media.mjs')));
const { readPhotos, savePhotos, photoFile } = await import(
  pathToFileURL(join(dir, 'photo-library.mjs'))
);
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
  } finally {
    globalThis.indexedDB = previous;
  }
});
