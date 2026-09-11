export const samplePhotos = [
  {
    id: 'p1001341',
    label: 'Dog getting pets',
    kind: 'video' as const,
    src: '/photos/italy/p1001341-web.mp4',
    thumbnail: '/photos/italy/p1001341-thumb.jpg',
  },
  {
    id: 'p1001338',
    label: 'Dog',
    kind: 'image' as const,
    src: '/photos/italy/p1001338.jpg',
    thumbnail: '/photos/italy/p1001338-thumb.jpg',
  },
  ...[
    { id: 'p1011479', label: 'Lake' },
    { id: 'p1001168', label: 'Friend' },
  ].map((photo) => ({
    ...photo,
    kind: 'image' as const,
    src: `/photos/italy/${photo.id}.jpg`,
    thumbnail: `/photos/italy/${photo.id}-thumb.jpg`,
  })),
];
export const defaultPhoto = samplePhotos[0];

// Desktop and mobile share the video-first rotation. Explicit motion/data
// preferences retain a still-image fallback.
export function defaultSampleIndex(preferStills: boolean) {
  return preferStills
    ? samplePhotos.findIndex((sample) => sample.kind === 'image')
    : 0;
}
export function shuffleSampleIndices(preferStills: boolean) {
  return samplePhotos.flatMap((sample, index) =>
    !preferStills || sample.kind === 'image' ? [index] : [],
  );
}
export function shouldPreferStillSamples(environment: {
  userAgent: string;
  coarsePointer: boolean;
  shortEdge: number;
  reducedMotion: boolean;
  saveData: boolean;
}) {
  return (
    environment.reducedMotion ||
    environment.saveData
  );
}
