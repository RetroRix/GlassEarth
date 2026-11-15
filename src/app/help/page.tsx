import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Compass, ExternalLink, LifeBuoy, MousePointer2, Satellite, Wrench } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Help — Glass Earth',
  description:
    'Glass Earth help in plain words: how to get around the live planet, and what to try if the map looks blank, slow or frozen.',
  alternates: { canonical: '/help' },
};

/**
 * A short, friendly help page for visitors — the basics of getting around,
 * plus the fixes for the problems people actually hit. Feature names are the
 * ones the app itself shows. The blank-map advice reflects how the map is
 * really served: base-map pictures come from CARTO (basemaps.cartocdn.com)
 * and the satellite view from Esri (server.arcgisonline.com), so a blocker
 * that stops one host can blank one view and not the other.
 */

function Section({ id, title, intro, children }: { id: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="mt-14 scroll-mt-8">
      <h2 className="text-lg font-semibold tracking-wide">{title}</h2>
      {intro && <p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">{intro}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Basics({ items }: { items: { lead: string; body: string }[] }) {
  return (
    <ul className="flex flex-col gap-3.5">
      {items.map(i => (
        <li key={i.lead} className="flex gap-3 text-sm leading-relaxed text-[var(--text-muted)]">
          <MousePointer2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--gold-light)]" />
          <span><span className="font-medium text-[var(--text-primary)]">{i.lead}</span> — {i.body}</span>
        </li>
      ))}
    </ul>
  );
}

function Fix({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border-primary)] bg-white/[0.02] p-5">
      <h3 className="flex items-center gap-2.5 text-[14px] font-semibold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cyan-primary)]/10 text-[var(--cyan-primary)]">
          <Wrench className="h-4 w-4" />
        </span>
        {title}
      </h3>
      <div className="mt-3 text-[13.5px] leading-relaxed text-[var(--text-muted)]">{children}</div>
    </div>
  );
}

export default function HelpPage() {
  return (
    // docs-root releases the full-screen map's scroll lock (see globals.css), so the page scrolls.
    <main className="docs-root min-h-screen bg-[var(--bg-primary)] px-5 py-14 text-[var(--text-primary)] sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="font-mono text-[11px] tracking-widest text-[var(--text-muted)] hover:text-[var(--cyan-primary)]">
          ← GLASS EARTH
        </Link>

        <header className="mt-8">
          <p className="font-mono text-[11px] tracking-[0.25em] text-[var(--gold-primary)]">HELP</p>
          <h1 className="mt-2 text-3xl font-bold tracking-wide sm:text-4xl">Help, in plain words</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-[var(--text-muted)]">
            Glass Earth is the live planet on one globe — 69,000+ live cameras, live flights and satellites, ships,
            weather, live TV and radio — and it opens on your location. It is free, and there is no sign-up. See
            everything. Miss nothing.
          </p>
        </header>

        <Section id="getting-around" title="Getting around">
          <Basics items={[
            { lead: 'Move the planet', body: 'drag to spin it, scroll or pinch to zoom. It is a real globe — keep dragging and you will come all the way around.' },
            { lead: 'Layers', body: 'the buttons down the side switch features on and off — flights, satellites, cameras, ships, weather, rocket launches and more. Turn on only what you want to look at, or turn everything on and explore.' },
            { lead: '3D / 2D / MAP / SAT', body: 'the buttons at the bottom-left switch the view: a 3D globe, a flat 2D map, the street map, or satellite pictures of the ground.' },
            { lead: 'Search', body: 'type a place name to fly straight there.' },
            { lead: 'Take me somewhere live', body: 'one tap drops you on a random live camera somewhere in the world. You never know where you will land — that is the fun of it.' },
            { lead: 'Look Up!', body: 'shows the times satellites and the space station pass over your location, so you know when to step outside and look up. A pass time is when to watch — clouds and daylight still get a vote.' },
            { lead: 'Tap anything', body: 'click a plane, a ship or a camera marker for its details. On a flight you will find “Ride in the Cockpit”, which puts you in the seat as it flies, with the real ground sliding underneath.' },
            { lead: 'Sunrise Chaser', body: 'finds places where dawn is breaking right now, and the cameras there to watch it with.' },
          ]} />
        </Section>

        <Section id="troubleshooting" title="If something looks wrong"
          intro="Most problems are one of these three, and most fixes take a few seconds. Try them in order.">
          <div className="flex flex-col gap-3">
            <Fix title="The map is blank or white — the planet never appears">
              <p>
                If the rest of the site loads (the counters, the buttons, the text) but the Earth itself stays a pale
                glow, the map pictures are not reaching you. They load from a map service
                (<span className="font-mono text-[12.5px]">basemaps.cartocdn.com</span>), and an ad blocker or privacy
                extension, a VPN, or a filtered work or school network can block that one address while letting
                everything else through.
              </p>
              <ul className="mt-3 flex list-disc flex-col gap-2 pl-5">
                <li><span className="text-[var(--text-primary)]">Hard refresh:</span> hold Cmd+Shift and press R (on Windows, Ctrl+Shift+R).</li>
                <li><span className="text-[var(--text-primary)]">Click SAT</span> at the bottom-left. Satellite view uses a different service — if the planet appears there, the regular map source is the one being blocked, and you can keep exploring in SAT view.</li>
                <li><span className="text-[var(--text-primary)]">Turn off ad blockers</span> or privacy extensions for glassearthlive.com, then refresh.</li>
                <li><span className="text-[var(--text-primary)]">Disconnect your VPN</span> if you use one, then refresh.</li>
                <li><span className="text-[var(--text-primary)]">Try a Private or Incognito window</span> — that rules out extensions and old saved files in one go.</li>
              </ul>
            </Fix>

            <Fix title="It feels slow or stuttering">
              <p>
                Glass Earth moves a lot of live data at once. Turning off a few layers you are not looking at (in the
                side panel) makes the biggest difference. A current desktop browser — Chrome, Edge, Firefox or
                Safari — gives the smoothest ride, and closing other heavy tabs helps too.
              </p>
            </Fix>

            <Fix title="The numbers look frozen">
              <p>
                Each feed updates on its own timer, so a quiet minute is normal — planes, ships and counters refresh in
                their own rhythm. If something truly seems stuck, one refresh restarts every feed.
              </p>
            </Fix>
          </div>
        </Section>

        <Section id="still-stuck" title="Still stuck?">
          <p className="flex gap-3 text-sm leading-relaxed text-[var(--text-muted)]">
            <LifeBuoy className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--gold-light)]" />
            <span>
              The <Link href="/docs" className="text-[var(--cyan-primary)] hover:underline">Docs page</Link> has the
              full reference — every feature and layer explained. And if you have found a real bug, telling us about
              it is the fastest way to get it fixed:
            </span>
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            <a href="https://github.com/RetroRix/GlassEarth/issues" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-primary)] px-3.5 py-2 text-[13px] hover:border-[var(--cyan-primary)] hover:text-[var(--cyan-primary)]">
              <ExternalLink className="h-4 w-4" /> Open an issue on GitHub
            </a>
            <Link href="/docs"
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-primary)] px-3.5 py-2 text-[13px] hover:border-[var(--cyan-primary)] hover:text-[var(--cyan-primary)]">
              <Compass className="h-4 w-4" /> Read the Docs
            </Link>
            <span className="inline-flex items-center gap-2 px-1 py-2 text-[13px] text-[var(--text-muted)]">
              <Satellite className="h-4 w-4" /> See everything. Miss nothing.
            </span>
          </div>
        </Section>
      </div>
    </main>
  );
}
