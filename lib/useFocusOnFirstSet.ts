'use client';

import { useEffect, useRef, type RefObject } from 'react';

// Shared "was the user just scrolling?" timestamp. Programmatic smooth
// scrolls also bump this, which conveniently prevents two sections from
// fighting over the viewport when one voice utterance fills several slots
// at once — the first section wins, the rest stay put.
let lastScrollAt = 0;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'scroll',
    () => {
      lastScrollAt = Date.now();
    },
    { passive: true },
  );
}

const SCROLL_QUIET_MS = 2000;

/**
 * Smooth-scrolls `ref` into view the FIRST time `value` transitions from
 * empty to set (voice filling a slot), and never again — and never while
 * the user has scrolled within the last ~2s, so it can't fight manual
 * browsing.
 */
export function useFocusOnFirstSet(value: unknown, ref: RefObject<HTMLElement | null>) {
  const prevRef = useRef(value);
  useEffect(() => {
    const was = prevRef.current;
    prevRef.current = value;
    if (!was && value && Date.now() - lastScrollAt > SCROLL_QUIET_MS) {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [value, ref]);
}
