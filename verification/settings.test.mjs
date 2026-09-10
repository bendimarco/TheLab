import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'weblab-test-'));
for (const file of ['settings', 'versions', 'renderer']) {
  let source = await readFile(
    new URL(`../projects/001-duo-expansion/${file}.ts`, import.meta.url),
    'utf8',
  );
  if (file === 'renderer') source = source.replace("import fragment from './duo.frag?raw';", "const fragment = '';" );
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
const { defaults, validSettings, ease, blurCurve } = await import(
  pathToFileURL(join(dir, 'settings.mjs'))
);
const { addVersion, parseArchive, emptyArchive } = await import(
  pathToFileURL(join(dir, 'versions.mjs'))
);
const { DuoRenderer } = await import(pathToFileURL(join(dir, 'renderer.mjs')));
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
  assert.equal(first.versions[0].settings.blurRadius, 36);
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
  const old = addVersion(emptyArchive(), defaults, 'old', '2026-09-10T12:00:00Z');
  old.versions[0].settings.blurEndShift = 0.95;
  old.versions[0].settings.glassReflection = 0.9;
  const migrated = parseArchive(JSON.stringify(old));
  assert.equal('blurEndShift' in migrated.versions[0].settings, false);
  assert.equal('glassReflection' in migrated.versions[0].settings, false);
  assert.equal(migrated.versions[0].settings.blurRadius, defaults.blurRadius);
});

test('blur curves keep endpoints and never reverse, including extreme handles', () => {
  for (const a of [0, 1 / 3, 0.5, 1]) for (const b of [0, 0.4, 2 / 3, 1]) {
    assert.equal(blurCurve(0, a, b), 0);
    assert.equal(blurCurve(1, a, b), 1);
    let previous = 0;
    for (let i = 0; i <= 1000; i++) {
      const value = blurCurve(i / 1000, a, b);
      assert.ok(value >= previous - 1e-12 && value <= 1);
      previous = value;
    }
  }
  assert.ok(blurCurve(0.5, defaults.blurCurveStart, defaults.blurCurveEnd) < 0.35);
});
test('older versions migrate to neutral handles, custom handles round trip', () => {
  const old = addVersion(emptyArchive(), defaults, 'old', '2026-09-10T12:00:00Z');
  delete old.versions[0].settings.blurCurveStart;
  delete old.versions[0].settings.blurCurveEnd;
  const migrated = parseArchive(JSON.stringify(old)).versions[0].settings;
  assert.equal(migrated.blurCurveStart, 1 / 3);
  assert.equal(migrated.blurCurveEnd, 2 / 3);
  const custom = addVersion(emptyArchive(), { ...defaults, blurCurveStart: 0.8, blurCurveEnd: 0.1 }, 'new', '2026-09-10T12:00:00Z');
  assert.deepEqual(parseArchive(JSON.stringify(custom)), custom);
});

test('canvas resize redraws before returning, skips unchanged buffer sizes and retains pose', () => {
  const original = Object.fromEntries(['window', 'document', 'requestAnimationFrame', 'cancelAnimationFrame'].map(k => [k, globalThis[k]]));
  const events = [];
  let next = 0;
  const pending = new Map();
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = { hidden: false };
  globalThis.requestAnimationFrame = fn => { pending.set(++next, fn); return next; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  const gl = new Proxy({}, { get: (_, key) => {
    if (key === 'drawArrays') return () => events.push('draw');
    if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
    if (key.startsWith('create') || key === 'getUniformLocation') return () => ({});
    if (key.toUpperCase() === key) return 0;
    return () => {};
  }});
  let width = 1, height = 1;
  const canvas = { getContext: () => gl,
    get width() { return width; }, set width(n) { width = n; events.push('clear'); },
    get height() { return height; }, set height(n) { height = n; events.push('clear'); },
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
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});
