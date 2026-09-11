export const defaults = {
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
};
export type Settings = typeof defaults;
export const ranges: Record<keyof Settings, [number, number]> = {
  blurRadius: [0, 80],
  diagonalBlurRadius: [0, 60],
  creaseBlendWidth: [0, 1],
  creaseBlurEasing: [1, 4],
  edgeDarkness: [0, 1],
  rightScreenDarkness: [0, 1],
  closedImageAligned: [0, 1],
  blurCurveStartX: [0, 1],
  blurCurveEndX: [0, 1],
  blurCurveStart: [0, 1],
  blurCurveEnd: [0, 1],
};
export function validSettings(value: unknown): value is Settings {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(ranges).every(([key, [min, max]]) => {
    const n = (value as Record<string, unknown>)[key];
    if (key === 'closedImageAligned') return n === 0 || n === 1;
    return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  });
}
export const clamp = (value: number, min = 0, max = 1) =>
  Math.min(max, Math.max(min, value));
export const ease = (t: number) => t * t * (3 - 2 * t);

// Invert the horizontal Bézier once per lookup-table sample, never per pixel.
// Keeping both handles inside the unit square gives a monotonic spatial ramp.
export function blurCurve(
  x: number,
  start: number,
  end: number,
  startX = 1 / 3,
  endX = 2 / 3,
) {
  x = clamp(x);
  if (x === 0 || x === 1) return x;
  const cubic = (t: number, a: number, b: number) =>
    3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t * t * b + t ** 3;
  if (startX === 1 / 3 && endX === 2 / 3) return cubic(x, start, end);
  let low = 0,
    high = 1;
  for (let i = 0; i < 24; i++) {
    const t = (low + high) / 2;
    if (cubic(t, startX, endX) < x) low = t;
    else high = t;
  }
  return cubic((low + high) / 2, start, end);
}
export function blurCurveTable(settings: Settings) {
  return Float32Array.from({ length: 1025 }, (_, i) =>
    blurCurve(
      i / 1024,
      settings.blurCurveStart,
      settings.blurCurveEnd,
      settings.blurCurveStartX,
      settings.blurCurveEndX,
    ),
  );
}
