import { validSettings, type Settings } from './settings';
export const STORAGE_KEY = 'weblab.duo.versions.v1';
export type Version = {
  id: string;
  name: string;
  savedAt: string;
  settings: Settings;
};
export type Archive = {
  schemaVersion: 1;
  nextNumber: number;
  versions: Version[];
};
export const emptyArchive = (): Archive => ({
  schemaVersion: 1,
  nextNumber: 1,
  versions: [],
});
export function parseArchive(raw: string | null): Archive {
  if (raw === null) return emptyArchive();
  const value = JSON.parse(raw);
  if (
    value?.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.nextNumber) ||
    value.nextNumber < 1 ||
    !Array.isArray(value.versions)
  )
    throw new Error(
      'Saved versions could not be read. Your stored data has been preserved.',
    );
  const ids = new Set<string>();
  for (const v of value.versions) {
    // Preserve existing versions while retiring the removed reflection control.
    if (v?.settings && typeof v.settings === 'object') {
      const settings = {
        blurCurveStartX: 1 / 3,
        blurCurveEndX: 2 / 3,
        blurCurveStart: 1 / 3,
        blurCurveEnd: 2 / 3,
        ...v.settings,
      };
      delete settings.glassReflection;
      delete settings.blurEndShift;
      v.settings = settings;
    }
    if (
      typeof v.id !== 'string' ||
      ids.has(v.id) ||
      typeof v.name !== 'string' ||
      !v.name.trim() ||
      !Number.isFinite(Date.parse(v.savedAt)) ||
      !validSettings(v.settings)
    )
      throw new Error(
        'Saved versions could not be read. Your stored data has been preserved.',
      );
    ids.add(v.id);
  }
  return value as Archive;
}
export function addVersion(
  archive: Archive,
  settings: Settings,
  id: string,
  savedAt: string,
): Archive {
  const version = {
    id,
    savedAt,
    name: `Version ${archive.nextNumber}`,
    settings: { ...settings },
  };
  return {
    ...archive,
    nextNumber: archive.nextNumber + 1,
    versions: [version, ...archive.versions],
  };
}
