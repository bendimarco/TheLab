// ResizeObserver callbacks may measure layout, but changing a sibling's size in
// that delivery cycle can cause undelivered notifications. Apply height changes
// together at the next frame, before the browser's next layout/observer pass.
export function observeDeferredHeight(
  element: Element,
  onHeight: (height: number) => void,
): () => void {
  let frame = 0;
  let applied = -1;
  let latest = -1;
  let disposed = false;
  const observer = new ResizeObserver(([entry]) => {
    if (disposed || !entry) return;
    latest = Math.ceil(entry.contentRect.height);
    if (latest === applied) {
      cancelAnimationFrame(frame);
      frame = 0;
      return;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (disposed || latest === applied) return;
      applied = latest;
      onHeight(latest);
    });
  });
  observer.observe(element);
  return () => {
    disposed = true;
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}
