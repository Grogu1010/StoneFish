// Development benchmark for Stonefish v5.5 testunit1.
// This is intentionally NOT a release gate and is not part of the normal Stonefish UI path.
// It verifies the defining invariant: v5.5 testunit1 = Stonefish v5 + ARMX-preview only.

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
  'Stonefish_v5.js'
];

// Keep both sides on the same optional runtime layer if it is present.
if (fs.existsSync('Stonefish_runtime_speed_patch.js')) engineFiles.push('Stonefish_runtime_speed_patch.js');
if (fs.existsSync('Stonefish_fast_moves_experiment.js')) engineFiles.push('Stonefish_fast_moves_experiment.js');

engineFiles.push('ARMX_preview_fast.js', 'Stonefish_v5_5_testunit1.js');

const source = engineFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n\n');
vm.runInThisContext(source, { filename: 'stonefish-v5-5-testunit1-bundle.js' });

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

function playPublicMove(game, move) {
  if (!move) return null;
  return game.move({ from: move.from, to: move.to, promotion: move.promotion || 'q' });
}

function moveKey(move) {
  return move ? `${move.from}${move.to}${move.promotion || ''}` : 'null';
}

function assertPreviewContract() {
  if (typeof ARMX_PREVIEW === 'undefined') throw new Error('ARMX-preview was not loaded');
  if (ARMX_PREVIEW.basePly !== 3) throw new Error(`ARMX-preview base ply must be 3, got ${ARMX_PREVIEW.basePly}`);
  if (ARMX_PREVIEW.maxPly !== 4) throw new Error(`ARMX-preview max ply must be 4, got ${ARMX_PREVIEW.maxPly}`);
  if (ARMX_PREVIEW.maxNodes > 72) throw new Error(`ARMX-preview node budget unexpectedly high: ${ARMX_PREVIEW.maxNodes}`);
}

function assertV5FallbackParity() {
  const game = new Chess();
  const saved = globalThis.armxPreviewReview;
  try {
    globalThis.armxPreviewReview = undefined;
    const v5 = getStonefishV5Move(game);
    const v55 = getStonefishV55Testunit1Move(game);
    if (moveKey(v5) !== moveKey(v55)) {
      throw new Error(`Without ARMX, v5.5 must equal v5: ${moveKey(v5)} vs ${moveKey(v55)}`);
    }
  } finally {
    globalThis.armxPreviewReview = saved;
  }
}

function buildSamplePositions(count = 10) {
  const positions = [];
  const game = new Chess();
  const originalRandom = Math.random;
  Math.random = seededRandom(0x55A11CE);
  try {
    for (let ply = 0; ply < count * 4 && !game.game_over(); ply += 1) {
      if (ply % 4 === 0) positions.push(game.fen());
      const move = getStonefishV5Move(game);
      if (!playPublicMove(game, move)) break;
    }
  } finally {
    Math.random = originalRandom;
  }
  return positions;
}

function latencyAndBehavior(samples) {
  let v5Ms = 0;
  let v55Ms = 0;
  let changed = 0;
  let armxNodes = 0;
  let armxReviews = 0;

  for (const fen of samples) {
    const gameV5 = new Chess(fen);
    const gameV55 = new Chess(fen);

    let start = performance.now();
    const v5Move = getStonefishV5Move(gameV5);
    v5Ms += performance.now() - start;

    start = performance.now();
    const v55Move = getStonefishV55Testunit1Move(gameV55);
    v55Ms += performance.now() - start;

    if (moveKey(v5Move) !== moveKey(v55Move)) changed += 1;

    const review = stonefishV55Testunit1LastARMX();
    if (!review || !review.connected) throw new Error('v5.5 testunit1 did not connect to ARMX-preview');
    if (review.nodes > ARMX_PREVIEW.maxNodes) {
      throw new Error(`ARMX exceeded node budget: ${review.nodes} > ${ARMX_PREVIEW.maxNodes}`);
    }
    armxNodes += review.nodes;
    armxReviews += 1;
  }

  return {
    samples: samples.length,
    changedMoves: changed,
    v5AverageMs: samples.length ? v5Ms / samples.length : 0,
    v55AverageMs: samples.length ? v55Ms / samples.length : 0,
    slowdownRatio: v5Ms > 0 ? v55Ms / v5Ms : 0,
    armxAverageNodes: armxReviews ? armxNodes / armxReviews : 0,
  };
}

function simulateGame(v55IsWhite, seed, maxPlies = 240) {
  const game = new Chess();
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  let plies = 0;

  try {
    while (!game.game_over() && plies < maxPlies) {
      const v55Turn = (game.side === 1) === v55IsWhite;
      const move = v55Turn ? getStonefishV55Testunit1Move(game) : getStonefishV5Move(game);
      if (!playPublicMove(game, move)) return { result: v55Turn ? 'loss' : 'win', reason: 'invalid-move', plies };
      plies += 1;
    }

    if (game.in_checkmate()) {
      const winnerIsWhite = game.side === -1;
      return { result: winnerIsWhite === v55IsWhite ? 'win' : 'loss', reason: 'checkmate', plies };
    }
    return { result: 'draw', reason: game.game_over() ? 'draw-rule' : 'max-plies', plies };
  } finally {
    Math.random = originalRandom;
  }
}

function smokeHeadToHead(games = 4) {
  const totals = { win: 0, loss: 0, draw: 0 };
  for (let i = 0; i < games; i += 1) {
    const result = simulateGame(i % 2 === 0, 0xA2F000 + i * 977);
    totals[result.result] += 1;
    console.log(`game ${i + 1}: v5.5=${i % 2 === 0 ? 'W' : 'B'} ${result.result} ${result.reason} ${result.plies} plies`);
  }
  return totals;
}

assertPreviewContract();
assertV5FallbackParity();

const sampleCount = Math.max(4, Number.parseInt(process.env.SAMPLES || '10', 10) || 10);
const samples = buildSamplePositions(sampleCount);
const latency = latencyAndBehavior(samples);
const games = Math.max(0, Number.parseInt(process.env.GAMES || '4', 10) || 0);
const headToHead = games ? smokeHeadToHead(games) : null;

const summary = {
  testUnit: STONEFISH_V5_5_TESTUNIT1.name,
  base: STONEFISH_V5_5_TESTUNIT1.base,
  armx: ARMX_PREVIEW,
  latency,
  headToHead,
};

console.log('\nSTONEFISH_V5_5_TESTUNIT1 ' + JSON.stringify(summary));
