import { useEffect, useRef } from 'react';
import { animate } from 'animejs';

/**
 * Animated stat number — counts (up or down) to the target value with anime.js
 * whenever `value` changes. First render counts up from 0; later changes count
 * from whatever digit is currently on screen, so every 30s refresh ticks are
 * smooth. Respects prefers-reduced-motion (renders the number instantly).
 */
export default function AnimatedNumber({ value, className }) {
  const ref = useRef(null);
  const currentRef = useRef(0);

  useEffect(() => {
    if (!ref.current) return;
    const from = currentRef.current;
    const to = Number(value) || 0;
    if (from === to) {
      ref.current.textContent = String(to);
      return;
    }

    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      currentRef.current = to;
      ref.current.textContent = String(to);
      return;
    }

    const counter = { v: from };
    const anim = animate(counter, {
      v: to,
      duration: 900,
      ease: 'outExpo',
      onUpdate: () => {
        currentRef.current = counter.v;
        if (ref.current) ref.current.textContent = String(Math.round(counter.v));
      },
      onComplete: () => {
        currentRef.current = to;
        if (ref.current) ref.current.textContent = String(to);
      },
    });
    return () => anim.revert();
  }, [value]);

  return <span ref={ref} className={className} />;
}
