'use client';

import { useEffect, useRef } from 'react';
import { LOOK_MEDIA_CLASS } from '@/lib/sensor-looks';

/**
 * Glass Earth — one HLS stream in a <video>, the stations edition.
 *
 * The attach order is the camera tiles' (lib/theater-wall / CameraViewer):
 * hls.js first, native HLS only as fallback, because Chrome answers
 * canPlayType 'maybe' for HLS it cannot actually decode. Imported lazily
 * so panels that never play a channel never pay for the decoder.
 *
 * Failure is a callback, not a black box: a fatal hls.js error, a media
 * error, or a browser with no HLS path at all all land in `onFatal`, and
 * the parent renders its honest "unavailable" card. Streams are played
 * straight from the broadcaster's CDN — nothing is proxied, and a stream
 * that demands a referrer this page cannot send will fail here and be
 * labelled, by design.
 */

interface HlsPlayerProps {
  url: string;
  muted?: boolean;
  autoPlay?: boolean;
  className?: string;
  onFatal: () => void;
  onPlaying?: () => void;
}

export default function HlsPlayer({ url, muted = false, autoPlay = true, className, onFatal, onPlaying }: HlsPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);
  /* Parents key this component by URL, so callbacks can be read fresh from
     refs without re-attaching the stream when a parent re-renders. */
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const playingRef = useRef(onPlaying);
  playingRef.current = onPlaying;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;

    import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !ref.current) return;
      if (!Hls.isSupported()) {
        if (ref.current.canPlayType('application/vnd.apple.mpegurl')) {
          ref.current.src = url;
          if (autoPlay) ref.current.play().catch(() => { /* the poster/label still shows */ });
        } else {
          fatalRef.current();
        }
        return;
      }
      const instance = new Hls({ enableWorker: false, maxBufferLength: 20 });
      hls = instance;
      instance.on(Hls.Events.ERROR, (_e, data) => { if (data.fatal) fatalRef.current(); });
      instance.loadSource(url);
      instance.attachMedia(ref.current);
      if (autoPlay) ref.current.play().catch(() => { /* autoplay refused: first frame still lands */ });
    }).catch(() => fatalRef.current());

    return () => { cancelled = true; hls?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <video
      ref={ref}
      className={`${className ?? 'h-full w-full bg-black'} ${LOOK_MEDIA_CLASS}`}
      muted={muted}
      playsInline
      autoPlay={autoPlay}
      preload="auto"
      onPlaying={() => playingRef.current?.()}
      onError={() => fatalRef.current()}
    />
  );
}
