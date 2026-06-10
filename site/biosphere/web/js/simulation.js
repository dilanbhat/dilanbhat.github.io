/* ====================================================================
 * simulation.js  —  orchestrates world + creatures, collects stats,
 *                   clusters species, handles save/load & respawn.
 * ==================================================================== */

const SEASONS = [
  { name: 'Spring', food: 1.35, drain: 0.95, tint: '#3a6e3a' },
  { name: 'Summer', food: 1.05, drain: 1.15, tint: '#6e6a2a' },
  { name: 'Autumn', food: 0.80, drain: 1.00, tint: '#7a4a22' },
  { name: 'Winter', food: 0.45, drain: 1.35, tint: '#33506e' },
];

const SCENARIOS = {
  balanced:    { label: 'Balanced', style: { water: 0.30, rock: 0.82, dirtMoist: 0.35, fertile: 1.0 }, params: {}, herb: 40, carn: 10 },
  eden:        { label: 'Eden (lush & peaceful)', style: { water: 0.22, rock: 0.92, dirtMoist: 0.20, fertile: 1.4 }, params: { foodGrowth: 1.6, disasters: false, minCarnivores: 0 }, herb: 60, carn: 2 },
  predator:    { label: 'Predator pressure', style: { water: 0.28, rock: 0.82, dirtMoist: 0.35, fertile: 1.0 }, params: { minCarnivores: 16, minHerbivores: 22 }, herb: 35, carn: 26 },
  archipelago: { label: 'Archipelago', style: { water: 0.50, rock: 0.86, dirtMoist: 0.30, fertile: 1.1 }, params: {}, herb: 45, carn: 8 },
  desert:      { label: 'Harsh desert', style: { water: 0.15, rock: 0.70, dirtMoist: 0.72, fertile: 0.5 }, params: { foodGrowth: 0.6, energyDrain: 1.2 }, herb: 30, carn: 6 },
};

class Simulation {
  constructor(cols = 96, rows = 64, cellSize = 12, scenarioKey = 'balanced') {
    const sc = SCENARIOS[scenarioKey] || SCENARIOS.balanced;
    this.scenario = scenarioKey;
    this.world = new World(cols, rows, cellSize, sc.style);
    this.params = Object.assign({
      foodGrowth: 1.0,     // plant regrowth multiplier
      energyDrain: 1.0,    // metabolic cost multiplier
      mutationScale: 1.0,  // genome+brain mutation multiplier
      turnRate: 4.0,       // max radians/sec turning
      dayNight: true,
      seasons: true,       // seasonal food/metabolism cycle
      disasters: true,     // random catastrophes drive selection
      minHerbivores: 12,   // auto-respawn floor (keeps evolution going)
      minCarnivores: 4,
      autoRespawn: true,
    }, sc.params);

    // spatial heatmaps (transient, for overlay visualization)
    this.densityHeat = new Float32Array(cols * rows);
    this.deathHeat = new Float32Array(cols * rows);
    this.hallOfFame = []; // top all-time creatures

    // seasons & disasters
    this.seasonLength = 80; // seconds per season
    this.season = { index: 0, name: 'Spring', phase: 0, food: 1, drain: 1 };
    this.activeDisaster = null;
    this.meteorFlash = null;
    this._terrainDirty = false;

    // chronicle (event log) + Muller-plot history
    this.events = [];
    this.muller = [];
    this.mullerMax = 400;
    this._peakPop = 0;
    this._lastGenMilestone = 0;
    this._lastCrashTime = -999;

    this.tick = 0;
    this.simTime = 0;
    this.dt = 1 / 30; // fixed timestep

    // rolling stats history for charts
    this.history = {
      t: [], herbivores: [], carnivores: [], food: [],
      avgSpeed: [], avgVision: [], avgSize: [], maxGen: [],
      births: [], deaths: [],
    };
    this.historyMax = 600;
    this._statsAccum = 0;
    this.totals = { births: 0, deaths: 0, starved: 0, eaten: 0, oldAge: 0 };
    this._windowBirths = 0;
    this._windowDeaths = 0;
    this.maxGeneration = 0;
    this.allTimeBest = null; // hall-of-fame snapshot {genome, brain, fitness,...}

    this.speciesList = []; // [{id, hue, count, exemplar}]
    this._nextSpeciesId = 1;

    // Phylogenetic tree: id -> node. id 0 is the synthetic common ancestor.
    this.phylo = { nodes: new Map() };
    this.phylo.nodes.set(0, {
      id: 0, parent: null, isRoot: true, birthTime: 0,
      hue: 120, carn: false, peakPop: 0, curPop: 0, lastSeen: 0, alive: true,
      exemplarGenome: null,
    });

    this.populate(sc.herb, sc.carn);
  }

  // ---- initial population ------------------------------------------
  populate(nHerb = 40, nCarn = 10) {
    for (let i = 0; i < nHerb; i++) this.spawnRandom('herb');
    for (let i = 0; i < nCarn; i++) this.spawnRandom('carn');
  }

  spawnRandom(kind, genome, brain) {
    const w = this.world;
    let x, y, tries = 0;
    do {
      x = Utils.randRange(10, w.width - 10);
      y = Utils.randRange(10, w.height - 10);
    } while (w.isBlocked(x, y) && ++tries < 80);
    const g = genome || (kind === 'carn' ? Genome.randomCarnivore() : Genome.randomHerbivore());
    const c = new Creature(x, y, g, brain || null);
    w.addCreature(c);
    return c;
  }

  // ---- main fixed-timestep update ----------------------------------
  step() {
    const { world, params, dt } = this;
    this.tick++;
    this.simTime += dt;

    // ---- seasons & disasters shape the effective environment ----
    const env = this._updateEnvironment(dt);
    const effParams = (env.food !== 1 || env.drain !== 1)
      ? { ...params,
          foodGrowth: params.foodGrowth * env.food,
          energyDrain: params.energyDrain * env.drain }
      : params;

    world.rebuildBuckets();
    world.update(effParams, dt);

    // Snapshot the live count; reproduce() appends newborns during the loop.
    const countBefore = world.creatures.length;
    for (let i = 0; i < countBefore; i++) {
      const c = world.creatures[i];
      c.step(world, effParams, dt);
      if (c.alive) this.densityHeat[world.cellIndex(c.x, c.y)] += dt; // activity heatmap
    }

    // plague culls a fraction of the population each tick
    if (this.activeDisaster && this.activeDisaster.type === 'plague') {
      const p = 0.05 * dt;
      for (let i = 0; i < countBefore; i++) {
        const c = world.creatures[i];
        if (c.alive && Utils.rand() < p) { c.alive = false; c.killedByPlague = true; }
      }
    }

    // Any creature appended past countBefore is a newborn this tick.
    const newborn = world.creatures.length - countBefore;
    this.totals.births += newborn;
    this._windowBirths += newborn;

    // bury the dead
    const survivors = [];
    for (const c of world.creatures) {
      if (c.alive) { survivors.push(c); continue; }
      this.totals.deaths++;
      this._windowDeaths++;
      if (c.killedByPredator) this.totals.eaten++;
      else if (c.killedByPlague) this.totals.plague = (this.totals.plague || 0) + 1;
      else if (c.energy <= 0) this.totals.starved++;
      else this.totals.oldAge++;
      if (!c.killedByPredator) world.spawnCorpse(c);
      this.deathHeat[world.cellIndex(c.x, c.y)] += 1; // death heatmap
      this._considerHallOfFame(c);
      if (c.generation > this.maxGeneration) this.maxGeneration = c.generation;
    }
    world.creatures = survivors;

    // auto-respawn floor so a crash doesn't end the run
    if (params.autoRespawn) this._respawnFloor();

    // generation milestone chronicle entries
    if (this.maxGeneration >= this._lastGenMilestone + 10) {
      this._lastGenMilestone = Math.floor(this.maxGeneration / 10) * 10;
      this._logEvent('🧬', `Generation ${this._lastGenMilestone} reached`, 'gen');
    }

    // periodic bookkeeping
    this._statsAccum += dt;
    if (this._statsAccum >= 1.0) {
      this._statsAccum = 0;
      this._recordStats();
      this._clusterSpecies();
      this._recordMuller();
      this._checkPopulation();
      // decay heatmaps so they reflect recent activity (deaths linger longer)
      for (let i = 0; i < this.densityHeat.length; i++) {
        this.densityHeat[i] *= 0.85;
        this.deathHeat[i] *= 0.96;
      }
    }
  }

  // ---- seasons & disasters ------------------------------------------
  _updateEnvironment(dt) {
    // season
    if (this.params.seasons) {
      const yearPos = (this.simTime / this.seasonLength);
      const idx = Math.floor(yearPos) % SEASONS.length;
      const s = SEASONS[idx];
      if (idx !== this.season.index) {
        this._logEvent('🍂', `${s.name} arrives`, 'season');
      }
      this.season = { index: idx, name: s.name, phase: yearPos % 1, food: s.food, drain: s.drain, tint: s.tint };
    } else {
      this.season = { index: 0, name: '—', phase: 0, food: 1, drain: 1, tint: null };
    }

    let food = this.season.food, drain = this.season.drain;

    // active disaster
    if (this.activeDisaster) {
      const d = this.activeDisaster;
      d.timeLeft -= dt;
      if (d.type === 'drought') food *= 0.10;
      else if (d.type === 'bloom') food *= 3.5;
      else if (d.type === 'plague') drain *= 1.1;
      if (d.timeLeft <= 0) {
        this._logEvent(d.endIcon || '✅', `${d.label} ended`, 'disaster');
        this.activeDisaster = null;
      }
    } else if (this.params.disasters && Utils.rand() < 0.0025 * dt * 60) {
      // ~1 disaster every ~6-7 sim-minutes on average
      const types = ['drought', 'bloom', 'plague', 'meteor'];
      this.triggerDisaster(types[Utils.randInt(0, types.length - 1)]);
    }

    if (this.meteorFlash) { this.meteorFlash.t -= dt; if (this.meteorFlash.t <= 0) this.meteorFlash = null; }

    return { food, drain };
  }

  triggerDisaster(type) {
    if (type === 'meteor') {
      const w = this.world;
      const x = Utils.randRange(w.width * 0.15, w.width * 0.85);
      const y = Utils.randRange(w.height * 0.15, w.height * 0.85);
      const r = Utils.randRange(40, 80);
      w.meteorStrike(x, y, r);
      let killed = 0;
      for (const c of w.creatures) {
        if (c.alive && Utils.dist2(c.x, c.y, x, y) < r * r) { c.alive = false; killed++; }
      }
      this.meteorFlash = { x, y, r, t: 1.2 };
      this._terrainDirty = true;
      this._logEvent('☄️', `Meteor impact — ${killed} wiped out`, 'disaster');
      return;
    }
    const defs = {
      drought: { label: 'Drought', icon: '🏜️', endIcon: '🌦️', timeLeft: 45 },
      bloom:   { label: 'Superbloom', icon: '🌸', endIcon: '🍃', timeLeft: 30 },
      plague:  { label: 'Plague', icon: '☣️', endIcon: '💊', timeLeft: 25 },
    };
    const d = defs[type];
    if (!d) return;
    this.activeDisaster = { type, ...d };
    this._logEvent(d.icon, `${d.label} struck!`, 'disaster');
  }

  _logEvent(icon, text, kind) {
    this.events.push({ time: this.simTime, icon, text, kind });
    if (this.events.length > 250) this.events.shift();
  }

  _recordMuller() {
    const counts = {};
    for (const s of this.speciesList) counts[s.id] = s.count;
    this.muller.push({ t: this.simTime, counts });
    if (this.muller.length > this.mullerMax) this.muller.shift();
  }

  _checkPopulation() {
    const total = this.world.creatures.length;
    this._peakPop = Math.max(total, this._peakPop * 0.992);
    if (this._peakPop > 45 && total < 0.4 * this._peakPop &&
        this.simTime - this._lastCrashTime > 25) {
      this._lastCrashTime = this.simTime;
      this._logEvent('📉', `Population crash — down to ${total}`, 'crash');
    }
  }

  _respawnFloor() {
    let herb = 0, carn = 0;
    for (const c of this.world.creatures) (c.isCarnivore ? carn++ : herb++);
    const seedFrom = (filter) => {
      // re-seed from a living relative (preferred) or the hall of fame, and
      // carry the source's lineage so respawns continue an existing branch
      // rather than spawning a brand-new root species.
      const pool = this.world.creatures.filter(filter);
      if (pool.length > 0) {
        const p = pool[Utils.randInt(0, pool.length - 1)];
        const g = p.genome.clone().mutate(0.25, 0.15);
        const b = p.brain.clone(); b.mutate(0.25, 0.3);
        return { g, b, species: p.species, generation: p.generation };
      }
      if (this.allTimeBest && filter({ isCarnivore: this.allTimeBest.carn, isHerbivore: !this.allTimeBest.carn })) {
        const g = Genome.fromJSON(this.allTimeBest.genome).mutate(0.3, 0.2);
        const b = NeuralNet.fromJSON(this.allTimeBest.brain); b.mutate(0.3, 0.3);
        return { g, b, species: 0, generation: this.allTimeBest.generation || 0 };
      }
      return null;
    };
    const seed = (kind, filter) => {
      const s = seedFrom(filter);
      const c = s ? this.spawnRandom(kind, s.g, s.b) : this.spawnRandom(kind);
      if (s) { c.birthSpecies = s.species || 0; c.species = s.species || 0; c.generation = s.generation || 0; }
    };
    while (herb < this.params.minHerbivores) { seed('herb', (c) => c.isHerbivore); herb++; }
    while (carn < this.params.minCarnivores) { seed('carn', (c) => c.isCarnivore); carn++; }
  }

  _considerHallOfFame(c) {
    const fitness = Math.round(c.children * 100 + c.foodEaten + c.age * 2);
    const cap = 8;
    const hof = this.hallOfFame;
    if (hof.length >= cap && fitness <= hof[hof.length - 1].fitness) return;

    // skip near-duplicates of an existing champion unless clearly better
    for (const e of hof) {
      if (e._genomeObj && Genome.distance(e._genomeObj, c.genome) < 0.06) {
        if (fitness <= e.fitness * 1.15) return;
        hof.splice(hof.indexOf(e), 1); // replace the weaker twin
        break;
      }
    }

    const entry = {
      fitness, genome: c.genome.toJSON(), brain: c.brain.toJSON(),
      generation: c.generation, children: c.children,
      foodEaten: Math.round(c.foodEaten), age: Math.round(c.age),
      carn: c.isCarnivore, hue: c.hue, id: c.id, diedAt: Math.round(this.simTime),
      diet: c.diet, size: c.genome.val('size'), speed: c.genome.val('speed'),
      vision: c.genome.val('vision'),
      _genomeObj: c.genome.clone(),
    };
    hof.push(entry);
    hof.sort((a, b) => b.fitness - a.fitness);
    if (hof.length > cap) hof.length = cap;
    this.allTimeBest = hof[0];
  }

  _recordStats() {
    const h = this.history;
    const cs = this.world.creatures;
    let herb = 0, carn = 0, spd = 0, vis = 0, sz = 0;
    for (const c of cs) {
      if (c.isCarnivore) carn++; else herb++;
      spd += c.genome.val('speed');
      vis += c.genome.val('vision');
      sz += c.genome.val('size');
    }
    const n = Math.max(1, cs.length);
    let totalFood = 0;
    const f = this.world.food;
    for (let i = 0; i < f.length; i++) totalFood += f[i];

    h.t.push(this.simTime);
    h.herbivores.push(herb);
    h.carnivores.push(carn);
    h.food.push(totalFood / (this.world.FOOD_MAX * f.length)); // 0..1
    h.avgSpeed.push(spd / n);
    h.avgVision.push(vis / n);
    h.avgSize.push(sz / n);
    h.maxGen.push(this.maxGeneration);
    h.births.push(this._windowBirths);
    h.deaths.push(this._windowDeaths);
    this._windowBirths = 0;
    this._windowDeaths = 0;

    if (h.t.length > this.historyMax) {
      for (const k of Object.keys(h)) h[k].shift();
    }
  }

  // Greedy genetic clustering into "species" for coloring/inspection.
  _clusterSpecies() {
    const THRESH = 0.15;
    const clusters = [];
    for (const c of this.world.creatures) {
      let placed = false;
      for (const cl of clusters) {
        if (Genome.distance(c.genome, cl.exemplar.genome) < THRESH) {
          cl.members.push(c); placed = true; break;
        }
      }
      if (!placed) clusters.push({ exemplar: c, members: [c] });
    }
    // Stable identity: bigger clusters claim their lineage id first, by
    // nearest-match against persistent species nodes (alive or in a grace
    // window). This stops stable populations from being re-IDed each pass.
    const GRACE = 4; // passes (~seconds) a species may vanish before it dies
    clusters.sort((a, b) => b.members.length - a.members.length);

    const out = [];
    const seenIds = new Set();
    const claimed = new Set();
    for (const cl of clusters) {
      let id = null, bestD = THRESH;
      for (const [nid, node] of this.phylo.nodes) {
        if (node.isRoot || claimed.has(nid) || !node.exemplarGenome) continue;
        if (!node.alive && (node.missesSinceSeen || 0) > GRACE) continue; // truly gone
        const d = Genome.distance(cl.exemplar.genome, node.exemplarGenome);
        if (d < bestD) { bestD = d; id = nid; }
      }
      const isNew = id === null;
      if (isNew) id = this._nextSpeciesId++;
      claimed.add(id);
      for (const m of cl.members) m.species = id;
      out.push({
        id,
        count: cl.members.length,
        hue: cl.exemplar.hue,
        carn: cl.exemplar.isCarnivore,
        avgGen: cl.members.reduce((s, m) => s + m.generation, 0) / cl.members.length,
        exemplarGenome: cl.exemplar.genome.clone(),
      });
      seenIds.add(id);

      // ---- phylogeny: birth a node for a newly emerged species ----
      if (isNew) {
        const parent = this._inferParentSpecies(cl.members, cl.exemplar);
        this.phylo.nodes.set(id, {
          id, parent, isRoot: false,
          birthTime: this.simTime, birthGen: cl.exemplar.generation,
          hue: cl.exemplar.hue, carn: cl.exemplar.isCarnivore,
          peakPop: cl.members.length, curPop: cl.members.length,
          lastSeen: this.simTime, alive: true, missesSinceSeen: 0,
          exemplarGenome: cl.exemplar.genome.clone(),
        });
        // chronicle a real branching event off a thriving parent lineage
        const pnode = parent ? this.phylo.nodes.get(parent) : null;
        if (pnode && !pnode.isRoot && pnode.peakPop >= 10) {
          this._logEvent(cl.exemplar.isCarnivore ? '🦊' : '🐰',
            `Lineage #${id} split from #${parent}`, 'speciation');
        }
      }
      const node = this.phylo.nodes.get(id);
      node.lastSeen = this.simTime;
      node.curPop = cl.members.length;
      node.peakPop = Math.max(node.peakPop, cl.members.length);
      node.alive = true;
      node.missesSinceSeen = 0;
      node.hue = cl.exemplar.hue;
      node.exemplarGenome = cl.exemplar.genome.clone();
    }

    // species absent this pass age toward extinction (grace prevents flicker)
    for (const node of this.phylo.nodes.values()) {
      if (node.isRoot || seenIds.has(node.id)) continue;
      node.missesSinceSeen = (node.missesSinceSeen || 0) + 1;
      node.curPop = 0;
      if (node.missesSinceSeen > GRACE && node.alive) {
        node.alive = false;
        if (node.peakPop >= 8) {
          this._logEvent('💀',
            `Lineage #${node.id} went extinct (peak ${node.peakPop}, lived ${(node.lastSeen - node.birthTime).toFixed(0)}s)`,
            'extinction');
        }
      }
    }

    out.sort((a, b) => b.count - a.count);
    this.speciesList = out;
  }

  // Infer which existing species a freshly-split cluster descends from:
  // the most common birth-lineage among its members, else the nearest
  // existing species by genetics, else the common ancestor (root 0).
  _inferParentSpecies(members, exemplar) {
    const counts = new Map();
    for (const m of members) {
      const bs = m.birthSpecies;
      if (this.phylo.nodes.has(bs)) counts.set(bs, (counts.get(bs) || 0) + 1);
    }
    let best = null, bestN = 0;
    for (const [k, v] of counts) if (v > bestN) { bestN = v; best = k; }
    if (best !== null) return best;

    let near = 0, nearD = Infinity;
    for (const [nid, node] of this.phylo.nodes) {
      if (!node.exemplarGenome) continue;
      const d = Genome.distance(exemplar.genome, node.exemplarGenome);
      if (d < nearD) { nearD = d; near = nid; }
    }
    return nearD < 0.45 ? near : 0;
  }

  // ---- save / load ---------------------------------------------------
  save() {
    return JSON.stringify({
      version: 1,
      tick: this.tick,
      simTime: this.simTime,
      params: this.params,
      maxGeneration: this.maxGeneration,
      totals: this.totals,
      scenario: this.scenario,
      allTimeBest: this.allTimeBest ? { ...this.allTimeBest, _genomeObj: undefined } : null,
      hallOfFame: this.hallOfFame.map((e) => ({ ...e, _genomeObj: undefined })),
      nextSpeciesId: this._nextSpeciesId,
      events: this.events.slice(-150),
      phylo: [...this.phylo.nodes.values()].map((n) => ({
        ...n, exemplarGenome: n.exemplarGenome ? n.exemplarGenome.toJSON() : null,
      })),
      world: this.world.toJSON(),
      creatures: this.world.creatures.map((c) => c.toJSON()),
    });
  }

  static load(json) {
    const o = JSON.parse(json);
    const sim = Object.create(Simulation.prototype);
    sim.world = World.fromJSON(o.world);
    sim.params = Object.assign({
      foodGrowth: 1.0, energyDrain: 1.0, mutationScale: 1.0, turnRate: 4.0,
      dayNight: true, seasons: true, disasters: true,
      minHerbivores: 12, minCarnivores: 4, autoRespawn: true,
    }, o.params);
    sim.tick = o.tick; sim.simTime = o.simTime;
    sim.dt = 1 / 30;
    sim.scenario = o.scenario || 'balanced';

    // heatmaps + hall of fame
    const cells = sim.world.cols * sim.world.rows;
    sim.densityHeat = new Float32Array(cells);
    sim.deathHeat = new Float32Array(cells);
    sim.hallOfFame = (o.hallOfFame || []).map((e) => ({ ...e, _genomeObj: Genome.fromJSON(e.genome) }));

    // seasons, disasters, chronicle, muller state
    sim.seasonLength = 80;
    sim.season = { index: 0, name: 'Spring', phase: 0, food: 1, drain: 1 };
    sim.activeDisaster = null;
    sim.meteorFlash = null;
    sim._terrainDirty = false;
    sim.events = o.events || [];
    sim.muller = [];
    sim.mullerMax = 400;
    sim._peakPop = 0;
    sim._lastGenMilestone = Math.floor((o.maxGeneration || 0) / 10) * 10;
    sim._lastCrashTime = -999;
    sim.history = {
      t: [], herbivores: [], carnivores: [], food: [],
      avgSpeed: [], avgVision: [], avgSize: [], maxGen: [],
      births: [], deaths: [],
    };
    sim.historyMax = 600;
    sim._statsAccum = 0;
    sim.totals = o.totals || { births: 0, deaths: 0, starved: 0, eaten: 0, oldAge: 0 };
    sim._windowBirths = 0; sim._windowDeaths = 0;
    sim.maxGeneration = o.maxGeneration || 0;
    sim.allTimeBest = sim.hallOfFame[0] || o.allTimeBest || null;
    sim.speciesList = [];
    sim._nextSpeciesId = o.nextSpeciesId || 1;
    sim.phylo = { nodes: new Map() };
    if (o.phylo && o.phylo.length) {
      for (const n of o.phylo) {
        n.exemplarGenome = n.exemplarGenome ? Genome.fromJSON(n.exemplarGenome) : null;
        sim.phylo.nodes.set(n.id, n);
      }
    } else {
      sim.phylo.nodes.set(0, {
        id: 0, parent: null, isRoot: true, birthTime: 0, hue: 120, carn: false,
        peakPop: 0, curPop: 0, lastSeen: 0, alive: true, exemplarGenome: null,
      });
    }
    for (const cj of o.creatures) sim.world.addCreature(Creature.fromJSON(cj));
    return sim;
  }
}
