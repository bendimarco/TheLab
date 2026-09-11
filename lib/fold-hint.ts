export const FOLD_HINT_KEY = 'lab.fold-hint.completed';

// One-time guidance. Timer ownership stays separate from the user's fold animation.
export function createFoldHint(options: {
  show: (visible: boolean) => void;
  nudge: () => () => void;
}) {
  let learned = false;
  try {
    learned = localStorage.getItem(FOLD_HINT_KEY) === '1';
  } catch {
    /* Session-only when storage is unavailable. */
  }
  let active = false;
  let destroyed = false;
  let visible = false;
  let hintTimer: ReturnType<typeof setTimeout> | undefined;
  let nudgeTimer: ReturnType<typeof setInterval> | undefined;
  let cancelNudge: (() => void) | undefined;
  const show = (next: boolean) => {
    if (visible === next) return;
    visible = next;
    options.show(next);
  };
  const pause = () => {
    active = false;
    clearTimeout(hintTimer);
    clearInterval(nudgeTimer);
    cancelNudge?.();
    cancelNudge = undefined;
    show(false);
  };
  return {
    resume() {
      if (destroyed || learned || active) return;
      active = true;
      hintTimer = setTimeout(() => {
        if (active && !destroyed) show(true);
      }, 1800);
      nudgeTimer = setInterval(() => {
        if (!active || destroyed) return;
        cancelNudge?.();
        cancelNudge = options.nudge();
      }, 4000);
    },
    pause,
    complete() {
      if (learned) return;
      learned = true;
      pause();
      try {
        localStorage.setItem(FOLD_HINT_KEY, '1');
      } catch {
        /* Still dismissed for this session. */
      }
    },
    destroy() {
      destroyed = true;
      pause();
    },
  };
}
