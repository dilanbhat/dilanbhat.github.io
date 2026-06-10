/* ====================================================================
 * utils.js  —  math, RNG, vectors, color helpers
 * ==================================================================== */

const Utils = (() => {
  // Seedable RNG (mulberry32) so runs can be reproduced if desired.
  let _seed = (Math.random() * 4294967296) >>> 0;
  function setSeed(s) { _seed = (s >>> 0) || 1; }
  function rand() {
    _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const randRange = (a, b) => a + rand() * (b - a);
  const randInt = (a, b) => Math.floor(randRange(a, b + 1));
  // Gaussian via Box-Muller, used for mutations.
  function randn(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (x1, y1, x2, y2) => {
    const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy;
  };
  const TAU = Math.PI * 2;
  // Wrap an angle into [-PI, PI].
  function wrapAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }
  // Activation functions for the brain.
  const tanh = Math.tanh;
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  // HSL -> CSS string helper.
  const hsl = (h, s, l, a = 1) =>
    `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;

  return {
    setSeed, rand, randRange, randInt, randn, clamp, lerp,
    dist2, wrapAngle, tanh, sigmoid, hsl, TAU,
  };
})();
