// Exact-behaviour speed benchmark for StoneFish v3 through v5 Pro.
// Compares the current engine bundle against the same bundle plus the exact
// speed layers. Any move-trace difference is a hard failure.

const fs = require('fs');
const vm = require('vm');

const engineFiles = [
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
  'Stonefish_v5_pro_geometry_patch.js'
];

function makeEngine(optimized) {
  const ctx = vm.createContext({ console });
  const files = optimized
    ? engineFiles.concat('Stonefish_speed_core.js', 'Stonefish_v5_pro_exact_search.js')
    : engineFiles;
  const source = files.map(file => fs.readFileSync(file, 'utf8')).join('\n\n');

  vm.runInContext(source + `\n
    this.__Chess = Chess;
    this.__models = {
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
  `, ctx, { filename: optimized ? 'stonefish-optimized-bundle.js' : 'stonefish-reference-bundle.js' });

  return ctx;
}

function commitMove(game, move) {
  if (!move) return false;
  if (move._raw) {
    game._applyRaw(move._raw, true);
    return true;
  }
  return !!game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function cheapDrawReached(game) {
  if (game.halfmove >= 100) return true;
  if (game._insufficientMaterial()) return true;
  return (game.positionCounts.get(game.fastPositionKey()) || 0) >= 3;
}

function play(engine, modelKey, modelIsWhite, seed, maxPlies) {
  engine.__setSeed(seed);
  const game = new engine.__Chess();
  const trace = [];
  let targetNanos = 0n;
  let targetMoves = 0;

  for (let ply = 0; ply < maxPlies; ply += 1) {
    const targetTurn = (game.side === 1) === modelIsWhite;
    const getter = targetTurn ? engine.__models[modelKey] : engine.__models.v2;
    const start = targetTurn ? process.hrtime.bigint() : 0n;
    const move = getter(game);
    if (targetTurn) {
      targetNanos += process.hrtime.bigint() - start;
      targetMoves += 1;
    }

    if (!move) break;
    trace.push(`${targetTurn ? modelKey : 'v2'}:${move.from}${move.to}${move.promotion || ''}`);
    if (!commitMove(game, move)) throw new Error(`Illegal move at ply ${ply + 1}: ${trace[trace.length - 1]}`);
    if (cheapDrawReached(game)) break;
  }

  return {
    trace,
    targetMoves,
    averageMs: targetMoves ? Number(targetNanos) / 1e6 / targetMoves : 0
  };
}

function assertSameTrace(label, reference, optimized) {
  if (reference.trace.length !== optimized.trace.length) {
    throw new Error(`${label}: trace length changed ${reference.trace.length} -> ${optimized.trace.length}`);
  }
  for (let i = 0; i < reference.trace.length; i += 1) {
    if (reference.trace[i] !== optimized.trace[i]) {
      throw new Error(`${label}: move mismatch at ply ${i + 1}: ${reference.trace[i]} != ${optimized.trace[i]}`);
    }
  }
}

const reference = makeEngine(false);
const optimized = makeEngine(true);
const allModels = ['v3', 'v4', 'v45', 'v5', 'v5pro'];
const requestedModel = process.env.MODEL || '';
if (requestedModel && !allModels.includes(requestedModel)) throw new Error(`Unknown MODEL=${requestedModel}`);
const models = requestedModel ? [requestedModel] : allModels;
const gamesPerModel = Math.max(1, Number.parseInt(process.env.PARITY_GAMES || '2', 10) || 2);
const maxPlies = Math.max(40, Number.parseInt(process.env.MAX_PLIES || '180', 10) || 180);
const summary = {};

for (let m = 0; m < models.length; m += 1) {
  const model = models[m];
  const modelSeedIndex = allModels.indexOf(model);
  let refMs = 0;
  let optMs = 0;

  for (let gameIndex = 0; gameIndex < gamesPerModel; gameIndex += 1) {
    const modelIsWhite = gameIndex % 2 === 0;
    const seed = 0x51F15EED + modelSeedIndex * 100003 + gameIndex * 977;
    const a = play(reference, model, modelIsWhite, seed, maxPlies);
    const b = play(optimized, model, modelIsWhite, seed, maxPlies);
    assertSameTrace(`${model} game ${gameIndex + 1}`, a, b);
    refMs += a.averageMs;
    optMs += b.averageMs;
    console.log(
      `PARITY ${model} game=${gameIndex + 1} moves=${a.targetMoves} ` +
      `reference=${a.averageMs.toFixed(3)}ms optimized=${b.averageMs.toFixed(3)}ms`
    );
  }

  const referenceAvgMs = refMs / gamesPerModel;
  const optimizedAvgMs = optMs / gamesPerModel;
  summary[model] = {
    exactTraceMatch: true,
    referenceAvgMs,
    optimizedAvgMs,
    ratio: referenceAvgMs > 0 ? optimizedAvgMs / referenceAvgMs : null
  };
}

console.log('STONEFISH_EXACT_SPEED_PARITY ' + JSON.stringify(summary));
