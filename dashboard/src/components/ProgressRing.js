import { useLayoutEffect, useRef } from 'react';
import { animate, createDrawable } from 'animejs';

/**
 * Circular SVG progress ring that draws itself with anime.js whenever the
 * value/max ratio changes. Used on the dashboard for "Clocked In".
 * Respects prefers-reduced-motion (jumps straight to the final ratio).
 */
export default function ProgressRing({
  value = 0,
  max = 0,
  size = 46,
  stroke = 4.5,
  color = '#10b981',
  className = '',
}) {
  const circleRef = useRef(null);
  const shownRatioRef = useRef(0);

  useLayoutEffect(() => {
    if (!circleRef.current) return;
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const from = shownRatioRef.current;
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const drawable = createDrawable(circleRef.current);
    const anim = animate(drawable, {
      draw: [`0 ${from}`, `0 ${ratio}`],
      duration: reduced ? 1 : 1100,
      ease: 'outExpo',
    });
    shownRatioRef.current = ratio;
    return () => anim.revert();
  }, [value, max]);

  const r = (size - stroke) / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={`stat-ring ${className}`}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeOpacity={0.18}
        strokeWidth={stroke}
      />
      <circle
        ref={circleRef}
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
