// Per-visit guidance. Timer ownership stays separate from the user's fold animation.
export function createFoldHint(options: {
  show: (visible: boolean) => void;
  nudge: () => () => void;
}) {
  let learned = false;
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
      }, 3000);
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
    },
    destroy() {
      destroyed = true;
      pause();
    },
  };
}
