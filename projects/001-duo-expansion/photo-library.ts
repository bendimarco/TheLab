// Device-local photo rotation. Store prepared images as blobs, never in requests.
export type LocalPhoto = {
  id: string;
  name: string;
  blob: Blob;
  thumbnail: string;
  poster?: string;
  addedAt: number;
};
type StoredPhoto = Omit<LocalPhoto, 'blob'> & {
  blob: Blob | ArrayBuffer;
  mimeType?: string;
};
const DATABASE = 'lab.personal-photos';
const STORE = 'photos';
function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Close other Lab tabs and try again.'));
  });
}
export async function readPhotos(): Promise<LocalPhoto[]> {
  const db = await openLibrary();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).getAll();
      transaction.oncomplete = () =>
        resolve(
          (request.result as StoredPhoto[])
            .map((photo) => ({
              ...photo,
              blob:
                photo.blob instanceof Blob
                  ? photo.blob
                  : new Blob([photo.blob], {
                      type: photo.mimeType || 'application/octet-stream',
                    }),
            }))
            .sort((a, b) => a.addedAt - b.addedAt),
        );
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function savePhotos(photos: LocalPhoto[]): Promise<void> {
  // Materialize bytes before starting the transaction. Safari can fail to persist
  // file-backed Blobs; awaiting inside a transaction would also let it go inactive.
  const records: StoredPhoto[] = [];
  for (const photo of photos)
    records.push({
      ...photo,
      blob: await photo.blob.arrayBuffer(),
      mimeType: photo.blob.type,
    });
  const db = await openLibrary();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      try {
        for (const photo of records) transaction.objectStore(STORE).put(photo);
      } catch (error) {
        transaction.abort();
        reject(error);
      }
      // Only report success after the entire batch is committed (including quota checks).
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
export async function preparePhoto(
  canvas: HTMLCanvasElement,
  name: string,
  originalVideo?: File,
): Promise<LocalPhoto> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error('Could not save this image.')),
      'image/webp',
      0.9,
    );
  });
  const thumbnail = document.createElement('canvas');
  thumbnail.width = 144;
  thumbnail.height = 96;
  const context = thumbnail.getContext('2d');
  if (!context) throw new Error('Could not prepare a photo preview.');
  const scale = Math.max(144 / canvas.width, 96 / canvas.height);
  context.drawImage(
    canvas,
    (144 - canvas.width * scale) / 2,
    (96 - canvas.height * scale) / 2,
    canvas.width * scale,
    canvas.height * scale,
  );
  return {
    id: crypto.randomUUID(),
    name,
    blob: originalVideo ?? blob,
    ...(originalVideo ? { poster: canvas.toDataURL('image/webp', 0.85) } : {}),
    thumbnail: thumbnail.toDataURL('image/webp', 0.8),
    addedAt: Date.now(),
  };
}
export function photoFile(photo: LocalPhoto): File {
  return new File([photo.blob], photo.name, { type: photo.blob.type });
}

export async function deletePhoto(id: string): Promise<void> {
  const db = await openLibrary();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
