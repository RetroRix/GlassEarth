'use client';

import { useEffect, useState } from 'react';
import { FEED_STALE_AFTER_MS, describeDataAge, type FeedKey } from '@/lib/data-age';

/**
 * The data-age chip: one shared surface so every data card states the
 * age of what it shows the same way. `fetchedAt` is a real timestamp the
 * app holds (when the feed last answered, or a frame's own time); pass
 * null and the chip honestly says AGE UNKNOWN. Ticks every 30 s so a
 * card left open watches its own data go stale.
 */
export default function DataAge({ label, fetchedAt, feed }: {
  /** Short feed name printed before the age, e.g. "FLIGHTS". */
  label: string;
  fetchedAt: number | null | undefined;
  feed: FeedKey;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const info = describeDataAge(fetchedAt, now, FEED_STALE_AFTER_MS[feed]);
  const color = info.state === 'stale'
    ? '#FFB74D'
    : info.state === 'unknown'
      ? 'rgba(255,255,255,0.3)'
      : 'rgba(255,255,255,0.45)';
  const title = typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && fetchedAt > 0
    ? `Data as of ${new Date(fetchedAt).toLocaleString()}`
    : 'This feed carries no timestamp the app can show';

  return (
    <span
      className="font-mono text-[8px] uppercase tracking-wider"
      style={{ color }}
      title={title}
      data-testid={`data-age-${feed}`}
    >
      {label} · {info.label}
    </span>
  );
}
