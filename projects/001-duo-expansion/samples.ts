// Add an optimized landscape JPEG and thumbnail to public/photos/italy,
// then append an entry here. The first photo is the initial/reset image.
export const samplePhotos = [
  { id: 'p1001163', label: 'Dolomites at sunset' },
  { id: 'p1000738', label: 'Wildflowers in the Dolomites' },
  { id: 'p1001190', label: 'Portrait in the Dolomites' },
  { id: 'p1001204', label: 'Friends in the Dolomites' },
].map((photo) => ({
  ...photo,
  src: `/photos/italy/${photo.id}.jpg`,
  thumbnail: `/photos/italy/${photo.id}-thumb.jpg`,
}));
export const defaultPhoto = samplePhotos[0];
