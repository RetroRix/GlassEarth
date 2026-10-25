/**
 * Glass Earth — placeholder snapshot detection.
 *
 * Some cameras' "snapshot" is not a highway frame at all: the agency serves
 * its own placeholder graphic at the camera's snapshot URL — Caltrans'
 * "Temporarily Unavailable" / "Down for Construction", WSDOT's "This image
 * is currently unavailable". The badge calls those LIVE STILL with a fresh
 * age, because the age resets on each re-fetch of the placeholder — the same
 * dishonesty the badges exist to kill.
 *
 * Detection is a 16x16 average hash (aHash) of the frame, compared against
 * the known placeholder artworks. The hash is computed over a 16x16
 * greyscale downscale, so the timestamp digits Caltrans burns into the
 * graphic move it by only a few bits, while a real frame sits far away.
 *
 * Measured on 55 captured frames (2026-10-24, sharp 16x16 downscale):
 *   known placeholder variants — distance 0–4 from their signature
 *   nearest real frame        — distance 89 from every signature
 * The threshold of 16 sits in the empty gap between them: generous to
 * unseen crops/sizes of the same artworks, nowhere near a real frame.
 *
 * The signatures below are the sharp-computed hashes of the captured
 * artworks — the server route must use the same downscale (sharp
 * resize(16, 16, fit fill) + greyscale) or the distances shift. They are
 * kept as hex because a 256-bit hash does not fit in a JS number; BigInt
 * carries it.
 *
 * Limits, stated plainly:
 * - A placeholder artwork never seen before does not match, and keeps
 *   wearing LIVE STILL. A new signature has to be captured and added.
 * - The check sees the image as fetched at check time, not the frame on
 *   screen: a camera that went down seconds ago can read UNAVAILABLE
 *   while its last real frame is still displayed, and vice versa. Both
 *   heal on the next snapshot refresh.
 * - This says nothing about a frozen real camera: a frame that stopped
 *   updating but is not a placeholder still wears LIVE STILL with its age.
 */

export const PLACEHOLDER_HASH_SIZE = 16;

/** Bits of hash distance that still count as the same artwork. */
export const PLACEHOLDER_HASH_THRESHOLD = 16;

/** A known placeholder artwork, as a 16x16 average hash. */
export interface PlaceholderSignature {
  name: string;
  hash: bigint;
}

export const PLACEHOLDER_SIGNATURES: ReadonlyArray<PlaceholderSignature> = [
  {
    name: 'caltrans-temporarily-unavailable',
    hash: BigInt('0xffffffffffffffffffffc007e003ffffc007e003fffffffffffffffffffe0000'),
  },
  {
    name: 'caltrans-down-for-construction-320',
    hash: BigInt('0xfffffffffffffffffffff00ff00fffffc003c003fffffffffffffffffffe0000'),
  },
  {
    name: 'caltrans-down-for-construction-432',
    hash: BigInt('0xfffffffffffffffffffff81ff81fffffe007e007ffffffffffffffffffff0000'),
  },
  {
    name: 'wsdot-unavailable-airport',
    hash: BigInt('0xffffffffffffffffe001cc018201a001a0018001cc01e001ffffffffffffffff'),
  },
  {
    name: 'wsdot-unavailable-highway',
    hash: BigInt('0xffffffffe083c001cc018e01a001a001a0018a019c01c801e201ffffffff3fed'),
  },
];

/**
 * The average hash of a 16x16 greyscale frame, row-major, one byte per
 * cell. A cell reads 1 when it is at or above the frame's mean brightness.
 * The bit order (cell 0 = most significant bit) only matters for
 * consistency with the stored signatures — never compare hashes made by
 * different orders.
 */
export function averageHashFromGrayscale(values: ReadonlyArray<number>): bigint {
  const n = PLACEHOLDER_HASH_SIZE * PLACEHOLDER_HASH_SIZE;
  if (values.length !== n) {
    throw new Error(`average hash needs ${n} greyscale values, got ${values.length}`);
  }
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / n;
  let hash = BigInt(0);
  for (let i = 0; i < n; i++) {
    if (values[i] >= mean) hash |= BigInt(1) << BigInt(n - 1 - i);
  }
  return hash;
}

/** How many bits differ between two hashes. */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & BigInt(1));
    x >>= BigInt(1);
  }
  return n;
}

export interface PlaceholderDistance {
  /** Bits to the nearest known placeholder artwork. */
  distance: number;
  /** Which artwork matched, or null when none is within threshold. */
  signature: string | null;
}

/** Distance from a frame's hash to the nearest known placeholder artwork. */
export function placeholderDistance(hash: bigint): PlaceholderDistance {
  let best: PlaceholderDistance = { distance: Number.POSITIVE_INFINITY, signature: null };
  for (const sig of PLACEHOLDER_SIGNATURES) {
    const d = hammingDistance(hash, sig.hash);
    if (d < best.distance) best = { distance: d, signature: sig.name };
  }
  return best;
}

/**
 * Whether a frame's hash is one of the known placeholder artworks.
 * Anything undecodable or unrecognised is not a placeholder — the safe
 * direction is to keep the LIVE STILL badge, never to invent UNAVAILABLE.
 */
export function isPlaceholderHash(
  hash: bigint,
  threshold: number = PLACEHOLDER_HASH_THRESHOLD,
): { placeholder: boolean; distance: number; signature: string | null } {
  const { distance, signature } = placeholderDistance(hash);
  return { placeholder: distance <= threshold, distance, signature: distance <= threshold ? signature : null };
}
