// Direct parity gate for the shared runtime optimization layer.
// Compare v3, v4, v4.5, v5 and v5 Pro against released main on identical
// deterministic positions with identical RNG seeds. Any move difference fails.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const baseFiles = [
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
  'Stonefish_v5_pro_speed_patch.js'
];

function makeEngine(dir) {
  const files = baseFiles.slice();
  for (const optional of ['Stonefish_v5_pro_geometry_patch.js', 'Stonefish_runtime_speed_patch.js']) {
    if (fs.existsSync(path.join(dir, optional))) files.push(optional);
  }

  const ctx = vm.createContext({ console });
  const source = files.map(file => fs.readFileSync(path.join(dir, file), 'utf8')).join('\n\n');
  vm.runInContext(source + `\n
    this.__Chess = Chess;
    this.__getters = {
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
  `, ctx, { filename: path.join(dir, 'stonefish-runtime-parity-bundle.js') });
  return ctx;
}

function seededRandom(seed) {
  let x = seed >>> 0;
  return function random() {
    x += 0x6D2B79F5;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateHistories(engine) {
  const histories = [];
  const samplePlies = new Set([6, 10, 14, 18, 22]);

  for (let line = 0; line < 3; line += 1) {
    const game = new engine.__Chess();
    const history = [];
    const random = seededRandom(0xA11CE + line * 0x9E3779B1);

    for (let ply = 1; ply <= 22; ply += 1) {
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

function replay(engine, history) {
  const game = new engine.__Chess();
  for (const recorded of history) {
    const legal = game.fastMoves();
    const raw = legal.find(move => (
      move.from === recorded.from &&
      move.to === recorded.to &&
      (move.promotion || 0) === recorded.promotion
    ));
    if (!raw) throw new Error(`Unable to replay ${recorded.from}-${recorded.to}`);
    game._applyRaw(raw, true);
  }
  return game;
}

function moveKey(move) {
  return move ? `${move.from}${move.to}${move.promotion || ''}` : 'null';
}

const currentDir = process.cwd();
const referenceDir = process.env.REFERENCE_DIR;
if (!referenceDir) throw new Error('REFERENCE_DIR is required');

const reference = makeEngine(referenceDir);
const current = makeEngine(currentDir);
const histories = generateHistories(reference);
const models = ['v3', 'v4', 'v45', 'v5', 'v5pro'];
const timings = Object.fromEntries(models.map(model => [model, { released: 0, optimized: 0, samples: 0 }]));

for (let positionIndex = 0; positionIndex < histories.length; positionIndex += 1) {
  const history = histories[positionIndex];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    const seed = (0xC0FFEE + positionIndex * 977 + modelIndex * 131) >>> 0;
    const releasedGame = replay(reference, history);
    const optimizedGame = replay(current, history);

    reference.__setSeed(seed);
    let start = process.hrtime.bigint();
    const releasedMove = reference.__getters[model](releasedGame);
    const releasedElapsed = process.hrtime.bigint() - start;

    current.__setSeed(seed);
    start = process.hrtime.bigint();
    const optimizedMove = current.__getters[model](optimizedGame);
    const optimizedElapsed = process.hrtime.bigint() - start;

    const releasedKey = moveKey(releasedMove);
    const optimizedKey = moveKey(optimizedMove);
    if (releasedKey !== optimizedKey) {
      throw new Error(
        `Runtime parity failure model=${model} position=${positionIndex + 1}: ` +
        `released=${releasedKey} optimized=${optimizedKey}`
      );
    }

    const t = timings[model];
    t.released += Number(releasedElapsed) / 1e6;
    t.optimized += Number(optimizedElapsed) / 1e6;
    t.samples += 1;
    console.log(
      `PARITY model=${model} position=${positionIndex + 1}/${histories.length} move=${releasedKey} ` +
      `released=${(Number(releasedElapsed) / 1e6).toFixed(3)}ms ` +
      `optimized=${(Number(optimizedElapsed) / 1e6).toFixed(3)}ms`
    );
  }
}

const summary = { positions: histories.length, exactMoveMatch: true, models: {} };
for (const model of models) {
  const t = timings[model];
  const releasedAvgMs = t.samples ? t.released / t.samples : 0;
  const optimizedAvgMs = t.samples ? t.optimized / t.samples : 0;
  summary.models[model] = {
    samples: t.samples,
    releasedAvgMs,
    optimizedAvgMs,
    ratio: releasedAvgMs > 0 ? optimizedAvgMs / releasedAvgMs : null
  };
}
console.log('STONEFISH_RUNTIME_PARITY ' + JSON.stringify(summary));
