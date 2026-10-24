'use client';

import { useEffect, useRef, useState } from 'react';
import { CameraOff, PauseCircle } from 'lucide-react';
import { freshen, refreshInterval } from '@/lib/camera-preview';
import { wallMedia, type WallCamera, type WallMediaKind } from '@/lib/theater-wall';
import './CameraTileMedia.css';

/**
 * Glass Earth — one camera, rendered inside a theater tile.
 *
 * The media rules are the map previews' (lib/camera-preview via
 * lib/theater-wall): snapshots re-request on their kind's cadence, MP4 clips
 * re-point rarely, HLS and MJPEG are continuous and are never re-pointed.
 * What the wall adds is direct iframe embeds, which the map tiles refuse on
 * frame-budget grounds and a wall exists precisely to afford.
 *
 * `playVideo={false}` is the wall's decoder rationing: a video camera held
 * back shows its snapshot if it publishes one, and a labelled still if not.
 * Focusing the tile is what plays it.
 *
 * `variant="ambient"` is Ambient TV's gentler treatment of the same media,
 * and changes nothing for the wall: the frame is shown whole
 * (object-contain) over a blurred blow-up of itself instead of being
 * cropped to fill, snapshot refreshes crossfade instead of jump-cutting,
 * and stills drift with a slow Ken Burns pan so a 45-second scene feels
 * alive. Iframe embeds are exempt in both variants — an embed letterboxes
 * itself, and its player is the picture.
 */

const FIT = 'h-full w-full object-cover';
const AMBIENT_FIT = 'h-full w-full object-contain';

/** How long an Ambient snapshot takes to crossfade into its successor. */
const SNAP_FADE_MS = 900;

function SnapshotMedia({ url, kind, name, onFail, imgClassName = FIT, crossfade = false, kenBurns = false }: {
  url: string;
  kind: 'jpg' | 'mjpeg';
  name: string;
  onFail: () => void;
  imgClassName?: string;
  crossfade?: boolean;
  kenBurns?: boolean;
}) {
  const every = refreshInterval(kind);
  const [front, setFront] = useState(() => (every ? freshen(url) : url));
  /* Crossfade state: the frame arriving next, and whether it has loaded
     enough to start fading in over the current one. */
  const [back, setBack] = useState<string | null>(null);
  const [backIn, setBackIn] = useState(false);

  useEffect(() => {
    if (!every) return;
    /* Staggered, so a wall of tiles does not hit its origins on one tick. */
    let interval: ReturnType<typeof setInterval> | undefined;
    const arrive = () => {
      const next = freshen(url);
      /* A hard swap jump-cuts between photographs; Ambient instead parks
         the new frame in the back slot and fades it in once it loads. */
      if (crossfade) { setBack(next); setBackIn(false); }
      else setFront(next);
    };
    const first = setTimeout(() => {
      arrive();
      interval = setInterval(arrive, every);
    }, every + Math.random() * 3000);
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, [url, every, crossfade]);

  /* Once the incoming frame has faded in, it becomes the frame of record
     and the back slot empties for the next arrival. */
  useEffect(() => {
    if (!back || !backIn) return;
    const t = setTimeout(() => {
      setFront(back);
      setBack(null);
      setBackIn(false);
    }, SNAP_FADE_MS + 100);
    return () => clearTimeout(t);
  }, [back, backIn]);

  if (!crossfade) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element -- remote camera frames, no loader */
      <img src={front} alt={name} className={imgClassName} onError={onFail} draggable={false} />
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div className={`absolute inset-0 ${kenBurns ? 'ambient-kenburns' : ''}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote camera frames, no loader */}
        <img src={front} alt={name} className={`${imgClassName} absolute inset-0`} onError={onFail} draggable={false} />
        {back && (
          /* eslint-disable-next-line @next/next/no-img-element -- remote camera frames, no loader */
          <img
            src={back}
            alt=""
            aria-hidden
            className={`${imgClassName} absolute inset-0 transition-opacity ease-in-out`}
            style={{ opacity: backIn ? 1 : 0, transitionDuration: `${SNAP_FADE_MS}ms` }}
            onLoad={() => setBackIn(true)}
            /* A frame that fails to arrive is simply skipped — the one on
               screen stays up, and the next refresh tries again. */
            onError={() => { setBack(null); setBackIn(false); }}
            draggable={false}
          />
        )}
      </div>
    </div>
  );
}

function VideoMedia({ url, kind, onFail, fitClass = FIT }: { url: string; kind: 'mp4' | 'hls'; onFail: () => void; fitClass?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  /* MP4 clips are short and loop, so they go stale; re-pointing refreshes
     them. HLS is already live and refreshInterval says 0 for it. */
  const [cacheBust, setCacheBust] = useState(0);
  const every = refreshInterval(kind);

  useEffect(() => {
    if (!every) return;
    const t = setInterval(() => setCacheBust(n => n + 1), every + Math.random() * 4000);
    return () => clearInterval(t);
  }, [every]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (kind === 'mp4') {
      el.src = cacheBust ? freshen(url) : url;
      el.play().catch(() => { /* autoplay refused: the frame still shows */ });
      return;
    }

    /* HLS: hls.js first, native only as fallback — the same order the full
       viewer and the map previews use, for the same reason (Chrome answers
       canPlayType 'maybe' for HLS it cannot actually decode). Imported lazily:
       most tiles never need a decoder. */
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !ref.current) return;
      if (!Hls.isSupported()) {
        if (ref.current.canPlayType('application/vnd.apple.mpegurl')) {
          ref.current.src = url;
          ref.current.play().catch(() => {});
        } else {
          onFail();
        }
        return;
      }
      const instance = new Hls({ enableWorker: false, maxBufferLength: 10 });
      hls = instance;
      instance.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) onFail(); });
      instance.loadSource(url);
      instance.attachMedia(ref.current);
      ref.current.play().catch(() => {});
    }).catch(onFail);

    return () => { cancelled = true; hls?.destroy(); };
  }, [kind, url, cacheBust, onFail]);

  return <video ref={ref} className={fitClass} muted playsInline loop autoPlay preload="auto" onError={onFail} />;
}

function Still({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-[#050505] px-3 text-center">
      {icon}
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{title}</span>
      <span className="font-mono text-[8px] uppercase tracking-[0.15em] text-white/30">{sub}</span>
    </div>
  );
}

/**
 * Ambient framing: the camera's own snapshot, blurred and blown up behind
 * the real frame. The frame up front is shown whole — nothing cropped, the
 * zoom complaint gone — and the backdrop fills the leftover screen with
 * the scene's own colours instead of black bars. A backdrop that fails or
 * was never published just leaves black; the frame in front is the show.
 */
function AmbientBackdrop({ cam, media, children }: {
  cam: WallCamera;
  media: { kind: WallMediaKind; url: string };
  children: React.ReactNode;
}) {
  const [gone, setGone] = useState(false);
  const feed = typeof cam.feed_url === 'string' ? cam.feed_url.trim() : '';
  const backdropUrl = feed || (media.kind === 'jpg' ? media.url : '');
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {backdropUrl && !gone && (
        <SnapshotMedia
          url={backdropUrl}
          kind="jpg"
          name=""
          onFail={() => setGone(true)}
          imgClassName="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-2xl"
        />
      )}
      <div className="absolute inset-0">{children}</div>
    </div>
  );
}

export default function CameraTileMedia({ cam, playVideo = true, variant = 'tile' }: {
  cam: WallCamera;
  playVideo?: boolean;
  variant?: 'tile' | 'ambient';
}) {
  const [failed, setFailed] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const media = wallMedia(cam);
  const name = cam.name ?? 'CAMERA';
  const ambient = variant === 'ambient';
  const fit = ambient ? AMBIENT_FIT : FIT;

  /* Each tile is keyed by camera id by its parents, so a slot changing hands
     remounts this component — no failure state leaks between cameras. */
  if (failed) {
    return <Still icon={<CameraOff className="h-5 w-5 text-white/35" />} title="Feed unavailable" sub="Open in the viewer to retry" />;
  }
  if (!media) {
    return <Still icon={<CameraOff className="h-5 w-5 text-white/35" />} title="No direct feed" sub="This camera opens in the full viewer" />;
  }

  /* A dead stream degrades to the snapshot when one exists — a stale Caltrans
     stream name still shows a picture. Only a camera with nothing to show at
     all goes blank. */
  if (degraded && cam.feed_url) {
    const el = (
      <SnapshotMedia url={cam.feed_url} kind="jpg" name={name} onFail={() => setFailed(true)} imgClassName={fit} crossfade={ambient} kenBurns={ambient} />
    );
    return ambient ? <AmbientBackdrop cam={cam} media={media}>{el}</AmbientBackdrop> : el;
  }

  const isVideo = media.kind === 'mp4' || media.kind === 'hls' || media.kind === 'iframe';
  if (isVideo && !playVideo) {
    /* Held back by the decoder budget: a snapshot if the camera publishes
       one, a labelled still if it does not. */
    if (cam.feed_url) {
      return <SnapshotMedia url={cam.feed_url} kind="jpg" name={name} onFail={() => setFailed(true)} imgClassName={fit} crossfade={ambient} kenBurns={ambient} />;
    }
    return <Still icon={<PauseCircle className="h-5 w-5 text-white/35" />} title="Video held" sub="Focus this tile to play it" />;
  }

  if (media.kind === 'jpg' || media.kind === 'mjpeg') {
    const el = (
      <SnapshotMedia
        url={media.url}
        kind={media.kind}
        name={name}
        onFail={() => setFailed(true)}
        imgClassName={fit}
        crossfade={ambient}
        kenBurns={ambient && media.kind === 'jpg'}
      />
    );
    return ambient ? <AmbientBackdrop cam={cam} media={media}>{el}</AmbientBackdrop> : el;
  }
  if (media.kind === 'mp4' || media.kind === 'hls') {
    const el = <VideoMedia url={media.url} kind={media.kind} onFail={() => { if (cam.feed_url) setDegraded(true); else setFailed(true); }} fitClass={fit} />;
    return ambient ? <AmbientBackdrop cam={cam} media={media}>{el}</AmbientBackdrop> : el;
  }
  return (
    <iframe
      src={media.url}
      title={name}
      className="h-full w-full border-0"
      allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
      allowFullScreen
      onError={() => setFailed(true)}
    />
  );
}
