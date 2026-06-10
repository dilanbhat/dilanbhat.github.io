/* ====================================================================
 * charts.js  —  lightweight canvas charts for the analytics panel and
 *               a neural-net visualizer for the inspector.
 * ==================================================================== */

const Charts = {
  _line(ctx, w, h, series, opts) {
    ctx.clearRect(0, 0, w, h);
    const pad = { l: 30, r: 6, t: 8, b: 16 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;
    let maxV = opts.max || 0;
    let n = 0;
    for (const s of series) { n = Math.max(n, s.data.length); for (const v of s.data) if (v > maxV) maxV = v; }
    maxV = maxV || 1;
    if (opts.maxFixed) maxV = opts.maxFixed;

    // grid + axis
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.fillStyle = 'rgba(220,225,235,0.55)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = pad.t + (plotH * g) / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      const val = maxV * (1 - g / 4);
      ctx.fillText(val >= 10 ? Math.round(val) : val.toFixed(1), 2, y + 3);
    }

    for (const s of series) {
      if (s.data.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < s.data.length; i++) {
        const x = pad.l + (plotW * i) / (n - 1 || 1);
        const y = pad.t + plotH * (1 - s.data[i] / maxV);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // legend
    let lx = pad.l + 4;
    ctx.font = '9px ui-sans-serif, sans-serif';
    for (const s of series) {
      ctx.fillStyle = s.color;
      ctx.fillRect(lx, pad.t + 1, 8, 8);
      ctx.fillStyle = 'rgba(220,225,235,0.85)';
      ctx.fillText(s.label, lx + 11, pad.t + 9);
      lx += 14 + ctx.measureText(s.label).width + 8;
    }
  },

  population(canvas, sim) {
    const ctx = canvas.getContext('2d');
    const h = sim.history;
    this._line(ctx, canvas.width, canvas.height, [
      { label: 'Herbivores', color: '#5fd97a', data: h.herbivores },
      { label: 'Carnivores', color: '#ff6b5e', data: h.carnivores },
    ], {});
  },

  ecology(canvas, sim) {
    const ctx = canvas.getContext('2d');
    const h = sim.history;
    this._line(ctx, canvas.width, canvas.height, [
      { label: 'Plant cover', color: '#9be36a', data: h.food },
    ], { maxFixed: 1 });
  },

  vitals(canvas, sim) {
    const ctx = canvas.getContext('2d');
    const h = sim.history;
    this._line(ctx, canvas.width, canvas.height, [
      { label: 'Births/s', color: '#7ab8ff', data: h.births },
      { label: 'Deaths/s', color: '#ff9d5e', data: h.deaths },
    ], {});
  },

  traits(canvas, sim) {
    const ctx = canvas.getContext('2d');
    const h = sim.history;
    this._line(ctx, canvas.width, canvas.height, [
      { label: 'Speed', color: '#ffd166', data: h.avgSpeed },
      { label: 'Vision×0.01', color: '#06d6a0', data: h.avgVision.map((v) => v / 100) },
      { label: 'Size', color: '#c792ea', data: h.avgSize },
      { label: 'Max gen×0.1', color: '#ff8fab', data: h.maxGen.map((v) => v / 10) },
    ], {});
  },

  // Histogram of a gene across the live population.
  histogram(canvas, sim, geneKey) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, hgt = canvas.height;
    ctx.clearRect(0, 0, w, hgt);
    const bins = 20;
    const counts = new Array(bins).fill(0);
    const cs = sim.world.creatures;
    for (const c of cs) {
      const v = c.genome.norm(geneKey);
      counts[Utils.clamp(Math.floor(v * bins), 0, bins - 1)]++;
    }
    const max = Math.max(1, ...counts);
    const bw = w / bins;
    const def = GENE_DEFS[geneKey];
    for (let i = 0; i < bins; i++) {
      const bh = (counts[i] / max) * (hgt - 18);
      const hue = Utils.lerp(200, 320, i / bins);
      ctx.fillStyle = Utils.hsl(hue, 70, 55);
      ctx.fillRect(i * bw + 1, hgt - 14 - bh, bw - 2, bh);
    }
    ctx.fillStyle = 'rgba(220,225,235,0.8)';
    ctx.font = '10px ui-sans-serif, sans-serif';
    ctx.fillText(def.label + `  (${def.min}–${def.max})`, 4, hgt - 3);
  },

  // Phylogenetic tree of emergent species over time.
  // x = sim time, each species = a colored horizontal lifeline, verticals
  // connect a species to the ancestor it branched from. Returns hit data.
  lineageTree(canvas, sim, opts = {}) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1019'; ctx.fillRect(0, 0, W, H);

    let nodes = [...sim.phylo.nodes.values()].filter((n) => !n.isRoot);
    if (opts.pruneMinor) nodes = nodes.filter((n) => n.alive || n.peakPop >= 3);
    if (nodes.length === 0) {
      ctx.fillStyle = 'rgba(220,225,235,0.5)'; ctx.font = '11px ui-sans-serif';
      ctx.fillText('No lineages have branched yet — let it run a while…', 12, 24);
      canvas._lineageHit = null; return;
    }

    const tMax = Math.max(1, sim.simTime);
    const pad = { l: 8, r: 70, t: 10, b: 18 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const tx = (t) => pad.l + (plotW * t) / tMax;

    // order lanes by a DFS through the ancestry so relatives sit together
    const idset = new Set(nodes.map((n) => n.id));
    const childrenOf = new Map();
    for (const n of nodes) {
      const p = (n.parent != null && idset.has(n.parent)) ? n.parent : 'ROOT';
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(n);
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => a.birthTime - b.birthTime);
    const order = [];
    const seen = new Set();
    const visit = (key) => {
      for (const k of (childrenOf.get(key) || [])) {
        if (seen.has(k.id)) continue;
        seen.add(k.id); order.push(k); visit(k.id);
      }
    };
    visit('ROOT');
    for (const n of nodes) if (!seen.has(n.id)) { order.push(n); seen.add(n.id); }

    const laneH = plotH / order.length;
    const laneY = new Map();
    order.forEach((n, i) => laneY.set(n.id, pad.t + laneH * (i + 0.5)));

    // time gridlines
    ctx.font = '9px ui-monospace, monospace';
    for (let g = 0; g <= 5; g++) {
      const t = (tMax * g) / 5, x = tx(t);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
      ctx.fillStyle = 'rgba(220,225,235,0.45)';
      ctx.fillText(Math.round(t) + 's', x + 2, H - 6);
    }

    // ancestry connectors
    for (const n of order) {
      if (n.parent == null || !laneY.has(n.parent)) continue;
      const x = tx(n.birthTime);
      ctx.strokeStyle = Utils.hsl(n.hue, 50, 45, 0.45);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, laneY.get(n.parent));
      ctx.lineTo(x, laneY.get(n.id));
      ctx.stroke();
    }

    // species lifelines
    const hit = [];
    for (const n of order) {
      const y = laneY.get(n.id);
      const x0 = tx(n.birthTime);
      const x1 = tx(n.alive ? tMax : n.lastSeen);
      const lw = Utils.clamp(1 + Math.log2((n.peakPop || 1) + 1), 1, Math.max(2, laneH * 0.7));
      ctx.strokeStyle = Utils.hsl(n.hue, n.carn ? 70 : 55, n.alive ? 58 : 36, n.alive ? 0.95 : 0.5);
      ctx.lineWidth = lw;
      ctx.setLineDash(n.alive ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(Math.max(x1, x0 + 1), y); ctx.stroke();
      ctx.setLineDash([]);

      // birth marker
      ctx.fillStyle = Utils.hsl(n.hue, 70, 62);
      ctx.beginPath(); ctx.arc(x0, y, Math.max(1.5, lw * 0.55), 0, Utils.TAU); ctx.fill();
      if (!n.alive) {
        // extinction ✕
        ctx.strokeStyle = 'rgba(255,120,120,0.7)'; ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1 - 2.5, y - 2.5); ctx.lineTo(x1 + 2.5, y + 2.5);
        ctx.moveTo(x1 + 2.5, y - 2.5); ctx.lineTo(x1 - 2.5, y + 2.5);
        ctx.stroke();
      }

      if (laneH >= 9 && (n.alive || n.peakPop >= 4)) {
        ctx.fillStyle = n.alive ? 'rgba(220,225,235,0.8)' : 'rgba(160,168,182,0.6)';
        ctx.font = '9px ui-sans-serif, sans-serif'; ctx.textAlign = 'left';
        const lbl = (n.carn ? '🦊' : '🐰') + '#' + n.id + (n.alive && n.curPop ? ` (${n.curPop})` : '');
        ctx.fillText(lbl, Math.min(x1 + 5, W - pad.r + 2), y + 3);
      }
      hit.push({ id: n.id, x0, x1, y, alive: n.alive, node: n });
    }
    ctx.textAlign = 'left';
    canvas._lineageHit = { hit, laneH };
  },

  // Muller plot: a centered streamgraph of each lineage's population over
  // time. Band thickness ∝ that species' count; total height ∝ total pop,
  // so you see both who dominates and overall booms/busts.
  muller(canvas, sim) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0b1019'; ctx.fillRect(0, 0, W, H);
    const snaps = sim.muller;
    if (!snaps || snaps.length < 2) {
      ctx.fillStyle = 'rgba(220,225,235,0.5)'; ctx.font = '11px ui-sans-serif';
      ctx.fillText('Gathering population history…', 12, 24);
      return;
    }
    const pad = { l: 8, r: 8, t: 8, b: 18 };
    const plotW = W - pad.l - pad.r;
    const plotH = H - pad.t - pad.b;
    const n = snaps.length;
    const xAt = (j) => pad.l + (plotW * j) / (n - 1);

    // global species order by first appearance (stable bands)
    const firstSeen = new Map();
    let maxTotal = 1;
    for (let j = 0; j < n; j++) {
      let total = 0;
      for (const k in snaps[j].counts) {
        const id = +k, c = snaps[j].counts[k];
        total += c;
        if (!firstSeen.has(id)) firstSeen.set(id, j);
      }
      if (total > maxTotal) maxTotal = total;
    }
    const order = [...firstSeen.keys()].sort((a, b) =>
      (firstSeen.get(a) - firstSeen.get(b)) || (a - b));

    // per-column stacked band intervals, centered
    const cy = pad.t + plotH / 2;
    const bands = new Map(); // id -> [{x,y0,y1}]
    for (const id of order) bands.set(id, []);
    for (let j = 0; j < n; j++) {
      const counts = snaps[j].counts;
      let total = 0;
      for (const id of order) total += counts[id] || 0;
      const hCol = (total / maxTotal) * plotH;
      let cum = cy - hCol / 2;
      const x = xAt(j);
      for (const id of order) {
        const c = counts[id] || 0;
        const bh = (c / maxTotal) * plotH;
        bands.get(id).push({ x, y0: cum, y1: cum + bh });
        cum += bh;
      }
    }

    // draw bands
    for (const id of order) {
      const pts = bands.get(id);
      const node = sim.phylo.nodes.get(id);
      const hue = node ? node.hue : (id * 47) % 360;
      const carn = node ? node.carn : false;
      ctx.fillStyle = Utils.hsl(hue, carn ? 70 : 58, carn ? 50 : 55, 0.9);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y0);
      for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y0);
      for (let j = pts.length - 1; j >= 0; j--) ctx.lineTo(pts[j].x, pts[j].y1);
      ctx.closePath();
      ctx.fill();
    }

    // time axis
    ctx.font = '9px ui-monospace, monospace'; ctx.fillStyle = 'rgba(220,225,235,0.45)';
    for (let g = 0; g <= 4; g++) {
      const j = Math.floor((n - 1) * g / 4);
      ctx.fillText(Math.round(snaps[j].t) + 's', Math.min(xAt(j), W - 28), H - 5);
    }
  },

  // Visualize a creature's neural net with live activations.
  brain(canvas, creature) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!creature) return;
    const net = creature.brain;
    const inLabels = ['energy', 'age', 'speed', 'bias', 'light',
      'food✦', 'food↕', 'food↔', 'prey✦', 'prey↕', 'prey↔',
      'threat✦', 'threat↕', 'threat↔', 'wall'];
    const outLabels = ['turn', 'throttle', 'eat/atk', 'reproduce'];

    const layers = [net.nIn, net.nHid, net.nOut];
    const acts = [creature.lastInputs, net._hid, creature.lastOutputs];
    const colX = [40, w / 2, w - 60];
    const nodePos = layers.map((count, li) => {
      const arr = [];
      for (let i = 0; i < count; i++) {
        arr.push({ x: colX[li], y: 14 + (h - 28) * (count === 1 ? 0.5 : i / (count - 1)) });
      }
      return arr;
    });

    // edges (w1 then w2), colored by sign, alpha by magnitude
    ctx.lineWidth = 0.6;
    let k = 0;
    for (let hI = 0; hI < net.nHid; hI++) {
      for (let iI = 0; iI < net.nIn; iI++) {
        const wt = net.w[k++];
        ctx.strokeStyle = wt > 0 ? `rgba(90,200,120,${Math.min(0.6, Math.abs(wt) / 4)})`
          : `rgba(220,90,90,${Math.min(0.6, Math.abs(wt) / 4)})`;
        ctx.beginPath();
        ctx.moveTo(nodePos[0][iI].x, nodePos[0][iI].y);
        ctx.lineTo(nodePos[1][hI].x, nodePos[1][hI].y);
        ctx.stroke();
      }
      k++; // bias
    }
    for (let oI = 0; oI < net.nOut; oI++) {
      for (let hI = 0; hI < net.nHid; hI++) {
        const wt = net.w[k++];
        ctx.strokeStyle = wt > 0 ? `rgba(90,200,120,${Math.min(0.6, Math.abs(wt) / 4)})`
          : `rgba(220,90,90,${Math.min(0.6, Math.abs(wt) / 4)})`;
        ctx.beginPath();
        ctx.moveTo(nodePos[1][hI].x, nodePos[1][hI].y);
        ctx.lineTo(nodePos[2][oI].x, nodePos[2][oI].y);
        ctx.stroke();
      }
      k++; // bias
    }

    // nodes
    ctx.font = '8px ui-monospace, monospace';
    for (let li = 0; li < 3; li++) {
      for (let i = 0; i < nodePos[li].length; i++) {
        const p = nodePos[li][i];
        const a = acts[li] ? acts[li][i] : 0;
        const mag = Utils.clamp(Math.abs(a), 0, 1);
        ctx.fillStyle = a >= 0 ? Utils.hsl(140, 70, 30 + mag * 45)
          : Utils.hsl(0, 70, 30 + mag * 45);
        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Utils.TAU); ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 0.5; ctx.stroke();
        if (li === 0) {
          ctx.fillStyle = 'rgba(220,225,235,0.7)'; ctx.textAlign = 'right';
          ctx.fillText(inLabels[i] || '', p.x - 8, p.y + 3);
        } else if (li === 2) {
          ctx.fillStyle = 'rgba(220,225,235,0.85)'; ctx.textAlign = 'left';
          ctx.fillText(outLabels[i] || '', p.x + 9, p.y + 3);
        }
      }
    }
    ctx.textAlign = 'left';
  },
};
