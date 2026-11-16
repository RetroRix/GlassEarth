import type { Metadata } from 'next';
import Link from 'next/link';
import { Sora, Manrope } from 'next/font/google';
import { Check, Globe, MapPin } from 'lucide-react';
import DoorBehavior from './DoorBehavior';
import styles from './front-door.module.css';

const sora = Sora({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-sora',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { absolute: 'Glass Earth — See everything. Miss nothing.' },
  description:
    'Glass Earth — the live planet on one globe. 69,000+ cameras, live flights & satellites, ships, weather, live TV & Radio. Free, no sign-up.',
  alternates: { canonical: '/' },
  openGraph: {
    title: 'Glass Earth — See everything. Miss nothing.',
    description:
      'The live planet on one globe — 69,000+ cameras, live flights & satellites, ships, weather, live TV & Radio.',
    url: 'https://www.glassearthlive.com/',
    type: 'website',
    siteName: 'Glass Earth',
    images: [
      {
        url: 'https://www.glassearthlive.com/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Glass Earth — the live planet on one globe',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Glass Earth — See everything. Miss nothing.',
    description:
      'The live planet on one globe — 69,000+ cameras, live flights & satellites, ships, weather, live TV & Radio.',
    images: ['https://www.glassearthlive.com/og-image.png'],
  },
};

/**
 * The front door. The live app moved to /app (2026-11-15); the root is
 * this landing page, ported faithfully from the concept mockup Rick
 * approved (artifact glass-earth-front-door-concept, v7) — same copy,
 * same clips, same counters. Static prerender: no app bundle, just the
 * markup, the module CSS and DoorBehavior's small playback effect.
 *
 * Old links survive the move two ways: share links the app generates now
 * point at /app directly (lib/share-view buildShareUrl), and any root
 * visit carrying app query params is redirected to /app with its query
 * string intact by src/middleware.ts — so every link shared while the
 * app lived at / keeps landing in the app.
 */

const TILES: { title: string; line: string; clip: string; poster: string; aria: string }[] = [
  {
    title: 'Ride in the Cockpit',
    line: 'Pick any live flight and ride along in a glass cockpit.',
    clip: '/front-door/cockpit.mp4',
    poster: '/front-door/cockpit-poster.jpg',
    aria: 'Footage: riding in the glass cockpit of a live flight',
  },
  {
    title: 'The Camera Wall',
    line: 'Dozens of live cameras from around the world on one wall.',
    clip: '/front-door/wall.mp4',
    poster: '/front-door/wall-poster.jpg',
    aria: 'Footage: the live camera wall',
  },
  {
    title: 'Sensor Looks',
    line: 'See any camera in night vision, thermal, noir and more.',
    clip: '/front-door/sensor.mp4',
    poster: '/front-door/sensor-poster.jpg',
    aria: 'Footage: a camera shown through different sensor looks',
  },
  {
    title: 'Date Compare',
    line: 'Split the globe between two dates and watch the planet change.',
    clip: '/front-door/datecompare.mp4',
    poster: '/front-door/datecompare-poster.jpg',
    aria: 'Footage: the globe split between two dates',
  },
  {
    title: 'Look Up!',
    line: 'Satellite passes over your location, timed to the minute.',
    clip: '/front-door/lookup.mp4',
    poster: '/front-door/lookup-poster.jpg',
    aria: 'Footage: satellite passes timed over a location',
  },
  {
    title: 'Live Ships',
    line: 'Ships broadcasting their positions, moving on the globe right now.',
    clip: '/front-door/ships.mp4',
    poster: '/front-door/ships-poster.jpg',
    aria: 'Footage: live ships moving on the globe',
  },
];

const POINTS: { icon: typeof Check; lead: string; body: string }[] = [
  { icon: Check, lead: 'Free — no sign-up', body: 'No account, no card. Just open it and look.' },
  { icon: MapPin, lead: 'Opens on your location', body: 'The globe starts where you are, then the world is yours.' },
  { icon: Globe, lead: 'Works right in your browser', body: 'Nothing to install — phone, tablet or desktop.' },
];

export default function FrontDoorPage() {
  return (
    // docs-root releases the full-screen map's scroll lock (see globals.css), so the page scrolls.
    <div className={`docs-root ${styles.root} ${sora.variable} ${manrope.variable}`}>
      <DoorBehavior />

      {/* ============ HERO ============ */}
      <header className={styles.hero}>
        <div className={styles.heroMedia} aria-hidden="true">
          <video data-door-hero muted loop playsInline preload="auto" poster="/front-door/hero-poster.jpg">
            <source src="/front-door/hero.mp4" type="video/mp4" />
          </video>
        </div>
        <div className={styles.heroShade} aria-hidden="true" />

        <div className={styles.wrap}>
          <div className={styles.topbar}>
            <div className={styles.brand}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark, same as the app's BrandGlobe */}
              <img src="/front-door/logo.png" alt="Glass Earth logo — a faceted glass globe with a G cut out of it" width={46} height={46} />
              <div>
                <div className={styles.brandName}>Glass Earth</div>
                <div className={styles.brandSub}>Real-Time Earth Observation.</div>
              </div>
            </div>
            <nav aria-label="Site">
              <Link href="/docs">Docs</Link>
              <Link href="/help">Help</Link>
            </nav>
          </div>

          <div className={styles.heroCentre}>
            <h1 className={styles.heroHook}>
              <span className={styles.line}>The whole planet —</span>
              <span className={`${styles.line} ${styles.accent}`}>in real time.</span>
            </h1>
            <p className={styles.heroBio}>
              The live planet on one globe — 69,000+ cameras, live flights &amp; satellites, ships, weather, live TV &amp; Radio.
            </p>
            <Link className={styles.cta} href="/app">
              Enter the Live Planet <span className={styles.arrow} aria-hidden="true">→</span>
            </Link>

            <div className={styles.counters} role="group" aria-label="Glass Earth's live counters">
              <div className={styles.countersLabel}>
                <span className={styles.liveDot} aria-hidden="true" /> Live counters from the app
              </div>
              <div className={styles.countersGrid}>
                <div className={styles.counter}><b>69,000+</b><span>Live cameras</span></div>
                <div className={styles.counter}><b>18,000+</b><span>Satellites tracked</span></div>
                <div className={styles.counter}><b>Flights</b><span>Live now</span></div>
                <div className={styles.counter}><b>Live TV &amp; Radio</b><span>From everywhere</span></div>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main>
        {/* ============ FEATURES ============ */}
        <section className={styles.wrap} aria-labelledby="features-heading">
          <div className={styles.sectionHead}>
            <h2 id="features-heading">One globe. Everything on it, live.</h2>
            <p>Real footage from the app — every view below is a tap away once you&apos;re inside.</p>
          </div>

          <div className={styles.tiles}>
            {TILES.map((t) => (
              <article key={t.title} className={styles.tile} data-door-tile>
                <div className={styles.tileMedia}>
                  <video data-door-clip muted loop playsInline preload="metadata" poster={t.poster} aria-label={t.aria}>
                    <source src={t.clip} type="video/mp4" />
                  </video>
                </div>
                <div className={styles.tileBody}>
                  <h3>{t.title}</h3>
                  <p>{t.line}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ============ STRIP ============ */}
        <div className={styles.strip}>
          <div className={`${styles.wrap} ${styles.stripInner}`}>
            <div>
              <h2>One globe, everything live</h2>
              <div className={styles.points}>
                {POINTS.map((p) => (
                  <div key={p.lead} className={styles.point}>
                    <div className={styles.glyph} aria-hidden="true">
                      <p.icon strokeWidth={2} />
                    </div>
                    <div>
                      <b>{p.lead}</b>
                      <span>{p.body}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className={styles.stripVisual}>
              <video data-door-clip muted loop playsInline preload="metadata" poster="/front-door/planet-poster.jpg" aria-label="Footage: the live planet turning on the Glass Earth globe">
                <source src="/front-door/planet.mp4" type="video/mp4" />
              </video>
            </div>
          </div>
        </div>

        {/* ============ CLOSING CTA ============ */}
        <section className={`${styles.wrap} ${styles.closing}`} aria-labelledby="closing-heading">
          <h2 className={styles.tagline} id="closing-heading">
            See everything. <span className={styles.accent}>Miss nothing.</span>
          </h2>
          <p>The live planet is already turning. Step inside and watch it with everything switched on.</p>
          <Link className={styles.cta} href="/app">
            Enter the Live Planet <span className={styles.arrow} aria-hidden="true">→</span>
          </Link>
        </section>
      </main>

      {/* ============ FOOTER ============ */}
      <footer className={styles.doorFooter}>
        <div className={styles.wrap}>
          <div className={styles.footerGrid}>
            <div className={styles.footerBrand}>
              {/* eslint-disable-next-line @next/next/no-img-element -- small static brand mark */}
              <img src="/front-door/logo.png" alt="" width={52} height={52} />
              <div>
                <div className={styles.name}>Glass Earth</div>
                <div className={styles.tag}>See everything. Miss nothing.</div>
              </div>
            </div>
            <nav className={styles.footerLinks} aria-label="Footer">
              <Link href="/docs">Docs</Link>
              <Link href="/help">Help</Link>
              <Link href="/privacy">Privacy</Link>
              <a href="https://ko-fi.com/glassearthlive" target="_blank" rel="noopener noreferrer">Support on Ko-fi</a>
            </nav>
          </div>
          <div className={styles.footerMeta}>
            <span>by Rick Quast</span>
            <Link href="/">glassearthlive.com</Link>
            <span>Free — no sign-up.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
