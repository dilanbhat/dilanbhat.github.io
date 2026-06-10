# BioSphere — Evolving Creature Simulation

An in-depth, browser-based ecosystem where creatures with **neural-net brains** and
**heritable genetic traits** co-evolve under natural selection. Watch life emerge,
sculpt the environment, inspect any creature's brain, and fast-forward through
generations.

> This grew out of the original Java `UnitGame` prototype (still in `src/`). The
> full simulation runs directly from this folder in the browser — no build step.

## Run it locally

```bash
python3 -m http.server 8777
# open http://localhost:8777/biosphere/
```

On the published site, BioSphere lives at `/biosphere/`.

## What's simulated

- **Dual-layer evolution** — each creature has a feed-forward neural network (brain)
  *and* a genome of physical traits (size, speed, vision, field-of-view, metabolism,
  diet, aggression, fertility, color, mutability). Both mutate and cross over on
  reproduction.
- **Full ecology** — procedurally generated terrain (grass, water, rock, dirt),
  plants that regrow with daylight, herbivores, carnivores, and corpses that decay
  back into the soil to fertilize new growth.
- **Emergent behavior** — food-seeking, fleeing, hunting, and herding arise on their
  own from selection; nothing is hard-coded.
- **Day/night cycle** affecting vision range and plant growth.
- **Seasons & disasters** — a Spring→Winter cycle modulates food and metabolism, and
  catastrophes (drought, superbloom, plague, meteor impacts that crater the terrain)
  strike randomly or on demand, driving real selection.
- **Species clustering** — live genetic clustering labels emergent species/lineages.
- **Phylogenetic tree** — a time-based lineage tree records when species branch from
  an ancestor (tracked through real parent→child ancestry), how big each got, and
  when they go extinct. Click a living lineage to inspect a member; hover for details.
- **Scenario presets** — generate tuned worlds: Balanced, Eden (lush & peaceful),
  Predator pressure, Archipelago, or Harsh desert.

## What you can do

- **Watch** — pan (drag), zoom (scroll), a **mini-map** for navigation, adjustable
  speed, color creatures by species / diet / energy / generation, toggle vision cones,
  and **heatmap overlays** (where creatures live, where they die, food pressure).
- **Edit the environment (god mode)** — paint grass/water/rock/dirt/food, drop
  herbivores or carnivores, remove creatures, adjustable brush.
- **Tune the world live** — plant growth, energy drain, mutation rate, turn agility,
  day/night, seasons, disasters, auto-respawn floor; trigger disasters manually.
- **Train & analyze** — live charts (population, plant cover, births/deaths, average
  traits, gene-distribution histograms), a phylogenetic **lineage tree** + **Muller
  plot** of who dominates over time, a **chronicle** narrating major events, a
  **Hall of Fame** of all-time champion creatures (re-spawnable as clones), inspect
  any creature's brain with live activations and gene bars, manually breed favorites,
  fast-forward many generations headless, and save/load whole worlds to JSON.

## Keyboard

`Space` play/pause · `.` step · `f` fast-forward · `v` toggle vision cones

## Code layout (`js/`)

| File | Responsibility |
|------|----------------|
| `utils.js` | RNG, math, vector & color helpers |
| `nn.js` | tiny feed-forward neural network (brain) |
| `genome.js` | heritable trait genome + mutation/crossover |
| `creature.js` | agent: sensing, brain, energy, eating, reproduction |
| `world.js` | terrain, plants, corpses, day/night, spatial hash |
| `simulation.js` | tick loop, stats history, species clustering, save/load |
| `renderer.js` | canvas rendering, pan/zoom, selection |
| `charts.js` | analytics charts + neural-net visualizer |
| `ui.js` | inspector, species list, gene bars, toasts |
| `main.js` | game loop + all input/control wiring |

For power users, `window.BioSphere` exposes the live `sim` and `renderer` in the
dev console.
