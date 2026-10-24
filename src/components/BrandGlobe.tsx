'use client';

import { useEffect, useState } from 'react';
import './BrandGlobe.css';

/**
 * BrandGlobe — the G Cut as a living globe.
 *
 * Three layers, bottom to top (styles in BrandGlobe.css, `.brand-globe*`):
 *  1. A circular disc filled with an equirectangular Earth texture
 *     (NASA Blue Marble, public domain, duotone-tinted to the brand's
 *     glassy teal) that scrolls horizontally — one turn ≈ 30 s — so the
 *     surface reads as the Earth rotating.
 *  2. A shading layer (upper-left highlight + rim vignette) that makes
 *     the disc read as a sphere rather than a flat sticker.
 *  3. The fixed foreground: the G and faceted rim extracted from the
 *     original G Cut logo's own pixels (black-keyed, distance-masked so
 *     only the silhouette band, the G's right crescent and its crossbar
 *     survive). The G identity never moves and never mirrors.
 *
 * The disc is inset to the measured silhouette of the original logo's
 * globe so its rim meets the overlay's faceted edge.
 *
 * Static safety: if the texture asset fails to load, the component
 * falls back to the plain static logo PNG. Rotation is pure CSS and
 * stops under prefers-reduced-motion. Favicon / PWA / social icons are
 * deliberately NOT this component — platforms require static images.
 */
export default function BrandGlobe({
  className = '',
  title = 'Glass Earth',
}: {
  className?: string;
  title?: string;
}) {
  const [textureOk, setTextureOk] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    const probe = new Image();
    probe.onload = () => { if (live) setTextureOk(true); };
    probe.onerror = () => { if (live) setTextureOk(false); };
    probe.src = '/brand/earth-texture.webp';
    return () => { live = false; };
  }, []);

  if (textureOk === false) {
    return <img src="/brand/glass-earth-logo.png" alt={title} className={className} draggable={false} />;
  }

  return (
    <span className={`brand-globe ${className}`} role="img" aria-label={title}>
      <span className="brand-globe__disc" aria-hidden="true">
        <span className="brand-globe__strip" />
        <span className="brand-globe__shade" />
      </span>
      <img
        className="brand-globe__overlay"
        src="/brand/glass-earth-logo-overlay.webp"
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </span>
  );
}
