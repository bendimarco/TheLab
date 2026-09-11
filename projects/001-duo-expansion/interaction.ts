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

// Small collections are predictable; larger ones sample without repeating the active item.
export function nextRotationIndex(
  current: number,
  indices: number[],
  random: number,
): number | null {
  if (!indices.length) return null;
  if (indices.length <= 4)
    return indices[(indices.indexOf(current) + 1) % indices.length];
  const candidates = indices.filter((index) => index !== current);
  return candidates[
    Math.min(
      candidates.length - 1,
      Math.max(0, Math.floor(random * candidates.length)),
    )
  ];
}
