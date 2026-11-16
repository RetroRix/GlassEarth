'use client';

import { useEffect } from 'react';

/**
 * The front door's only client behaviour — the same script the approved
 * mockup ran, as an effect: autoplay the hero when motion is welcome,
 * play each feature clip while it is on screen and pause it when it is
 * not, and pause everything while the tab is hidden. Videos are found by
 * the data attributes the door markup carries (data-door-hero /
 * data-door-clip / data-door-tile), so nothing here depends on the CSS
 * module's hashed class names.
 */
export default function DoorBehavior() {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const hero = document.querySelector<HTMLVideoElement>('[data-door-hero]');
    const play = (v: HTMLVideoElement) => {
      try {
        const p = v.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch { /* autoplay refused — the poster still reads fine */ }
    };

    if (hero && !reduceMotion) play(hero);
    if (reduceMotion) return;

    const clips = Array.from(document.querySelectorAll<HTMLVideoElement>('[data-door-clip]'));
    let io: IntersectionObserver | null = null;
    if ('IntersectionObserver' in window) {
      io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const v = entry.target as HTMLVideoElement;
          if (entry.isIntersecting) play(v);
          else v.pause();
        });
      }, { threshold: 0.35 });
      clips.forEach((v) => io!.observe(v));
    } else {
      clips.forEach(play);
    }

    // Hovering a tile on a pointer device also nudges its clip awake.
    const tiles = Array.from(document.querySelectorAll<HTMLElement>('[data-door-tile]'));
    const onEnter = (tile: HTMLElement) => () => {
      const v = tile.querySelector('video');
      if (v && v.paused) play(v);
    };
    const removers = tiles.map((tile) => {
      const handler = onEnter(tile);
      tile.addEventListener('mouseenter', handler);
      return () => tile.removeEventListener('mouseenter', handler);
    });

    // Save battery: pause everything when the tab is hidden.
    const onVisibility = () => {
      if (document.hidden) {
        document.querySelectorAll('video').forEach((v) => v.pause());
      } else if (hero && hero.paused) {
        play(hero);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      io?.disconnect();
      removers.forEach((r) => r());
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
