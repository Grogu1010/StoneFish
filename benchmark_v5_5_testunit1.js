// Development benchmark for Stonefish v5.5 testunit1.
// Invariant: v5.5 = Stonefish v5 Pro + ARMX-preview. This benchmark uses varied
// deterministic openings so repeated games do not collapse into one identical line.

const fs = require('fs');
const vm = require('vm');
const { performance } = require('perf_hooks');

const engineFiles = [
  'StonefishChess.js',
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
if (fs.existsSync('Stonefish_v5_pro_geometry_patch.js')) engineFiles.push('Stonefish_v5_pro_geometry_patch.js');
if (fs.existsSync('Stonefish_runtime_speed_patch.js')) engineFiles.push('Stonefish_runtime_speed_patch.js');
if (fs.existsSync('Stonefish_fast_moves_experiment.js')) engineFiles.push('Stonefish_fast_moves_experiment.js');
engineFiles.push('ARMX_preview_fast.js', 'Stonefish_v5_5_testunit1.js');

vm.runInThisContext(engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n'), {
  filename: 'stonefish-v5-5-testunit1-bundle.js'
});

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

function withSeed(seed, fn) {
  const old = Math.random;
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = old; }
}

function cloneGame(source) {
  const game = new Chess();
  game.boardState = new Int8Array(source.boardState);
  game.side = source.side;
  game.castling = source.castling;
  game.ep = source.ep;
  game.halfmove = source.halfmove;
  game.fullmove = source.fullmove;
  game.kingSq = { 1: source.kingSq[1], '-1': source.kingSq[-1] };
  game.historyStack = [];
  game.positionCounts = new Map(source.positionCounts);
  return game;
}

function clearSharedEngineCaches() {
  // Pro's speed layer uses global position-keyed caches. Without clearing these,
  // measuring Pro first warms data that v5.5 can reuse and makes the second model
  // look artificially fast. Per-game runtime memos live on each cloned Chess object
  // and therefore do not need clearing here.
  if (typeof STONEFISH_V5_PRO_POSITION_CACHE !== 'undefined') STONEFISH_V5_PRO_POSITION_CACHE.clear();
  if (typeof STONEFISH_V5_PRO_CONTEXT_CACHE !== 'undefined') STONEFISH_V5_PRO_CONTEXT_CACHE.clear();
  if (typeof STONEFISH_V5_PRO_ADAPTIVE_CACHE !== 'undefined') STONEFISH_V5_PRO_ADAPTIVE_CACHE.clear();
}

function play(game, move) {
  return move ? game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' }) : null;
}

function moveKey(move) {
  return move ? `${move.from}${move.to}${move.promotion || ''}` : 'null';
}

function cleanMove(game, raw) {
  const move = stonefishV3PublicMove(game, raw);
  return move ? { from: move.from, to: move.to, promotion: move.promotion || undefined } : null;
}

function assertContract() {
  if (STONEFISH_V5_5_TESTUNIT1.base !== 'Stonefish v5 Pro') throw new Error(`Wrong v5.5 base: ${STONEFISH_V5_5_TESTUNIT1.base}`);
  if (ARMX_PREVIEW.basePly !== 3 || ARMX_PREVIEW.maxPly !== 4) throw new Error('ARMX-preview must remain 3-ply base / 4-ply max');
  if (ARMX_PREVIEW.maxNodes > 400) throw new Error(`ARMX-preview node budget too high: ${ARMX_PREVIEW.maxNodes}`);
}

function assertProFallbackParity() {
  const saved = globalThis.armxPreviewReview;
  try {
    globalThis.armxPreviewReview = undefined;
    clearSharedEngineCaches();
    const pro = withSeed(0x5150, () => getStonefishV5ProMove(new Chess()));
    clearSharedEngineCaches();
    const v55 = withSeed(0x5150, () => getStonefishV55Testunit1Move(new Chess()));
    if (moveKey(pro) !== moveKey(v55)) throw new Error(`Without ARMX, v5.5 must equal v5 Pro: ${moveKey(pro)} vs ${moveKey(v55)}`);
  } finally {
    globalThis.armxPreviewReview = saved;
  }
}

function generateOpening(pairIndex, plies = 10) {
  const game = new Chess();
  const pick = seededRandom((0xA551000 + pairIndex * 977) >>> 0);
  return withSeed((0xB771000 + pairIndex * 131) >>> 0, () => {
    const moves = [];
    for (let ply = 0; ply < plies && !game.game_over(); ply += 1) {
      const scored = stonefishV5ScoreAllMoves(game);
      if (!scored.length) break;
      const width = Math.min(4, scored.length);
      const r = pick();
      const rank = Math.min(width - 1, r < 0.48 ? 0 : r < 0.76 ? 1 : r < 0.93 ? 2 : 3);
      const move = cleanMove(game, scored[rank].raw);
      if (!move || !play(game, move)) break;
      moves.push(move);
    }
    return moves;
  });
}

function positionAfter(opening) {
  const game = new Chess();
  for (const move of opening) if (!play(game, move)) throw new Error('Invalid generated opening');
  return game;
}

function buildSamplePositions(count) {
  const positions = [];
  for (let i = 0; i < count; i += 1) positions.push(positionAfter(generateOpening(i, 6 + (i % 5))));
  return positions;
}

function timedMove(seed, fn) {
  clearSharedEngineCaches();
  const start = performance.now();
  let move;
  withSeed(seed, () => { move = fn(); });
  return { move, ms: performance.now() - start };
}

function latencyAndBehavior(samples) {
  let proMs = 0, v55Ms = 0, changed = 0, overrides = 0, nodes = 0;

  // Warm both code paths before timing. Caches are cleared around each warmup so
  // only JIT/code warmup is shared, not position evaluation data.
  if (samples.length) {
    clearSharedEngineCaches();
    withSeed(0x7701, () => getStonefishV5ProMove(cloneGame(samples[0])));
    clearSharedEngineCaches();
    withSeed(0x7702, () => getStonefishV55Testunit1Move(cloneGame(samples[0])));
    clearSharedEngineCaches();
  }

  for (let i = 0; i < samples.length; i += 1) {
    const a = cloneGame(samples[i]);
    const b = cloneGame(samples[i]);
    const seed = 0x9000 + i;
    let proResult, v55Result;

    // Alternate measurement order to balance any residual runtime/CPU effects.
    if (i % 2 === 0) {
      proResult = timedMove(seed, () => getStonefishV5ProMove(a));
      v55Result = timedMove(seed, () => getStonefishV55Testunit1Move(b));
    } else {
      v55Result = timedMove(seed, () => getStonefishV55Testunit1Move(b));
      proResult = timedMove(seed, () => getStonefishV5ProMove(a));
    }

    proMs += proResult.ms;
    v55Ms += v55Result.ms;
    if (moveKey(proResult.move) !== moveKey(v55Result.move)) changed += 1;

    const review = stonefishV55Testunit1LastARMX();
    if (!review || !review.connected) throw new Error('ARMX-preview was not connected');
    if (review.nodes > ARMX_PREVIEW.maxNodes) throw new Error(`ARMX node budget exceeded: ${review.nodes}`);
    if (review.override) overrides += 1;
    nodes += review.nodes;
  }
  return {
    samples: samples.length,
    changedMoves: changed,
    overrides,
    proAverageMs: samples.length ? proMs / samples.length : 0,
    v55AverageMs: samples.length ? v55Ms / samples.length : 0,
    slowdownRatio: proMs ? v55Ms / proMs : 0,
    armxAverageNodes: samples.length ? nodes / samples.length : 0
  };
}

function simulateGame(v55IsWhite, opening, seed, maxPlies = 360) {
  const game = positionAfter(opening);
  let plies = opening.length;
  return withSeed(seed, () => {
    while (!game.game_over() && plies < maxPlies) {
      const v55Turn = (game.side === 1) === v55IsWhite;
      const move = v55Turn ? getStonefishV55Testunit1Move(game) : getStonefishV5ProMove(game);
      if (!play(game, move)) return { result: v55Turn ? 'loss' : 'win', reason: 'invalid-move', plies };
      plies += 1;
    }
    if (game.in_checkmate()) {
      const winnerIsWhite = game.side === -1;
      return { result: winnerIsWhite === v55IsWhite ? 'win' : 'loss', reason: 'checkmate', plies };
    }
    return { result: 'draw', reason: game.game_over() ? 'draw-rule' : 'max-plies', plies };
  });
}

function variedHeadToHead(games) {
  const totals = { win: 0, loss: 0, draw: 0 };
  for (let i = 0; i < games; i += 1) {
    const pair = Math.floor(i / 2);
    const opening = generateOpening(pair, 10);
    const v55IsWhite = i % 2 === 0;
    const result = simulateGame(v55IsWhite, opening, (0xC550000 + pair * 977 + i) >>> 0);
    totals[result.result] += 1;
    console.log(`game ${i + 1}: pair=${pair + 1} v5.5=${v55IsWhite ? 'W' : 'B'} ${result.result} ${result.reason} ${result.plies} plies`);
  }
  return Object.assign(totals, { score: games ? (totals.win + totals.draw * 0.5) / games : 0 });
}

assertContract();
assertProFallbackParity();
const sampleCount = Math.max(4, Number.parseInt(process.env.SAMPLES || '12', 10) || 12);
const latency = latencyAndBehavior(buildSamplePositions(sampleCount));
const games = Math.max(0, Number.parseInt(process.env.GAMES || '12', 10) || 0);
const headToHead = games ? variedHeadToHead(games) : null;

console.log('\nSTONEFISH_V5_5_TESTUNIT1 ' + JSON.stringify({
  testUnit: STONEFISH_V5_5_TESTUNIT1.name,
  base: STONEFISH_V5_5_TESTUNIT1.base,
  armx: ARMX_PREVIEW,
  latency,
  headToHead
}));
