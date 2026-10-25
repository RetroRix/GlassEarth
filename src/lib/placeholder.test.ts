import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';
import {
  averageHashFromGrayscale,
  hammingDistance,
  isPlaceholderHash,
  placeholderDistance,
  PLACEHOLDER_HASH_SIZE,
  PLACEHOLDER_HASH_THRESHOLD,
  PLACEHOLDER_SIGNATURES,
} from './placeholder';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'placeholder');

/** The production hash path: sharp 16x16 greyscale downscale, then the pure hash. */
async function hashFixture(name: string): Promise<bigint> {
  const gray = await sharp(path.join(FIXTURES, name))
    .resize(PLACEHOLDER_HASH_SIZE, PLACEHOLDER_HASH_SIZE, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer();
  return averageHashFromGrayscale([...gray]);
}

describe('averageHashFromGrayscale', () => {
  it('needs exactly 256 greyscale values', () => {
    expect(() => averageHashFromGrayscale(new Array(255).fill(0))).toThrow();
    expect(() => averageHashFromGrayscale(new Array(257).fill(0))).toThrow();
  });

  it('marks cells at or above the mean', () => {
    // Top half black, bottom half white: mean 127.5, so the top half reads
    // 0 and the bottom half reads 1.
    const values = [...new Array(128).fill(0), ...new Array(128).fill(255)];
    const hash = averageHashFromGrayscale(values);
    expect(hash).toBe((BigInt(1) << BigInt(128)) - BigInt(1));
  });

  it('reads a uniform frame as all ones', () => {
    const hash = averageHashFromGrayscale(new Array(256).fill(200));
    expect(hash).toBe((BigInt(1) << BigInt(256)) - BigInt(1));
  });
});

describe('hammingDistance', () => {
  it('counts differing bits', () => {
    expect(hammingDistance(BigInt('0b1010'), BigInt('0b1000'))).toBe(1);
    expect(hammingDistance(BigInt(0), (BigInt(1) << BigInt(256)) - BigInt(1))).toBe(256);
  });
});

describe('placeholder detection against captured samples', () => {
  // The five fixtures these signatures were taken from must hash to
  // distance 0 — a transcription slip in a signature constant fails here
  // rather than silently widening the match.
  it.each([
    ['caltrans-temporarily-unavailable.jpg', 'caltrans-temporarily-unavailable'],
    ['caltrans-down-for-construction-320.jpg', 'caltrans-down-for-construction-320'],
    ['caltrans-down-for-construction-432.jpg', 'caltrans-down-for-construction-432'],
    ['wsdot-unavailable-airport.jpg', 'wsdot-unavailable-airport'],
    ['wsdot-unavailable-highway.jpg', 'wsdot-unavailable-highway'],
  ])('signature source %s hashes to distance 0', async (file, name) => {
    const hash = await hashFixture(file);
    const { distance, signature } = placeholderDistance(hash);
    expect(distance).toBe(0);
    expect(signature).toBe(name);
  });

  it('catches a placeholder variant a few bits from its signature', async () => {
    // A second fetch of the same artwork, different timestamp digits.
    const hash = await hashFixture('caltrans-temporarily-unavailable-variant.jpg');
    const { placeholder, distance } = isPlaceholderHash(hash);
    expect(placeholder).toBe(true);
    expect(distance).toBeLessThanOrEqual(PLACEHOLDER_HASH_THRESHOLD);
  });

  it('never calls a real frame a placeholder', async () => {
    // The nearest real frame measured anywhere in the 55-frame sample
    // sits 89 bits from every signature; the threshold is 16.
    for (const file of [
      'real-wsdot-i82-horse-heaven.jpg',
      'real-caltrans-hwy5-cosumnes.jpg',
      'real-wsdot-i5-dusk.jpg',
    ]) {
      const hash = await hashFixture(file);
      const { placeholder, distance } = isPlaceholderHash(hash);
      expect(placeholder).toBe(false);
      expect(distance).toBeGreaterThan(PLACEHOLDER_HASH_THRESHOLD * 3);
    }
  });

  it('keeps five signatures on file', () => {
    expect(PLACEHOLDER_SIGNATURES).toHaveLength(5);
  });
});
