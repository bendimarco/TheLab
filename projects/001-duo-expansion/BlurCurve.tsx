import { useRef } from 'react';
import { clamp, defaults, type Settings } from './settings';

// Horizontal positions are fixed at thirds; vertical handles shape the falloff.
export function BlurCurve({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const keys = ['blurCurveStart', 'blurCurveEnd'] as const;
  return (
    <div className="blur-curve">
      <div className="range-label">
        <span>Blur curve</span>
        <button
          className="curve-reset"
          onClick={() =>
            onChange({
              blurCurveStart: defaults.blurCurveStart,
              blurCurveEnd: defaults.blurCurveEnd,
            })
          }
        >
          Reset
        </button>
      </div>
      <div className="curve-plot" ref={plot}>
        <svg
          viewBox="0 0 300 150"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            className="curve-guide"
            d="M0 150 L300 0 M100 0 V150 M200 0 V150 M0 75 H300"
          />
          <path
            className="curve-tangent"
            d={`M0 150 L100 ${150 * (1 - settings.blurCurveStart)} M300 0 L200 ${150 * (1 - settings.blurCurveEnd)}`}
          />
          <path
            className="curve-line"
            d={`M0 150 C100 ${150 * (1 - settings.blurCurveStart)} 200 ${150 * (1 - settings.blurCurveEnd)} 300 0`}
          />
        </svg>
        {keys.map((key, i) => (
          <button
            key={key}
            className="curve-handle"
            aria-label={`${i === 0 ? 'Hinge' : 'Outer edge'} blur curve handle`}
            aria-describedby="curve-help"
            style={{
              left: `${((i + 1) * 100) / 3}%`,
              top: `${(1 - settings[key]) * 100}%`,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (
                !e.currentTarget.hasPointerCapture(e.pointerId) ||
                !plot.current
              )
                return;
              const bounds = plot.current.getBoundingClientRect();
              onChange({
                [key]: clamp(1 - (e.clientY - bounds.top) / bounds.height),
              });
            }}
            onPointerUp={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            onKeyDown={(e) => {
              if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key))
                return;
              e.preventDefault();
              onChange({
                [key]:
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? 1
                      : clamp(
                          settings[key] +
                            (e.key === 'ArrowUp' ? 1 : -1) *
                              (e.shiftKey ? 0.1 : 0.01),
                        ),
              });
            }}
            title={`${Math.round(settings[key] * 100)}%`}
          >
            <span className="sr-only">
              {Math.round(settings[key] * 100)} percent
            </span>
          </button>
        ))}
      </div>
      <div className="curve-axis">
        <span>Hinge · sharp</span>
        <span>Free edge · blurred</span>
      </div>
      <p className="hint" id="curve-help">
        Drag handles up for more blur, down for less. Use ↑ ↓ when focused.
      </p>
    </div>
  );
}
