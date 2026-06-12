// Seeded, deterministic RNG so every scenario is reproducible and batch runs
// are repeatable. mulberry32 is small, fast, and good enough for simulation.
(function (root) {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Hash a string seed into a 32-bit integer (xmur3) so users can type words.
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function makeRng(seed) {
    const n = typeof seed === "string" ? hashSeed(seed) : seed >>> 0;
    const next = mulberry32(n);
    return {
      seed: n,
      next, // float in [0,1)
      range: (lo, hi) => lo + (hi - lo) * next(),
      int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
      chance: (p) => next() < p,
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      // Gaussian via Box-Muller, used for stat jitter.
      gauss: (mean, sd) => {
        const u = 1 - next();
        const v = next();
        return (
          mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
        );
      },
    };
  }

  root.Flux = root.Flux || {};
  root.Flux.makeRng = makeRng;
  root.Flux.hashSeed = hashSeed;
})(typeof self !== "undefined" ? self : this);
