/* ====================================================================
 * creature.js  —  an agent with a genome (body) and a neural net (brain)
 * ==================================================================== */

const BRAIN_IN = 15;
const BRAIN_HID = 10;
const BRAIN_OUT = 4;

let _nextCreatureId = 1;

class Creature {
  constructor(x, y, genome, brain, generation = 0, parentId = 0) {
    this.id = _nextCreatureId++;
    this.x = x;
    this.y = y;
    this.heading = Utils.randRange(-Math.PI, Math.PI);
    this.genome = genome;
    this.brain = brain || new NeuralNet(BRAIN_IN, BRAIN_HID, BRAIN_OUT);
    this.generation = generation;
    this.parentId = parentId;
    this.species = 0;       // current cluster id, assigned by simulation
    this.birthSpecies = 0;  // parent's species at birth — fixed ancestry pointer

    this.size = genome.val('size');
    this.maxSpeed = genome.val('speed') * 28; // world units / sec
    this.vision = genome.val('vision');
    this.fov = genome.val('fov');
    this.diet = genome.val('diet');

    this.energy = 80 + this.size * 30;
    this.maxEnergy = genome.val('reproEnergy') + 120;
    this.age = 0;
    this.maxAge = 45 + (1 - this.diet) * 35 + Utils.randRange(0, 20);
    this.alive = true;

    this.eatCooldown = 0;
    this.reproCooldown = 2;
    this.attackFlash = 0;
    this.eatFlash = 0;
    this.lastInputs = new Float32Array(BRAIN_IN);
    this.lastOutputs = new Float32Array(BRAIN_OUT);
    this.children = 0;
    this.foodEaten = 0;

    this._in = new Float32Array(BRAIN_IN);
  }

  get hue() { return this.genome.val('hue'); }
  get isCarnivore() { return this.diet > 0.55; }
  get isHerbivore() { return this.diet < 0.45; }

  // ---- sense the surroundings into the brain's input vector --------
  sense(world) {
    const inp = this._in;
    inp.fill(0);
    inp[0] = Utils.clamp(this.energy / this.maxEnergy, 0, 1) * 2 - 1;
    inp[1] = Utils.clamp(this.age / this.maxAge, 0, 1) * 2 - 1;
    inp[2] = 0; // filled with current speed by sim each tick
    inp[3] = 1; // bias
    inp[4] = world.lightLevel * 2 - 1;

    const visR = this.vision * Utils.lerp(0.5, 1.1, world.lightLevel);

    // nearest plant food
    const food = world.nearestFood(this.x, this.y, visR);
    if (food) {
      const a = Utils.wrapAngle(Math.atan2(food.y - this.y, food.x - this.x) - this.heading);
      inp[5] = 1 - Math.min(1, Math.sqrt(food.d2) / visR);
      inp[6] = Math.sin(a);
      inp[7] = Math.cos(a);
    }

    // nearest prey and nearest threat among creatures
    let prey = null, preyD2 = Infinity, threat = null, threatD2 = Infinity;
    world.forEachCreatureNear(this.x, this.y, visR, (o) => {
      if (o === this || !o.alive) return;
      const d2 = Utils.dist2(this.x, this.y, o.x, o.y);
      if (d2 > visR * visR) return;
      // is `o` prey to me? I'm carnivore-ish and bigger
      if (this.diet > 0.45 && this.size > o.size * 0.85) {
        if (d2 < preyD2) { preyD2 = d2; prey = o; }
      }
      // is `o` a threat? it is carnivore-ish and bigger than me
      if (o.diet > 0.45 && o.size > this.size * 0.85) {
        if (d2 < threatD2) { threatD2 = d2; threat = o; }
      }
    });
    if (prey) {
      const a = Utils.wrapAngle(Math.atan2(prey.y - this.y, prey.x - this.x) - this.heading);
      inp[8] = 1 - Math.min(1, Math.sqrt(preyD2) / visR);
      inp[9] = Math.sin(a);
      inp[10] = Math.cos(a);
    }
    if (threat) {
      const a = Utils.wrapAngle(Math.atan2(threat.y - this.y, threat.x - this.x) - this.heading);
      inp[11] = 1 - Math.min(1, Math.sqrt(threatD2) / visR);
      inp[12] = Math.sin(a);
      inp[13] = Math.cos(a);
    }
    // wall / obstacle ahead
    const ax = this.x + Math.cos(this.heading) * 14;
    const ay = this.y + Math.sin(this.heading) * 14;
    inp[14] = world.isBlocked(ax, ay) ? 1 : -1;

    this._prey = prey;
    this.lastInputs.set(inp);
    return inp;
  }

  // ---- one simulation step ---------------------------------------
  step(world, params, dt) {
    if (!this.alive) return;
    this.age += dt;
    this.eatCooldown = Math.max(0, this.eatCooldown - dt);
    this.reproCooldown = Math.max(0, this.reproCooldown - dt);
    this.attackFlash = Math.max(0, this.attackFlash - dt);
    this.eatFlash = Math.max(0, this.eatFlash - dt);

    const inp = this.sense(world);
    const speedNorm = (this._spd || 0) / this.maxSpeed;
    inp[2] = speedNorm * 2 - 1;
    const out = this.brain.forward(inp);
    this.lastOutputs.set(out);

    // outputs: 0 turn, 1 throttle, 2 eat/attack, 3 reproduce
    const turn = out[0] * params.turnRate * dt;
    this.heading = Utils.wrapAngle(this.heading + turn);
    const throttle = (out[1] + 1) * 0.5; // 0..1
    const speed = throttle * this.maxSpeed;
    this._spd = speed;

    let nx = this.x + Math.cos(this.heading) * speed * dt;
    let ny = this.y + Math.sin(this.heading) * speed * dt;
    if (world.isBlocked(nx, ny)) {
      // bounce: try sliding, else stop and turn
      if (!world.isBlocked(nx, this.y)) ny = this.y;
      else if (!world.isBlocked(this.x, ny)) nx = this.x;
      else { nx = this.x; ny = this.y; this.heading = Utils.wrapAngle(this.heading + Math.PI); }
    }
    nx = Utils.clamp(nx, 1, world.width - 1);
    ny = Utils.clamp(ny, 1, world.height - 1);
    this.x = nx; this.y = ny;

    // ---- energy cost -------------------------------------------
    const metab = this.genome.val('metabolism');
    const moveCost = 0.5 * this.size * (speed / 28) * (speed / 28);
    const baseCost = 0.04 + 0.05 * this.size;
    this.energy -= (baseCost + moveCost) * metab * params.energyDrain * dt * 12;

    // ---- eat plants --------------------------------------------
    if (this.diet < 0.85 && this.eatCooldown <= 0) {
      const bite = world.eatFoodAt(this.x, this.y, 0.9 * dt * 60);
      if (bite > 0) {
        const eff = (1 - this.diet) * 1.15;
        this.energy += bite * eff;
        this.foodEaten += bite * eff;
        this.eatFlash = 0.25;
      }
    }

    // ---- attack / eat creatures --------------------------------
    if (this.diet > 0.4 && out[2] > 0 && this.eatCooldown <= 0) {
      const target = this._prey;
      if (target && target.alive) {
        const d2 = Utils.dist2(this.x, this.y, target.x, target.y);
        const reach = (this.size + target.size) * 6 + 6;
        if (d2 < reach * reach) {
          const atk = this.size * (0.5 + this.genome.val('aggression'));
          const def = target.size * (0.6 + target.genome.val('aggression') * 0.4);
          if (atk > def * Utils.randRange(0.6, 1.1)) {
            const gain = (target.energy * 0.55 + target.size * 30) * (0.6 + this.diet * 0.6);
            this.energy += gain;
            this.foodEaten += gain;
            target.alive = false;
            target.killedByPredator = true;
            this.attackFlash = 0.4;
            this.eatCooldown = 0.6;
          } else {
            this.energy -= 4; // failed attack costs
            this.attackFlash = 0.2;
          }
        }
      }
    }

    if (this.energy > this.maxEnergy) this.energy = this.maxEnergy;

    // ---- reproduction ------------------------------------------
    const reproThresh = this.genome.val('reproEnergy');
    if (this.energy > reproThresh && out[3] > 0.1 && this.reproCooldown <= 0 &&
        Utils.rand() < this.genome.val('fertility') * dt * 1.5) {
      this.reproduce(world, params);
    }

    // ---- death -------------------------------------------------
    if (this.energy <= 0 || this.age >= this.maxAge) {
      this.alive = false;
    }
  }

  reproduce(world, params) {
    const childEnergy = 50 + this.size * 20;
    if (this.energy < childEnergy + 30) return;
    this.energy -= childEnergy + 20;
    this.reproCooldown = 3;
    this.children++;

    const mr = this.genome.val('mutability') * params.mutationScale;
    let childGenome, childBrain;

    // occasional sexual reproduction with a nearby compatible mate
    // Mates must be genetically close (reproductive isolation): this lets
    // diverging sub-populations stop interbreeding and split into new species.
    let mate = null;
    if (Utils.rand() < 0.5) {
      world.forEachCreatureNear(this.x, this.y, 40, (o) => {
        if (o === this || !o.alive || mate) return;
        if (Genome.distance(o.genome, this.genome) < 0.14) mate = o;
      });
    }
    if (mate) {
      childGenome = Genome.crossover(this.genome, mate.genome).mutate(mr, 0.12);
      childBrain = NeuralNet.crossover(this.brain, mate.brain);
      childBrain.mutate(mr, 0.25);
    } else {
      childGenome = this.genome.clone().mutate(mr, 0.12);
      childBrain = this.brain.clone();
      childBrain.mutate(mr, 0.25);
    }

    const angle = Utils.randRange(-Math.PI, Math.PI);
    const cx = Utils.clamp(this.x + Math.cos(angle) * 10, 1, world.width - 1);
    const cy = Utils.clamp(this.y + Math.sin(angle) * 10, 1, world.height - 1);
    const child = new Creature(cx, cy, childGenome, childBrain, this.generation + 1, this.id);
    child.energy = childEnergy;
    child.birthSpecies = this.species || 0; // remember the lineage we branched from
    world.addCreature(child);
  }

  toJSON() {
    return {
      x: this.x, y: this.y, heading: this.heading,
      genome: this.genome.toJSON(), brain: this.brain.toJSON(),
      generation: this.generation, parentId: this.parentId,
      energy: this.energy, age: this.age,
    };
  }
  static fromJSON(o) {
    const c = new Creature(o.x, o.y, Genome.fromJSON(o.genome),
      NeuralNet.fromJSON(o.brain), o.generation, o.parentId);
    c.heading = o.heading; c.energy = o.energy; c.age = o.age;
    return c;
  }
}
