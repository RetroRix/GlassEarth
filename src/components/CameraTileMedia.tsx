'use client';

import { useEffect, useRef, useState } from 'react';
import { CameraOff, PauseCircle } from 'lucide-react';
import { freshen, refreshInterval } from '@/lib/camera-preview';
import { wallMedia, type WallCamera } from '@/lib/theater-wall';

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
 */

const FIT = 'h-full w-full object-cover';

function SnapshotMedia({ url, kind, name, onFail }: { url: string; kind: 'jpg' | 'mjpeg'; name: string; onFail: () => void }) {
  const every = refreshInterval(kind);
  const [src, setSrc] = useState(() => (every ? freshen(url) : url));

  useEffect(() => {
    if (!every) return;
    /* Staggered, so a wall of tiles does not hit its origins on one tick. */
    let interval: ReturnType<typeof setInterval> | undefined;
    const first = setTimeout(() => {
      setSrc(freshen(url));
      interval = setInterval(() => setSrc(freshen(url)), every);
    }, every + Math.random() * 3000);
    return () => {
      clearTimeout(first);
      if (interval) clearInterval(interval);
    };
  }, [url, every]);

  return (
    /* eslint-disable-next-line @next/next/no-img-element -- remote camera frames, no loader */
    <img src={src} alt={name} className={FIT} onError={onFail} draggable={false} />
  );
}

function VideoMedia({ url, kind, onFail }: { url: string; kind: 'mp4' | 'hls'; onFail: () => void }) {
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

  return <video ref={ref} className={FIT} muted playsInline loop autoPlay preload="auto" onError={onFail} />;
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

export default function CameraTileMedia({ cam, playVideo = true }: { cam: WallCamera; playVideo?: boolean }) {
  const [failed, setFailed] = useState(false);
  const media = wallMedia(cam);
  const name = cam.name ?? 'CAMERA';

  /* Each tile is keyed by camera id by its parents, so a slot changing hands
     remounts this component — no failure state leaks between cameras. */
  if (failed) {
    return <Still icon={<CameraOff className="h-5 w-5 text-white/35" />} title="Feed unavailable" sub="Open in the viewer to retry" />;
  }
  if (!media) {
    return <Still icon={<CameraOff className="h-5 w-5 text-white/35" />} title="No direct feed" sub="This camera opens in the full viewer" />;
  }

  const isVideo = media.kind === 'mp4' || media.kind === 'hls' || media.kind === 'iframe';
  if (isVideo && !playVideo) {
    /* Held back by the decoder budget: a snapshot if the camera publishes
       one, a labelled still if it does not. */
    if (cam.feed_url) {
      return <SnapshotMedia url={cam.feed_url} kind="jpg" name={name} onFail={() => setFailed(true)} />;
    }
    return <Still icon={<PauseCircle className="h-5 w-5 text-white/35" />} title="Video held" sub="Focus this tile to play it" />;
  }

  if (media.kind === 'jpg' || media.kind === 'mjpeg') {
    return <SnapshotMedia url={media.url} kind={media.kind} name={name} onFail={() => setFailed(true)} />;
  }
  if (media.kind === 'mp4' || media.kind === 'hls') {
    return <VideoMedia url={media.url} kind={media.kind} onFail={() => setFailed(true)} />;
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
