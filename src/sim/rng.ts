/** Small deterministic PRNG (mulberry32) so runs and tests are reproducible. */
export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  int(min: number, maxInclusive: number): number;
  chance(p: number): boolean;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, maxInclusive) => min + Math.floor(next() * (maxInclusive - min + 1)),
    chance: (p) => next() < p,
  };
}
