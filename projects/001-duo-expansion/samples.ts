// The first photo is the initial/reset image.
export const samplePhotos = [
  {
    id: 'p1001338',
    label: 'Dog',
  },
  {
    id: 'p1011479',
    label: 'Lake',
  },
  {
    id: 'p1001168',
    label: 'Friend',
  },
  {
    id: 'p1001214',
    label: 'Sunset',
  },
].map((photo) => ({
  ...photo,
  src: `/photos/italy/${photo.id}.jpg`,
  thumbnail: `/photos/italy/${photo.id}-thumb.jpg`,
}));
export const defaultPhoto = samplePhotos[0];
