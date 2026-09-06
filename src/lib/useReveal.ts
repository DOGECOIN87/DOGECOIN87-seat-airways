import { useEffect } from 'react';

/**
 * Scroll reveals.
 *
 * Every `.sa-reveal` element rises in once, when it first enters the viewport.
 * Under prefers-reduced-motion everything is simply shown immediately.
 */
export function useReveal() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const targets = Array.from(document.querySelectorAll<HTMLElement>('.sa-reveal'));

    let io: IntersectionObserver | null = null;
    const pending = new Set<HTMLElement>();
    if (reduced || typeof IntersectionObserver === 'undefined') {
      targets.forEach((el) => el.classList.add('is-in'));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-in');
              pending.delete(entry.target as HTMLElement);
              io?.unobserve(entry.target);
            }
          }
        },
        { rootMargin: '0px 0px -10% 0px', threshold: 0.08 },
      );
      targets.forEach((el) => {
        pending.add(el);
        io?.observe(el);
      });
    }

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        /* Instant jumps (anchors, End key) can skip the observer: anything
           now above the viewport has been scrolled past — light it. */
        for (const el of pending) {
          if (el.getBoundingClientRect().bottom < 0) {
            el.classList.add('is-in');
            io?.unobserve(el);
            pending.delete(el);
          }
        }
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);
}
