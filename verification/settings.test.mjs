import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = await mkdtemp(join(tmpdir(), 'weblab-test-'));
for (const file of ['settings', 'versions']) {
  const source = await readFile(
    new URL(`../projects/001-duo-expansion/${file}.ts`, import.meta.url),
    'utf8',
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
const { defaults, validSettings, ease } = await import(
  pathToFileURL(join(dir, 'settings.mjs'))
);
const { addVersion, parseArchive, emptyArchive } = await import(
  pathToFileURL(join(dir, 'versions.mjs'))
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
