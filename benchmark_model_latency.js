const fs = require('fs');
const vm = require('vm');

const files = [
  'StonefishChess.js',
  'Stonefish_v1.js',
  'Stonefish_v2.js',
  'Stonefish_v3.js',
  'Stonefish_v4.js',
  'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js',
  'Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js',
  'Stonefish_v5.js',
  'Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js',
  'Stonefish_v5_pro_geometry_patch.js',
  'Stonefish_runtime_speed_patch.js'
];

const ctx = vm.createContext({ console });
const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n\n');
vm.runInContext(source + `
  this.__Chess = Chess;
  this.__models = {
    v1: getStonefishMove,
    v2: getStonefishV2Move,
    v3: getStonefishV3Move,
    v4: getStonefishV4Move,
    v45: getStonefishV45Move,
    v5: getStonefishV5Move,
    v5pro: getStonefishV5ProMove
  };
  this.__setSeed = function(seed) {
    let x = seed >>> 0;
    Math.random = function() {
      x += 0x6D2B79F5;
      let t = x;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
`, ctx);

function seededRandom(seed) {
  let x = seed >>> 0;
  return function() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateHistories() {
  const histories = [];
  const samplePlies = new Set([4, 8, 12, 16, 20, 24]);
  for (let line = 0; line < 4; line += 1) {
    const game = new ctx.__Chess();
    const history = [];
    const random = seededRandom(0x51A7E + line * 0x9E3779B1);
    for (let ply = 1; ply <= 24; ply += 1) {
      const legal = game.fastMoves();
      if (!legal.length) break;
      const raw = legal[Math.floor(random() * legal.length)];
      history.push({ from: raw.from, to: raw.to, promotion: raw.promotion || 0 });
      game._applyRaw(raw, true);
      if (samplePlies.has(ply)) histories.push(history.slice());
      if (game.in_checkmate() || game.in_draw()) break;
    }
  }
  return histories;
}

function replay(history) {
  const game = new ctx.__Chess();
  for (const recorded of history) {
    const legal = game.fastMoves();
    const raw = legal.find(m => m.from === recorded.from && m.to === recorded.to && (m.promotion || 0) === recorded.promotion);
    if (!raw) throw new Error('Unable to replay history');
    game._applyRaw(raw, true);
  }
  return game;
}

function percentile(values, q) {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

const histories = generateHistories();
const models = ['v1', 'v2', 'v3', 'v4', 'v45', 'v5', 'v5pro'];
const result = { positions: histories.length, models: {} };

// One unmeasured warmup on the first sampled position for each model.
for (let i = 0; i < models.length; i += 1) {
  const model = models[i];
  ctx.__setSeed(0xABC000 + i);
  ctx.__models[model](replay(histories[0]));
}

for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
  const model = models[modelIndex];
  const samples = [];
  for (let i = 0; i < histories.length; i += 1) {
    const game = replay(histories[i]);
    ctx.__setSeed((0xC0FFEE + modelIndex * 1009 + i * 9176) >>> 0);
    const start = process.hrtime.bigint();
    const move = ctx.__models[model](game);
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (!move) throw new Error(`Model ${model} returned no move at sample ${i}`);
    samples.push(elapsed);
  }
  const total = samples.reduce((a, b) => a + b, 0);
  result.models[model] = {
    samples: samples.length,
    avgMs: total / samples.length,
    medianMs: percentile(samples, 0.5),
    p90Ms: percentile(samples, 0.9),
    maxMs: Math.max(...samples)
  };
}

const baseline = Math.max(result.models.v1.avgMs, result.models.v2.avgMs);
for (const model of models) result.models[model].vsFastBaseline = result.models[model].avgMs / baseline;

console.log('STONEFISH_MODEL_LATENCY ' + JSON.stringify(result));
