export const defaults = {
  blurRadius: 36,
  diagonalBlurRadius: 16,
  creaseBlendWidth: 0.45,
  creaseBlurEasing: 1.5,
  edgeDarkness: 0.58,
  blurCurveStart: 0,
  blurCurveEnd: 0.4,
};
export type Settings = typeof defaults;
export const ranges: Record<keyof Settings, [number, number]> = {
  blurRadius: [0, 80],
  diagonalBlurRadius: [0, 60],
  creaseBlendWidth: [0, 1],
  creaseBlurEasing: [1, 4],
  edgeDarkness: [0, 1],
  blurCurveStart: [0, 1],
  blurCurveEnd: [0, 1],
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

// Fixed horizontal handles give an exact cubic without a per-pixel inverse solve.
export function blurCurve(t: number, start: number, end: number) {
  const x = clamp(t),
    inverse = 1 - x;
  return (
    3 * inverse * inverse * x * start + 3 * inverse * x * x * end + x * x * x
  );
}
