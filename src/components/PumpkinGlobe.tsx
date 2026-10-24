'use client';

import './PumpkinGlobe.css';

/**
 * PumpkinGlobe — the boot screen's Halloween hero.
 *
 * Shown ONLY on the boot screen while the seasonal gate is on
 * (`spooky` in page.tsx); the header, favicons and every other
 * BrandGlobe use stay exactly as they are.
 *
 * Same layered idea as BrandGlobe, but pumpkin:
 *  1. A circular disc of the brand's Earth texture, scrolling slowly
 *     (~30 s/rev) beneath an orange `color`-blend tint, so the
 *     continents read pumpkin-orange rather than teal.
 *  2. Vertical ribbing (a repeating gradient) + sphere shading, so it
 *     reads as a pumpkin, not just an orange ball.
 *  3. A fixed carved jack-o'-lantern face (inline SVG: slanted eyes,
 *     triangle nose, jagged grin) that never rotates with the texture
 *     and stays upright and centered at any size, plus a little stem.
 *
 * No JS state: if the texture asset fails, the disc's orange gradient,
 * ribs, shading and face still read as a pumpkin. Rotation is pure CSS
 * and stops under prefers-reduced-motion. Colours are constants —
 * no Style Studio variable is read or written.
 */
export default function PumpkinGlobe({
  className = '',
  title = 'Glass Earth',
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span className={`pumpkin-globe ${className}`} role="img" aria-label={title}>
      <span className="pumpkin-globe__disc" aria-hidden="true">
        <span className="pumpkin-globe__strip" />
        <span className="pumpkin-globe__tint" />
        <span className="pumpkin-globe__ribs" />
        <span className="pumpkin-globe__shade" />
      </span>
      <span className="pumpkin-globe__stem" aria-hidden="true" />
      <svg
        className="pumpkin-globe__face"
        viewBox="0 0 100 100"
        aria-hidden="true"
        focusable="false"
      >
        {/* Slanted jack-o'-lantern eyes */}
        <polygon points="28,34 46,39 36,50" fill="#1c0a00" opacity="0.92" />
        <polygon points="72,34 54,39 64,50" fill="#1c0a00" opacity="0.92" />
        {/* Triangle nose */}
        <polygon points="50,54 44,63 56,63" fill="#1c0a00" opacity="0.92" />
        {/* Jagged grin */}
        <path
          d="M22,66 L29,60 L35,67 L42,60 L50,67 L58,60 L65,67 L71,60 L78,66 L76,71 L70,66 L64,72 L57,66 L50,72 L43,66 L36,72 L30,66 L24,71 Z"
          fill="#1c0a00"
          opacity="0.92"
        />
      </svg>
    </span>
  );
}
