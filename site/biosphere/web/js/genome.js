/* ====================================================================
 * genome.js  —  heritable physical traits that co-evolve with the brain
 *
 * Each gene is normalized 0..1 internally; getters map to real units.
 * `diet` is a continuum: 0 = pure herbivore, 1 = pure carnivore.
 * ==================================================================== */

const GENE_DEFS = {
  size:        { min: 0.45, max: 2.2,  label: 'Size' },
  speed:       { min: 0.4,  max: 2.4,  label: 'Speed' },
  vision:      { min: 30,   max: 220,  label: 'Vision range' },
  fov:         { min: 0.6,  max: 2.8,  label: 'Field of view' },
  metabolism:  { min: 0.5,  max: 1.8,  label: 'Metabolism' },
  diet:        { min: 0,    max: 1,    label: 'Diet (herb→carn)' },
  aggression:  { min: 0,    max: 1,    label: 'Aggression' },
  reproEnergy: { min: 90,   max: 320,  label: 'Reproduce at' },
  fertility:   { min: 0.2,  max: 1,    label: 'Fertility' },
  hue:         { min: 0,    max: 360,  label: 'Hue' },
  mutability:  { min: 0.01, max: 0.25, label: 'Mutability' },
};

const GENE_KEYS = Object.keys(GENE_DEFS);

class Genome {
  constructor(genes) {
    // genes: {key: normalized 0..1}
    this.g = genes || {};
    if (!genes) for (const k of GENE_KEYS) this.g[k] = Utils.rand();
  }

  // Real-unit value of a gene.
  val(key) {
    const d = GENE_DEFS[key];
    return Utils.lerp(d.min, d.max, this.g[key]);
  }
  norm(key) { return this.g[key]; }

  static randomHerbivore() {
    const g = {};
    for (const k of GENE_KEYS) g[k] = Utils.rand();
    g.diet = Utils.randRange(0, 0.25);
    g.aggression = Utils.randRange(0, 0.3);
    g.size = Utils.randRange(0.2, 0.5);
    return new Genome(g);
  }
  static randomCarnivore() {
    const g = {};
    for (const k of GENE_KEYS) g[k] = Utils.rand();
    g.diet = Utils.randRange(0.75, 1);
    g.aggression = Utils.randRange(0.6, 1);
    g.size = Utils.randRange(0.5, 0.85);
    g.speed = Utils.randRange(0.55, 1);
    return new Genome(g);
  }

  clone() { return new Genome({ ...this.g }); }

  mutate(rate, amount) {
    for (const k of GENE_KEYS) {
      if (Utils.rand() < rate) {
        // hue drifts circularly; others clamp 0..1
        let v = this.g[k] + Utils.randn(0, amount);
        if (k === 'hue') v = ((v % 1) + 1) % 1;
        else v = Utils.clamp(v, 0, 1);
        this.g[k] = v;
      }
    }
    return this;
  }

  static crossover(a, b) {
    const g = {};
    for (const k of GENE_KEYS) g[k] = Utils.rand() < 0.5 ? a.g[k] : b.g[k];
    return new Genome(g);
  }

  // Genetic distance (0..1ish) used to label species clusters.
  static distance(a, b) {
    let s = 0;
    for (const k of GENE_KEYS) {
      let d = Math.abs(a.g[k] - b.g[k]);
      if (k === 'hue') d = Math.min(d, 1 - d);
      s += d * d;
    }
    return Math.sqrt(s / GENE_KEYS.length);
  }

  toJSON() { return { ...this.g }; }
  static fromJSON(o) { return new Genome({ ...o }); }
}
