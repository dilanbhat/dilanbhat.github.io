/* ====================================================================
 * main.js  —  wires the simulation, renderer, UI, and all input.
 * ==================================================================== */

(function () {
  let sim = new Simulation();
  const canvas = document.getElementById('view');
  let renderer = new Renderer(canvas, sim);
  UI.init();

  let running = true;
  let speed = 3;          // sim steps per rendered frame
  let tool = 'select';
  let brush = 36;
  let followSelected = false;
  let lineageView = 'tree';
  let champSig = '';
  const minimap = document.getElementById('minimap');

  // ---------- main loop ----------
  let acc = 0, lastChart = 0;
  function frame(ts) {
    if (running) {
      for (let i = 0; i < speed; i++) sim.step();
    }
    if (followSelected && renderer.selected && renderer.selected.alive) {
      renderer.cam.x = renderer.selected.x;
      renderer.cam.y = renderer.selected.y;
    }
    // terrain edits from disasters invalidate the cached terrain
    if (sim._terrainDirty) { renderer.markTerrainDirty(); sim._terrainDirty = false; }
    renderer.render();
    renderer.renderMinimap(minimap);

    // throttle the heavier DOM/chart updates to ~6 fps
    if (ts - lastChart > 160) {
      lastChart = ts;
      UI.liveStats(sim);
      UI.seasonBadge(sim);
      updateCharts();
      if (renderer.selected && renderer.selected.alive) UI.refreshInspector(renderer.selected);
      else if (renderer.selected && !renderer.selected.alive) { renderer.selected = null; UI.hideInspector(); }
      if (activeTab === 'species') UI.renderSpecies(sim, selectCreature);
      if (activeTab === 'lineage') updateLineage();
      if (activeTab === 'chronicle') UI.renderChronicle(sim);
      if (activeTab === 'champions') {
        const sig = (sim.hallOfFame[0] ? sim.hallOfFame[0].fitness : 0) + 'x' + sim.hallOfFame.length;
        if (sig !== champSig) { champSig = sig; UI.renderChampions(sim, spawnChampion); }
      }
    }
    requestAnimationFrame(frame);
  }

  function updateCharts() {
    Charts.population(document.getElementById('chPop'), sim);
    Charts.ecology(document.getElementById('chEco'), sim);
    Charts.vitals(document.getElementById('chVit'), sim);
    Charts.traits(document.getElementById('chTraits'), sim);
    Charts.histogram(document.getElementById('chHist'), sim, document.getElementById('histGene').value);
  }

  // ---------- transport ----------
  const btnPlay = document.getElementById('btnPlay');
  btnPlay.onclick = () => { running = !running; btnPlay.textContent = running ? '⏸ Pause' : '▶ Play'; btnPlay.classList.toggle('primary', !running); };
  document.getElementById('btnStep').onclick = () => { sim.step(); renderer.render(); UI.liveStats(sim); updateCharts(); };
  const speedEl = document.getElementById('speed');
  speedEl.oninput = () => { speed = +speedEl.value; document.getElementById('speedLabel').textContent = speed + '×'; };

  // ---------- fast-forward (headless) ----------
  const overlay = document.getElementById('turboOverlay');
  let turbo = false;
  document.getElementById('btnTurbo').onclick = () => startTurbo();
  document.getElementById('btnStopTurbo').onclick = () => { turbo = false; };
  function startTurbo() {
    turbo = true;
    overlay.classList.remove('hidden');
    const targetGen = sim.maxGeneration + 25;
    const prog = document.getElementById('turboProgress');
    function chunk() {
      if (!turbo) { finishTurbo(); return; }
      // run a big batch of steps without rendering
      for (let i = 0; i < 400; i++) sim.step();
      prog.textContent = `generation ${sim.maxGeneration} · ${sim.world.creatures.length} alive · ${Math.floor(sim.simTime)}s`;
      if (sim.maxGeneration >= targetGen) { finishTurbo(); return; }
      setTimeout(chunk, 0); // yield so the spinner animates
    }
    chunk();
  }
  function finishTurbo() {
    turbo = false;
    overlay.classList.add('hidden');
    UI.toast('Fast-forward complete — gen ' + sim.maxGeneration);
  }

  // ---------- world reset / save / load ----------
  document.getElementById('btnReset').onclick = () => {
    const scenario = document.getElementById('scenario').value;
    sim = new Simulation(96, 64, 12, scenario);
    renderer = new Renderer(canvas, sim);
    bindRendererControls();
    renderer.selected = null; UI.hideInspector();
    // reflect scenario param presets back into the sliders
    document.getElementById('foodGrowth').value = sim.params.foodGrowth;
    document.getElementById('energyDrain').value = sim.params.energyDrain;
    document.getElementById('disasters').checked = sim.params.disasters;
    document.querySelectorAll('[data-out="foodGrowth"]').forEach((o) => o.textContent = sim.params.foodGrowth.toFixed(2));
    document.querySelectorAll('[data-out="energyDrain"]').forEach((o) => o.textContent = sim.params.energyDrain.toFixed(2));
    UI.toast(`New world: ${scenario}`);
  };
  document.getElementById('btnSave').onclick = () => {
    const blob = new Blob([sim.save()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `biosphere-gen${sim.maxGeneration}-${Date.now()}.json`;
    a.click();
    UI.toast('World saved to file');
  };
  document.getElementById('btnLoad').onclick = () => document.getElementById('fileLoad').click();
  document.getElementById('fileLoad').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        sim = Simulation.load(reader.result);
        renderer = new Renderer(canvas, sim);
        bindRendererControls();
        UI.toast('World loaded');
      } catch (err) { UI.toast('Load failed: ' + err.message); }
    };
    reader.readAsText(file);
  };

  // ---------- environment sliders ----------
  function bindSlider(id, fn, fmt) {
    const el = document.getElementById(id);
    const out = document.querySelector(`[data-out="${id}"]`);
    const update = () => { fn(+el.value); if (out) out.textContent = fmt ? fmt(+el.value) : (+el.value).toFixed(2); };
    el.oninput = update; update();
  }
  bindSlider('foodGrowth', (v) => sim.params.foodGrowth = v);
  bindSlider('energyDrain', (v) => sim.params.energyDrain = v);
  bindSlider('mutationScale', (v) => sim.params.mutationScale = v);
  bindSlider('turnRate', (v) => sim.params.turnRate = v);
  bindSlider('brush', (v) => brush = v, (v) => v + 'px');
  document.getElementById('dayNight').onchange = (e) => sim.params.dayNight = e.target.checked;
  document.getElementById('autoRespawn').onchange = (e) => sim.params.autoRespawn = e.target.checked;
  document.getElementById('seasons').onchange = (e) => sim.params.seasons = e.target.checked;
  document.getElementById('disasters').onchange = (e) => sim.params.disasters = e.target.checked;

  // ---------- disaster trigger buttons ----------
  document.querySelectorAll('[data-disaster]').forEach((b) => {
    b.onclick = () => { sim.triggerDisaster(b.dataset.disaster); UI.toast(b.textContent.trim() + ' triggered'); };
  });

  // ---------- minimap navigation ----------
  function minimapPan(e) {
    const r = minimap.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    renderer.cam.x = Utils.clamp(fx, 0, 1) * sim.world.width;
    renderer.cam.y = Utils.clamp(fy, 0, 1) * sim.world.height;
  }
  let miniDrag = false;
  minimap.addEventListener('mousedown', (e) => { miniDrag = true; minimapPan(e); });
  minimap.addEventListener('mousemove', (e) => { if (miniDrag) minimapPan(e); });
  window.addEventListener('mouseup', () => { miniDrag = false; });

  // Re-point slider closures at the new sim after reset/load.
  function rebindParams() {
    sim.params.foodGrowth = +document.getElementById('foodGrowth').value;
    sim.params.energyDrain = +document.getElementById('energyDrain').value;
    sim.params.mutationScale = +document.getElementById('mutationScale').value;
    sim.params.turnRate = +document.getElementById('turnRate').value;
    sim.params.dayNight = document.getElementById('dayNight').checked;
    sim.params.autoRespawn = document.getElementById('autoRespawn').checked;
    sim.params.seasons = document.getElementById('seasons').checked;
    sim.params.disasters = document.getElementById('disasters').checked;
  }

  // ---------- view controls ----------
  function bindRendererControls() {
    rebindParams();
    renderer.colorMode = document.getElementById('colorMode').value;
    renderer.overlay = document.getElementById('overlay').value;
    renderer.showVision = document.getElementById('showVision').checked;
  }
  document.getElementById('colorMode').onchange = (e) => renderer.colorMode = e.target.value;
  document.getElementById('overlay').onchange = (e) => renderer.overlay = e.target.value;
  document.getElementById('showVision').onchange = (e) => renderer.showVision = e.target.checked;
  document.getElementById('histGene').onchange = updateCharts;

  // ---------- tool palette ----------
  document.querySelectorAll('.tool').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tool').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      tool = b.dataset.tool;
      canvas.style.cursor = tool === 'select' ? 'pointer' : 'crosshair';
    };
  });

  // ---------- lineage tree ----------
  const lineageCanvas = document.getElementById('chLineage');
  const pruneEl = document.getElementById('pruneMinor');
  const mullerCanvas = document.getElementById('chMuller');
  function updateLineage() {
    if (lineageView === 'muller') {
      const w = mullerCanvas.clientWidth || 320;
      if (mullerCanvas.width !== w) mullerCanvas.width = w;
      if (mullerCanvas.height !== 300) mullerCanvas.height = 300;
      Charts.muller(mullerCanvas, sim);
    } else {
      const w = lineageCanvas.clientWidth || 320;
      if (lineageCanvas.width !== w) lineageCanvas.width = w;
      if (lineageCanvas.height !== 380) lineageCanvas.height = 380;
      Charts.lineageTree(lineageCanvas, sim, { pruneMinor: pruneEl.checked });
    }
  }
  pruneEl.onchange = updateLineage;
  document.querySelectorAll('.segbtn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.segbtn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      lineageView = b.dataset.view;
      document.getElementById('treeView').classList.toggle('hidden', lineageView !== 'tree');
      document.getElementById('mullerView').classList.toggle('hidden', lineageView !== 'muller');
      updateLineage();
    };
  });

  // hit-test a pointer position against the tree's lifelines
  function lineageHitAt(e) {
    const data = lineageCanvas._lineageHit;
    if (!data) return null;
    const r = lineageCanvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (lineageCanvas.width / r.width);
    const y = (e.clientY - r.top) * (lineageCanvas.height / r.height);
    let best = null, bestDy = Math.max(6, data.laneH);
    for (const h of data.hit) {
      if (x < h.x0 - 4 || x > h.x1 + 44) continue;
      const dy = Math.abs(y - h.y);
      if (dy < bestDy) { bestDy = dy; best = h; }
    }
    return best;
  }

  // ---------- lineage hover tooltip ----------
  const tip = document.createElement('div');
  tip.id = 'lineageTip';
  document.body.appendChild(tip);
  lineageCanvas.addEventListener('mousemove', (e) => {
    const h = lineageHitAt(e);
    if (!h || !h.node) { tip.classList.remove('show'); lineageCanvas.style.cursor = 'default'; return; }
    const n = h.node;
    const g = n.exemplarGenome;
    const lifeEnd = n.alive ? sim.simTime : n.lastSeen;
    const trait = (k, d = 2) => g ? (g.val(k) >= 10 ? g.val(k).toFixed(0) : g.val(k).toFixed(d)) : '—';
    tip.innerHTML = `
      <div class="tip-title"><span class="tip-dot" style="background:${Utils.hsl(n.hue, 65, 58)}"></span>
        ${n.carn ? '🦊 Carnivore' : '🐰 Herbivore'} lineage #${n.id}</div>
      <div class="tip-row">Status: <b>${n.alive ? 'alive' : 'extinct'}</b>${n.alive ? ` · <b>${n.curPop}</b> now` : ''} · peak <b>${n.peakPop}</b></div>
      <div class="tip-row">Branched from: <b>${n.parent === 0 || n.parent == null ? 'origin' : '#' + n.parent}</b> at gen <b>${n.birthGen || 0}</b></div>
      <div class="tip-row">Lifespan: <b>${(lifeEnd - n.birthTime).toFixed(0)}s</b> (${n.birthTime.toFixed(0)}s → ${lifeEnd.toFixed(0)}s)</div>
      <div class="tip-traits">size <b>${trait('size')}</b> · speed <b>${trait('speed')}</b> · vision <b>${trait('vision')}</b> · diet <b>${(g ? g.val('diet') * 100 : 0).toFixed(0)}%</b> carn · aggr <b>${trait('aggression')}</b></div>`;
    tip.style.left = Math.min(e.clientX + 14, window.innerWidth - 244) + 'px';
    tip.style.top = (e.clientY + 14) + 'px';
    tip.classList.add('show');
    lineageCanvas.style.cursor = h.alive ? 'pointer' : 'default';
  });
  lineageCanvas.addEventListener('mouseleave', () => tip.classList.remove('show'));

  lineageCanvas.addEventListener('click', (e) => {
    const best = lineageHitAt(e);
    if (!best) return;
    const member = sim.world.creatures.find((c) => c.species === best.id);
    if (member) selectCreature(member);
    else UI.toast(`Lineage #${best.id} is extinct`);
  });

  // ---------- tabs ----------
  let activeTab = 'analytics';
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.tabpage').forEach((p) => p.classList.add('hidden'));
      t.classList.add('active');
      activeTab = t.dataset.tab;
      document.querySelector(`[data-page="${activeTab}"]`).classList.remove('hidden');
      if (activeTab === 'species') UI.renderSpecies(sim, selectCreature);
      if (activeTab === 'lineage') updateLineage();
      if (activeTab === 'chronicle') UI.renderChronicle(sim);
      if (activeTab === 'champions') { champSig = ''; UI.renderChampions(sim, spawnChampion); }
    };
  });

  // Drop a clone of a hall-of-fame champion back into the world.
  function spawnChampion(entry) {
    const g = Genome.fromJSON(entry.genome);
    const b = NeuralNet.fromJSON(entry.brain);
    const c = sim.spawnRandom(entry.carn ? 'carn' : 'herb', g, b);
    c.energy = c.maxEnergy * 0.9;
    selectCreature(c);
    UI.toast(`Spawned champion (fitness ${entry.fitness})`);
  }

  // ---------- inspector actions ----------
  function selectCreature(c) {
    renderer.selected = c;
    UI.showInspector(c);
    // jump to inspect tab
    document.querySelector('.tab[data-tab="inspect"]').click();
  }
  document.getElementById('btnFollow').onclick = () => {
    followSelected = !followSelected;
    UI.toast(followSelected ? 'Following creature' : 'Stopped following');
  };
  document.getElementById('btnBreed').onclick = () => {
    const c = renderer.selected;
    if (!c || !c.alive) return;
    for (let i = 0; i < 3; i++) {
      const g = c.genome.clone().mutate(0.2, 0.12);
      const b = c.brain.clone(); b.mutate(0.2, 0.25);
      const child = sim.spawnRandom(c.isCarnivore ? 'carn' : 'herb', g, b);
      child.x = Utils.clamp(c.x + Utils.randRange(-20, 20), 1, sim.world.width - 1);
      child.y = Utils.clamp(c.y + Utils.randRange(-20, 20), 1, sim.world.height - 1);
    }
    UI.toast('Spawned 3 mutated offspring');
  };

  // ---------- canvas input: pan / zoom / paint / pick ----------
  let dragging = false, painting = false, lastPan = null;
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const wp = renderer.screenToWorld(sx, sy);
    if (tool === 'select') {
      const picked = renderer.pick(wp.x, wp.y);
      if (picked) { selectCreature(picked); }
      else { dragging = true; lastPan = { x: e.clientX, y: e.clientY }; }
    } else {
      painting = true;
      applyTool(wp);
    }
  });
  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (dragging && lastPan) {
      renderer.cam.x -= (e.clientX - lastPan.x) / renderer.cam.zoom;
      renderer.cam.y -= (e.clientY - lastPan.y) / renderer.cam.zoom;
      lastPan = { x: e.clientX, y: e.clientY };
    } else if (painting) {
      applyTool(renderer.screenToWorld(sx, sy));
    }
  });
  window.addEventListener('mouseup', () => { dragging = false; painting = false; lastPan = null; });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const before = renderer.screenToWorld(sx, sy);
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    renderer.cam.zoom = Utils.clamp(renderer.cam.zoom * factor, 0.25, 8);
    const after = renderer.screenToWorld(sx, sy);
    renderer.cam.x += before.x - after.x;
    renderer.cam.y += before.y - after.y;
  }, { passive: false });

  function applyTool(wp) {
    const w = sim.world;
    switch (tool) {
      case 'food': case 'grass': case 'water': case 'rock': case 'dirt': case 'erase-food':
        w.paint(wp.x, wp.y, brush, tool);
        if (tool !== 'food' && tool !== 'erase-food') renderer.markTerrainDirty();
        break;
      case 'addHerb':
        if (!w.isBlocked(wp.x, wp.y)) { const c = new Creature(wp.x, wp.y, Genome.randomHerbivore()); w.addCreature(c); }
        break;
      case 'addCarn':
        if (!w.isBlocked(wp.x, wp.y)) { const c = new Creature(wp.x, wp.y, Genome.randomCarnivore()); w.addCreature(c); }
        break;
      case 'kill': {
        const r2 = brush * brush;
        for (const c of w.creatures) if (Utils.dist2(c.x, c.y, wp.x, wp.y) < r2) c.alive = false;
        break;
      }
    }
  }

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); btnPlay.click(); }
    else if (e.key === '.') document.getElementById('btnStep').click();
    else if (e.key === 'f') startTurbo();
    else if (e.key === 'v') { const v = document.getElementById('showVision'); v.checked = !v.checked; v.onchange({ target: v }); }
  });

  // ---------- resize ----------
  window.addEventListener('resize', () => renderer.resize());

  // Expose live handles for the dev console / power users.
  window.BioSphere = {
    get sim() { return sim; },
    get renderer() { return renderer; },
    select: selectCreature,
  };

  // go
  bindRendererControls();
  requestAnimationFrame(frame);
  UI.toast('Welcome to BioSphere — press Space to pause');
})();
