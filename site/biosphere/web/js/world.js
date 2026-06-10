/* ====================================================================
 * world.js  —  terrain grid, plant food, corpses, day/night cycle,
 *              and a spatial hash for fast neighbor queries.
 *
 * Terrain cells: 0 grass (plants grow), 1 water (impassable),
 *                2 rock (impassable, nothing grows), 3 dirt (slow growth)
 * ==================================================================== */

const TERRAIN = { GRASS: 0, WATER: 1, ROCK: 2, DIRT: 3 };

class World {
  constructor(cols, rows, cellSize, style) {
    this.cols = cols;
    this.rows = rows;
    this.cellSize = cellSize;
    this.width = cols * cellSize;
    this.height = rows * cellSize;

    // terrain generation bias (set by scenario presets)
    this.style = style || { water: 0.30, rock: 0.82, dirtMoist: 0.35, fertile: 1.0 };

    this.terrain = new Uint8Array(cols * rows);
    this.food = new Float32Array(cols * rows);      // plant energy per cell, 0..FOOD_MAX
    this.fertility = new Float32Array(cols * rows); // growth multiplier per cell
    this.FOOD_MAX = 14;

    this.creatures = [];
    this.corpses = []; // {x, y, energy, decay}

    this.time = 0;          // seconds of sim time
    this.dayLength = 60;    // seconds per full day/night cycle
    this.lightLevel = 1;    // 0 (midnight) .. 1 (noon)

    // spatial hash for creatures
    this._bucketSize = 48;
    this._buckets = new Map();

    this.generateTerrain();
  }

  // ---- terrain generation (value-noise blobs) ----------------------
  generateTerrain() {
    const { cols, rows } = this;
    // coarse random grid, bilinearly interpolated = cheap smooth noise
    const noise = (gx, gy, freq, seedOff) => {
      const fx = gx * freq, fy = gy * freq;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const sx = fx - x0, sy = fy - y0;
      const h = (ix, iy) => {
        // int32 hash (Math.imul avoids float overflow that skewed the noise)
        let n = (Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seedOff, 1442695041)) | 0;
        n = Math.imul(n ^ (n >>> 13), 1274126177);
        return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
      };
      const a = Utils.lerp(h(x0, y0), h(x0 + 1, y0), sx);
      const b = Utils.lerp(h(x0, y0 + 1), h(x0 + 1, y0 + 1), sx);
      return Utils.lerp(a, b, sy);
    };
    const seed = Utils.randInt(1, 100000);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const st = this.style;
        const elev = noise(x, y, 0.07, seed) * 0.65 + noise(x, y, 0.18, seed + 7) * 0.35;
        const moist = noise(x, y, 0.05, seed + 31);
        if (elev < st.water) this.terrain[i] = TERRAIN.WATER;
        else if (elev > st.rock) this.terrain[i] = TERRAIN.ROCK;
        else if (moist < st.dirtMoist) this.terrain[i] = TERRAIN.DIRT;
        else this.terrain[i] = TERRAIN.GRASS;

        this.fertility[i] = this.terrain[i] === TERRAIN.GRASS ? Utils.lerp(0.7, 1.4, moist) * st.fertile
          : this.terrain[i] === TERRAIN.DIRT ? 0.35 * st.fertile : 0;
        this.food[i] = this.fertility[i] > 0 ? Utils.rand() * this.FOOD_MAX * 0.6 : 0;
      }
    }
  }

  cellIndex(x, y) {
    const cx = Utils.clamp(Math.floor(x / this.cellSize), 0, this.cols - 1);
    const cy = Utils.clamp(Math.floor(y / this.cellSize), 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  terrainAt(x, y) { return this.terrain[this.cellIndex(x, y)]; }

  isBlocked(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return true;
    const t = this.terrainAt(x, y);
    return t === TERRAIN.WATER || t === TERRAIN.ROCK;
  }

  // ---- food --------------------------------------------------------
  growFood(params, dt) {
    // grow a random subset each tick for cheap stochastic regrowth
    const n = this.cols * this.rows;
    const samples = Math.max(1, Math.floor(n * 0.12));
    const growth = params.foodGrowth * dt * 8.3;
    const light = 0.35 + 0.65 * this.lightLevel; // plants grow faster in daylight
    for (let s = 0; s < samples; s++) {
      const i = Utils.randInt(0, n - 1);
      const f = this.fertility[i];
      if (f <= 0) continue;
      const cur = this.food[i];
      if (cur < this.FOOD_MAX) {
        this.food[i] = Math.min(this.FOOD_MAX, cur + growth * f * light * (0.4 + cur / this.FOOD_MAX));
      }
    }
  }

  // Take up to `amount` of plant food at world position; returns eaten.
  eatFoodAt(x, y, amount) {
    const i = this.cellIndex(x, y);
    const avail = this.food[i];
    if (avail < 0.3) return 0;
    const eaten = Math.min(avail, amount);
    this.food[i] -= eaten;
    return eaten;
  }

  // Nearest cell with meaningful food, searched in a ring around (x,y).
  // Also checks corpses (carrion counts as food for scavengers).
  nearestFood(x, y, radius) {
    const cs = this.cellSize;
    const r = Math.ceil(radius / cs);
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    let best = null, bestD2 = radius * radius;
    for (let dy = -r; dy <= r; dy++) {
      const yy = cy + dy;
      if (yy < 0 || yy >= this.rows) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = cx + dx;
        if (xx < 0 || xx >= this.cols) continue;
        const i = yy * this.cols + xx;
        if (this.food[i] < 2) continue;
        const fx = (xx + 0.5) * cs, fy = (yy + 0.5) * cs;
        const d2 = Utils.dist2(x, y, fx, fy);
        if (d2 < bestD2) { bestD2 = d2; best = { x: fx, y: fy, d2 }; }
      }
    }
    for (const c of this.corpses) {
      const d2 = Utils.dist2(x, y, c.x, c.y);
      if (d2 < bestD2) { bestD2 = d2; best = { x: c.x, y: c.y, d2, corpse: c }; }
    }
    return best;
  }

  eatCorpseAt(x, y, amount) {
    for (const c of this.corpses) {
      if (Utils.dist2(x, y, c.x, c.y) < 144) {
        const eaten = Math.min(c.energy, amount);
        c.energy -= eaten;
        return eaten;
      }
    }
    return 0;
  }

  // ---- creatures / spatial hash ------------------------------------
  addCreature(c) { this.creatures.push(c); }

  rebuildBuckets() {
    this._buckets.clear();
    const bs = this._bucketSize;
    for (const c of this.creatures) {
      if (!c.alive) continue;
      const key = ((c.x / bs) | 0) + ',' + ((c.y / bs) | 0);
      let arr = this._buckets.get(key);
      if (!arr) { arr = []; this._buckets.set(key, arr); }
      arr.push(c);
    }
  }

  forEachCreatureNear(x, y, radius, fn) {
    const bs = this._bucketSize;
    const r = Math.ceil(radius / bs);
    const bx = (x / bs) | 0, by = (y / bs) | 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const arr = this._buckets.get((bx + dx) + ',' + (by + dy));
        if (arr) for (const c of arr) fn(c);
      }
    }
  }

  // ---- per-tick world update ---------------------------------------
  update(params, dt) {
    this.time += dt;
    // day/night: cosine curve, clamped softly so nights aren't pitch black
    const phase = (this.time % this.dayLength) / this.dayLength;
    this.lightLevel = params.dayNight
      ? Utils.clamp(0.5 - 0.5 * Math.cos(phase * Utils.TAU) + 0.15, 0.12, 1)
      : 1;

    this.growFood(params, dt);

    // decay corpses into the soil (boost fertility cell food)
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      c.decay -= dt;
      c.energy -= dt * 2;
      if (c.decay <= 0 || c.energy <= 0) {
        const ci = this.cellIndex(c.x, c.y);
        if (this.fertility[ci] > 0) {
          this.food[ci] = Math.min(this.FOOD_MAX, this.food[ci] + Math.max(0, c.energy) * 0.3);
        }
        this.corpses.splice(i, 1);
      }
    }
  }

  spawnCorpse(creature) {
    if (this.corpses.length > 200) return; // cap
    this.corpses.push({
      x: creature.x, y: creature.y,
      energy: 15 + creature.size * 25,
      decay: 12,
      size: creature.size,
      hue: creature.hue,
    });
  }

  // ---- terrain editing (god mode) ----------------------------------
  paint(x, y, brushRadius, mode) {
    const cs = this.cellSize;
    const r = Math.ceil(brushRadius / cs);
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + 0.5) continue;
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || xx >= this.cols || yy < 0 || yy >= this.rows) continue;
        const i = yy * this.cols + xx;
        switch (mode) {
          case 'food':
            if (this.terrain[i] === TERRAIN.GRASS || this.terrain[i] === TERRAIN.DIRT) {
              this.food[i] = this.FOOD_MAX;
              if (this.fertility[i] <= 0) this.fertility[i] = 0.5;
            }
            break;
          case 'grass':
            this.terrain[i] = TERRAIN.GRASS;
            this.fertility[i] = 1;
            break;
          case 'water':
            this.terrain[i] = TERRAIN.WATER;
            this.fertility[i] = 0; this.food[i] = 0;
            break;
          case 'rock':
            this.terrain[i] = TERRAIN.ROCK;
            this.fertility[i] = 0; this.food[i] = 0;
            break;
          case 'dirt':
            this.terrain[i] = TERRAIN.DIRT;
            this.fertility[i] = 0.35;
            break;
          case 'erase-food':
            this.food[i] = 0;
            break;
        }
      }
    }
  }

  // Carve an impact crater: rock core, scorched dirt ring, food cleared.
  meteorStrike(x, y, radius) {
    const cs = this.cellSize;
    const r = Math.ceil(radius / cs);
    const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const xx = cx + dx, yy = cy + dy;
        if (xx < 0 || xx >= this.cols || yy < 0 || yy >= this.rows) continue;
        const i = yy * this.cols + xx;
        if (d < r * 0.45) {
          this.terrain[i] = TERRAIN.ROCK; this.fertility[i] = 0; this.food[i] = 0;
        } else {
          this.terrain[i] = TERRAIN.DIRT; this.fertility[i] = 0.3; this.food[i] = 0;
        }
      }
    }
  }

  toJSON() {
    return {
      cols: this.cols, rows: this.rows, cellSize: this.cellSize,
      terrain: Array.from(this.terrain),
      food: Array.from(this.food),
      fertility: Array.from(this.fertility),
      time: this.time,
    };
  }
  static fromJSON(o) {
    const w = new World(o.cols, o.rows, o.cellSize);
    w.terrain = Uint8Array.from(o.terrain);
    w.food = Float32Array.from(o.food);
    w.fertility = Float32Array.from(o.fertility);
    w.time = o.time || 0;
    return w;
  }
}
