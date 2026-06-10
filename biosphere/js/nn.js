/* ====================================================================
 * nn.js  —  tiny feed-forward neural network (the creature "brain")
 *
 * Fixed topology: INPUTS -> HIDDEN (tanh) -> OUTPUTS (tanh).
 * Weights are flat Float32Arrays so mutation/crossover are cheap.
 * ==================================================================== */

class NeuralNet {
  constructor(nIn, nHid, nOut, weights) {
    this.nIn = nIn;
    this.nHid = nHid;
    this.nOut = nOut;
    // w1: nHid x (nIn+1)  (last col = bias) ; w2: nOut x (nHid+1)
    this.n1 = nHid * (nIn + 1);
    this.n2 = nOut * (nHid + 1);
    if (weights) {
      this.w = weights;
    } else {
      this.w = new Float32Array(this.n1 + this.n2);
      for (let i = 0; i < this.w.length; i++) this.w[i] = Utils.randn(0, 1);
    }
    this._hid = new Float32Array(nHid);
    this._out = new Float32Array(nOut);
  }

  forward(inputs) {
    const { nIn, nHid, nOut, w, _hid, _out } = this;
    let k = 0;
    for (let h = 0; h < nHid; h++) {
      let sum = 0;
      for (let i = 0; i < nIn; i++) sum += w[k++] * inputs[i];
      sum += w[k++]; // bias
      _hid[h] = Math.tanh(sum);
    }
    for (let o = 0; o < nOut; o++) {
      let sum = 0;
      for (let h = 0; h < nHid; h++) sum += w[k++] * _hid[h];
      sum += w[k++]; // bias
      _out[o] = Math.tanh(sum);
    }
    return _out;
  }

  clone() {
    return new NeuralNet(this.nIn, this.nHid, this.nOut, this.w.slice());
  }

  // In-place gaussian mutation; rate = prob per weight, amount = sd of jitter.
  mutate(rate, amount) {
    const w = this.w;
    for (let i = 0; i < w.length; i++) {
      if (Utils.rand() < rate) {
        w[i] += Utils.randn(0, amount);
        if (w[i] > 6) w[i] = 6;
        else if (w[i] < -6) w[i] = -6;
      }
    }
  }

  // Uniform crossover of two parents into a fresh child net.
  static crossover(a, b) {
    const w = new Float32Array(a.w.length);
    for (let i = 0; i < w.length; i++) w[i] = Utils.rand() < 0.5 ? a.w[i] : b.w[i];
    return new NeuralNet(a.nIn, a.nHid, a.nOut, w);
  }

  toJSON() {
    return { nIn: this.nIn, nHid: this.nHid, nOut: this.nOut, w: Array.from(this.w) };
  }
  static fromJSON(o) {
    return new NeuralNet(o.nIn, o.nHid, o.nOut, Float32Array.from(o.w));
  }
}
