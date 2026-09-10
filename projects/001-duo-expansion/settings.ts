export const defaults = {
  glassReflection: 0.35,
  blurRadius: 36,
  diagonalBlurRadius: 16,
  creaseBlendWidth: 0.45,
  creaseBlurEasing: 1.5,
  edgeDarkness: 0.58,
};
export type Settings = typeof defaults;
export const ranges: Record<keyof Settings, [number, number]> = {
  glassReflection: [0, 1],
  blurRadius: [0, 80],
  diagonalBlurRadius: [0, 60],
  creaseBlendWidth: [0, 1],
  creaseBlurEasing: [1, 4],
  edgeDarkness: [0, 1],
};
export function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(ranges).every(([key, [min, max]]) => {
    const n = (value as Record<string, unknown>)[key];
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  });
}
export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
export const ease = (t: number) => t * t * (3 - 2 * t);
