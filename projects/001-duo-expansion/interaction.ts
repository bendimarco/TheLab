// Endpoint attraction uses a short velocity projection, bounded to avoid long flicks.
export function releaseTarget(
  progress: number,
  velocity: number,
  precise: boolean,
): 0 | 1 | null {
  if (precise) return null;
  const projected = progress + Math.max(-0.1, Math.min(0.1, velocity * 0.12));
  if (projected <= 0.22) return 0;
  if (projected >= 0.78) return 1;
  return null;
}

// Analytic critically damped spring: continuous release velocity, no ringing.
export function settledProgress(
  from: number,
  to: number,
  velocity: number,
  seconds: number,
): number {
  if (seconds >= 0.85) return to;
  const offset = from - to;
  const omega = 12;
  const value =
    to +
    (offset + (velocity + omega * offset) * seconds) *
      Math.exp(-omega * seconds);
  return Math.max(0, Math.min(1, value));
}
