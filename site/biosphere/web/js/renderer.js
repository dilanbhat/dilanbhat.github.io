/* ====================================================================
 * renderer.js  —  draws the world + creatures onto the main canvas,
 *                 with pan/zoom and selection highlighting.
 * ==================================================================== */

class Renderer {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sim = sim;
    this.cam = { x: sim.world.width / 2, y: sim.world.height / 2, zoom: 1 };
    this.selected = null;
    this.showVision = false;
    this.showSenses = true;
    this.colorMode = 'species'; // 'species' | 'diet' | 'energy' | 'generation'
    this.overlay = 'none';      // 'none' | 'density' | 'deaths' | 'food'
    this._terrainCanvas = document.createElement('canvas');
    this.buildTerrainCache();
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = r.width * dpr;
    this.canvas.height = r.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.viewW = r.width;
    this.viewH = r.height;
  }

  // Terrain rarely changes; cache it to an offscreen canvas, redraw on edit.
  buildTerrainCache() {
    const w = this.sim.world;
    const tc = this._terrainCanvas;
    tc.width = w.cols;
    tc.height = w.rows;
    const tctx = tc.getContext('2d');
    const img = tctx.createImageData(w.cols, w.rows);
    const pal = {
      [TERRAIN.GRASS]: [54, 92, 54],
      [TERRAIN.WATER]: [40, 78, 120],
      [TERRAIN.ROCK]: [92, 92, 100],
      [TERRAIN.DIRT]: [104, 84, 58],
    };
    for (let i = 0; i < w.terrain.length; i++) {
      const c = pal[w.terrain[i]];
      const j = i * 4;
      img.data[j] = c[0]; img.data[j + 1] = c[1]; img.data[j + 2] = c[2]; img.data[j + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);
    this._terrainDirty = false;
  }
  markTerrainDirty() { this._terrainDirty = true; }

  screenToWorld(sx, sy) {
    const { cam } = this;
    return {
      x: (sx - this.viewW / 2) / cam.zoom + cam.x,
      y: (sy - this.viewH / 2) / cam.zoom + cam.y,
    };
  }
  worldToScreen(wx, wy) {
    const { cam } = this;
    return {
      x: (wx - cam.x) * cam.zoom + this.viewW / 2,
      y: (wy - cam.y) * cam.zoom + this.viewH / 2,
    };
  }

  creatureColor(c) {
    switch (this.colorMode) {
      case 'diet':
        return Utils.hsl(Utils.lerp(110, 0, c.diet), 70, 55);
      case 'energy': {
        const e = Utils.clamp(c.energy / c.maxEnergy, 0, 1);
        return Utils.hsl(Utils.lerp(0, 130, e), 75, 52);
      }
      case 'generation': {
        const g = Utils.clamp(c.generation / 40, 0, 1);
        return Utils.hsl(Utils.lerp(220, 320, g), 70, 58);
      }
      default:
        return Utils.hsl(c.hue, 65, 58);
    }
  }

  render() {
    const ctx = this.ctx;
    const w = this.sim.world;
    const { cam } = this;
    if (this._terrainDirty) this.buildTerrainCache();

    ctx.clearRect(0, 0, this.viewW, this.viewH);
    ctx.save();
    ctx.translate(this.viewW / 2, this.viewH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);

    // ---- terrain (scaled blocky cache) ----
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this._terrainCanvas, 0, 0, w.width, w.height);

    const cs = w.cellSize;
    ctx.imageSmoothingEnabled = true;

    if (this.overlay !== 'none') {
      // ---- heatmap overlay ----
      this.drawHeatmap(ctx, w, cs);
    } else {
      // ---- plant food (green dots, brightness = amount) ----
      for (let y = 0; y < w.rows; y++) {
        for (let x = 0; x < w.cols; x++) {
          const i = y * w.cols + x;
          const f = w.food[i];
          if (f < 1.5) continue;
          const t = f / w.FOOD_MAX;
          const px = x * cs, py = y * cs;
          ctx.fillStyle = Utils.hsl(95 + t * 25, 65, 30 + t * 35, 0.85);
          const r = 1.2 + t * (cs * 0.42);
          ctx.beginPath();
          ctx.arc(px + cs / 2, py + cs / 2, r, 0, Utils.TAU);
          ctx.fill();
        }
      }
    }

    // ---- corpses ----
    for (const c of w.corpses) {
      ctx.fillStyle = Utils.hsl(c.hue, 20, 35, Utils.clamp(c.decay / 12, 0.15, 0.8));
      ctx.beginPath();
      ctx.arc(c.x, c.y, 2 + c.size * 3, 0, Utils.TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }

    // ---- creatures ----
    for (const c of w.creatures) {
      this.drawCreature(ctx, c);
    }

    // ---- selection ring ----
    if (this.selected && this.selected.alive) {
      const c = this.selected;
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = 2 / cam.zoom;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.size * 6 + 6, 0, Utils.TAU);
      ctx.stroke();
    }

    // ---- meteor impact flash (world space) ----
    if (this.sim.meteorFlash) {
      const m = this.sim.meteorFlash;
      const a = Utils.clamp(m.t / 1.2, 0, 1);
      ctx.strokeStyle = `rgba(255,160,60,${a})`;
      ctx.lineWidth = 4 / cam.zoom;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r * (1.4 - a * 0.4), 0, Utils.TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,120,40,${a * 0.25})`;
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Utils.TAU); ctx.fill();
    }

    ctx.restore();

    // ---- night overlay (screen-space tint) ----
    if (this.sim.params.dayNight) {
      const dark = (1 - w.lightLevel) * 0.55;
      if (dark > 0.01) {
        ctx.fillStyle = `rgba(8, 12, 40, ${dark})`;
        ctx.fillRect(0, 0, this.viewW, this.viewH);
      }
    }

    // ---- disaster tint (screen-space) ----
    const dis = this.sim.activeDisaster;
    if (dis) {
      const tints = {
        drought: 'rgba(150, 110, 40, 0.16)',
        bloom: 'rgba(255, 120, 200, 0.10)',
        plague: 'rgba(80, 200, 90, 0.12)',
      };
      if (tints[dis.type]) { ctx.fillStyle = tints[dis.type]; ctx.fillRect(0, 0, this.viewW, this.viewH); }
    }
  }

  // ---- heatmap overlay (density / deaths / food) ----
  drawHeatmap(ctx, w, cs) {
    let grid, ramp;
    if (this.overlay === 'density') { grid = this.sim.densityHeat; ramp = [200, 60]; }
    else if (this.overlay === 'deaths') { grid = this.sim.deathHeat; ramp = [0, -40]; }
    else { grid = w.food; ramp = [120, 60]; } // food
    let max = 1e-6;
    for (let i = 0; i < grid.length; i++) if (grid[i] > max) max = grid[i];
    for (let y = 0; y < w.rows; y++) {
      for (let x = 0; x < w.cols; x++) {
        const v = grid[y * w.cols + x] / max;
        if (v < 0.04) continue;
        const t = Math.pow(v, 0.6);
        const hue = Utils.lerp(ramp[0], ramp[1], t);
        ctx.fillStyle = Utils.hsl(hue, 85, 25 + t * 35, 0.18 + t * 0.6);
        ctx.fillRect(x * cs, y * cs, cs, cs);
      }
    }
  }

  // ---- minimap: whole world + creatures + viewport rectangle ----
  renderMinimap(mini) {
    const ctx = mini.getContext('2d');
    const w = this.sim.world;
    const W = mini.width, H = mini.height;
    if (this._terrainDirty) this.buildTerrainCache();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(this._terrainCanvas, 0, 0, W, H);

    // creatures as tiny dots
    const sx = W / w.width, sy = H / w.height;
    for (const c of w.creatures) {
      ctx.fillStyle = c.isCarnivore ? '#ff6b5e' : '#7fe39a';
      ctx.fillRect(c.x * sx - 0.5, c.y * sy - 0.5, 1.6, 1.6);
    }

    // viewport rectangle
    const { cam } = this;
    const vw = (this.viewW / cam.zoom) * sx;
    const vh = (this.viewH / cam.zoom) * sy;
    const vx = (cam.x * sx) - vw / 2;
    const vy = (cam.y * sy) - vh / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(vx, vy, vw, vh);
  }

  drawCreature(ctx, c) {
    const r = c.size * 5 + 3;
    const col = this.creatureColor(c);

    // vision cone
    if (this.showVision) {
      const vr = c.vision * Utils.lerp(0.5, 1.1, this.sim.world.lightLevel);
      ctx.fillStyle = Utils.hsl(c.hue, 60, 60, 0.06);
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.arc(c.x, c.y, vr, c.heading - c.fov / 2, c.heading + c.fov / 2);
      ctx.closePath();
      ctx.fill();
    }

    // body
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.heading);

    // energy ring
    const e = Utils.clamp(c.energy / c.maxEnergy, 0, 1);
    ctx.strokeStyle = Utils.hsl(Utils.lerp(0, 130, e), 80, 50, 0.9);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r + 1.5, -Math.PI / 2, -Math.PI / 2 + e * Utils.TAU);
    ctx.stroke();

    // attack/eat flash
    if (c.attackFlash > 0) {
      ctx.fillStyle = `rgba(255,80,60,${c.attackFlash})`;
      ctx.beginPath(); ctx.arc(0, 0, r + 5, 0, Utils.TAU); ctx.fill();
    } else if (c.eatFlash > 0) {
      ctx.fillStyle = `rgba(140,255,120,${c.eatFlash})`;
      ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Utils.TAU); ctx.fill();
    }

    ctx.fillStyle = col;
    ctx.strokeStyle = c.isCarnivore ? 'rgba(255,210,210,0.9)' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = c.isCarnivore ? 1.4 : 0.8;

    if (c.isCarnivore) {
      // carnivores: arrow/triangle shape
      ctx.beginPath();
      ctx.moveTo(r + 2, 0);
      ctx.lineTo(-r, r * 0.8);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r, -r * 0.8);
      ctx.closePath();
    } else {
      // herbivores: round body
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Utils.TAU);
    }
    ctx.fill();
    ctx.stroke();

    // heading dot (eye)
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(r * 0.5, 0, Math.max(0.8, r * 0.22), 0, Utils.TAU);
    ctx.fill();

    ctx.restore();
  }

  // pick the creature nearest a world point within radius
  pick(wx, wy) {
    let best = null, bestD2 = 400 / (this.cam.zoom * this.cam.zoom);
    for (const c of this.sim.world.creatures) {
      const rad = (c.size * 6 + 6);
      const d2 = Utils.dist2(wx, wy, c.x, c.y);
      if (d2 < Math.max(bestD2, rad * rad) && d2 < rad * rad + 60) {
        bestD2 = d2; best = c;
      }
    }
    return best;
  }
}
