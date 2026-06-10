/* ====================================================================
 * ui.js  —  DOM rendering helpers: live stats, inspector, gene bars,
 *           species list, histogram gene picker, toasts.
 * ==================================================================== */

const UI = {
  init() {
    // populate gene dropdown for the histogram
    const sel = document.getElementById('histGene');
    for (const k of GENE_KEYS) {
      const o = document.createElement('option');
      o.value = k; o.textContent = GENE_DEFS[k].label;
      sel.appendChild(o);
    }
    sel.value = 'diet';

    // toast element
    const t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
    this._toast = t;
  },

  toast(msg) {
    const t = this._toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  },

  liveStats(sim) {
    let herb = 0, carn = 0;
    for (const c of sim.world.creatures) (c.isCarnivore ? carn++ : herb++);
    const el = document.getElementById('liveStats');
    const stat = (v, label) => `<div class="stat"><b>${v}</b><small>${label}</small></div>`;
    el.innerHTML =
      stat(herb, 'herbivores') +
      stat(carn, 'carnivores') +
      stat(sim.maxGeneration, 'max gen') +
      stat(sim.speciesList.length, 'species') +
      stat(Math.floor(sim.simTime) + 's', 'sim time') +
      stat(sim.totals.births, 'births');
  },

  // ---- inspector ----
  showInspector(creature) {
    document.getElementById('inspectEmpty').classList.add('hidden');
    document.getElementById('inspectBody').classList.remove('hidden');
    this.refreshInspector(creature);
  },
  hideInspector() {
    document.getElementById('inspectEmpty').classList.remove('hidden');
    document.getElementById('inspectBody').classList.add('hidden');
  },

  refreshInspector(c) {
    if (!c) return;
    document.getElementById('inspName').textContent =
      `${c.isCarnivore ? '🦊 Carnivore' : c.isHerbivore ? '🐰 Herbivore' : '🦃 Omnivore'} #${c.id}`;

    const pct = (v) => (v * 100).toFixed(0) + '%';
    const stats = [
      ['Generation', c.generation],
      ['Energy', `${c.energy.toFixed(0)} / ${c.maxEnergy.toFixed(0)}`],
      ['Age', `${c.age.toFixed(1)} / ${c.maxAge.toFixed(0)}`],
      ['Children', c.children],
      ['Food eaten', c.foodEaten.toFixed(0)],
      ['Species', '#' + c.species],
      ['Diet', pct(c.diet) + ' carn'],
      ['Speed', c.maxSpeed.toFixed(0)],
      ['Vision', c.vision.toFixed(0)],
      ['Parent', c.parentId ? '#' + c.parentId : '—'],
    ];
    document.getElementById('inspStats').innerHTML =
      stats.map(([k, v]) => `<span class="k">${k}</span><span class="v">${v}</span>`).join('');

    Charts.brain(document.getElementById('chBrain'), c);

    // gene bars
    const gb = document.getElementById('geneBars');
    gb.innerHTML = GENE_KEYS.map((k) => {
      const norm = c.genome.norm(k);
      const real = c.genome.val(k);
      const hue = k === 'hue' ? real : Utils.lerp(210, 320, norm);
      const disp = k === 'hue' ? real.toFixed(0) + '°'
        : real >= 10 ? real.toFixed(0) : real.toFixed(2);
      return `<div class="genebar">
        <div class="lbl"><span>${GENE_DEFS[k].label}</span><b>${disp}</b></div>
        <div class="track"><div class="fill" style="width:${(norm * 100).toFixed(0)}%;background:${Utils.hsl(hue, 70, 55)}"></div></div>
      </div>`;
    }).join('');
  },

  seasonBadge(sim) {
    const el = document.getElementById('seasonBadge');
    if (!el) return;
    const icons = { Spring: '🌱', Summer: '☀️', Autumn: '🍂', Winter: '❄️', '—': '🌍' };
    const s = sim.season;
    let html = `${icons[s.name] || '🌍'} ${s.name}`;
    if (sim.activeDisaster) {
      const di = { drought: '🏜️ Drought', bloom: '🌸 Superbloom', plague: '☣️ Plague' };
      html += ` <span class="dis">· ${di[sim.activeDisaster.type] || ''} ${Math.ceil(sim.activeDisaster.timeLeft)}s</span>`;
    }
    el.innerHTML = html;
  },

  renderChronicle(sim) {
    const el = document.getElementById('chronicleList');
    if (!el) return;
    if (!sim.events.length) { el.innerHTML = '<p class="hint">No events yet…</p>'; return; }
    const fmt = (t) => {
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      return m > 0 ? `${m}m${s.toString().padStart(2, '0')}` : `${s}s`;
    };
    el.innerHTML = sim.events.slice(-60).reverse().map((e) =>
      `<div class="chron ${e.kind}"><span class="t">${fmt(e.time)}</span>` +
      `<span class="ico">${e.icon}</span><span class="tx">${e.text}</span></div>`).join('');
  },

  renderChampions(sim, onSpawn) {
    const el = document.getElementById('championList');
    if (!el) return;
    if (!sim.hallOfFame.length) {
      el.innerHTML = '<p class="hint">No champions yet — they enshrine here when notable creatures die. Let it run!</p>';
      return;
    }
    el.innerHTML = '';
    sim.hallOfFame.forEach((e, rank) => {
      const card = document.createElement('div');
      card.className = 'champ';
      const medal = ['🥇', '🥈', '🥉'][rank] || `#${rank + 1}`;
      card.innerHTML = `
        <canvas class="champ-emblem" width="46" height="46"></canvas>
        <div class="champ-meta">
          <div class="champ-title">${medal} ${e.carn ? '🦊 Carnivore' : '🐰 Herbivore'} <small>gen ${e.generation}</small></div>
          <div class="champ-stats">fitness <b>${e.fitness}</b> · 👶 ${e.children} · 🍽️ ${e.foodEaten} · ⏳ ${e.age}s</div>
          <div class="champ-stats">size ${e.size.toFixed(2)} · spd ${e.speed.toFixed(2)} · vis ${e.vision.toFixed(0)} · ${(e.diet * 100).toFixed(0)}% carn</div>
        </div>
        <button class="btn small champ-spawn">Spawn</button>`;
      // emblem
      const cv = card.querySelector('.champ-emblem');
      const cx = cv.getContext('2d');
      cx.translate(23, 23);
      const r = 13;
      cx.fillStyle = Utils.hsl(e.hue, 65, 56);
      cx.strokeStyle = e.carn ? 'rgba(255,210,210,0.9)' : 'rgba(0,0,0,0.4)';
      cx.lineWidth = 1.4;
      if (e.carn) {
        cx.beginPath(); cx.moveTo(r + 2, 0); cx.lineTo(-r, r * 0.8);
        cx.lineTo(-r * 0.4, 0); cx.lineTo(-r, -r * 0.8); cx.closePath();
      } else { cx.beginPath(); cx.arc(0, 0, r, 0, Utils.TAU); }
      cx.fill(); cx.stroke();
      cx.fillStyle = 'rgba(255,255,255,0.9)';
      cx.beginPath(); cx.arc(r * 0.5, 0, 3, 0, Utils.TAU); cx.fill();

      card.querySelector('.champ-spawn').onclick = () => onSpawn(e);
      el.appendChild(card);
    });
  },

  renderSpecies(sim, onPick) {
    const el = document.getElementById('speciesList');
    if (sim.speciesList.length === 0) { el.innerHTML = '<p class="hint">No clusters yet…</p>'; return; }
    el.innerHTML = '';
    for (const s of sim.speciesList) {
      const div = document.createElement('div');
      div.className = 'species-item';
      div.innerHTML = `
        <div class="species-dot" style="background:${Utils.hsl(s.hue, 65, 58)}"></div>
        <div class="meta">${s.carn ? '🦊 Carnivore' : '🐰 Herbivore'} lineage #${s.id}
          <small>avg generation ${s.avgGen.toFixed(1)}</small></div>
        <div class="cnt">${s.count}</div>`;
      div.onclick = () => {
        // find a live member of this species to inspect
        const member = sim.world.creatures.find((c) => c.species === s.id);
        if (member) onPick(member);
      };
      el.appendChild(div);
    }
  },
};
