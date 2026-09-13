// Development benchmark for Stonefish v5.5 testunit1.
// Reports three controlled comparisons on the exact same varied opening/seed set:
//   1) v5.5 + ARMX vs v5 Pro
//   2) v5.5 No ARMX vs v5 Pro
//   3) v5.5 + ARMX vs v5.5 No ARMX
// Required hierarchy: v5 Pro < v5.5 No ARMX < v5.5 + ARMX.

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
engineFiles.push('Stonefish_v5_5_search.js', 'ARMX_preview_fast.js', 'Stonefish_v5_5_testunit1.js');

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
  if (STONEFISH_V5_5_TESTUNIT1.knowledgeBase !== 'Stonefish v5 Pro') {
    throw new Error(`Wrong v5.5 knowledge base: ${STONEFISH_V5_5_TESTUNIT1.knowledgeBase}`);
  }
  if (STONEFISH_V5_5_TESTUNIT1.search !== 'Guarded PVS') {
    throw new Error(`Wrong v5.5 search core: ${STONEFISH_V5_5_TESTUNIT1.search}`);
  }
  if (ARMX_PREVIEW.basePly !== 3 || ARMX_PREVIEW.maxPly !== 4) {
    throw new Error('ARMX-preview must remain 3-ply base / 4-ply max');
  }
  if (ARMX_PREVIEW.maxNodes > 160) throw new Error(`ARMX-preview node budget too high: ${ARMX_PREVIEW.maxNodes}`);
  if (STONEFISH_V5_5_SEARCH.rootCandidates > 4) throw new Error('Preview v5.5 must keep at most four full-depth root candidates');
}

function assertNoARMXControlWorks() {
  clearSharedEngineCaches();
  const game = new Chess();
  const move = withSeed(0x5150, () => getStonefishV55Testunit1NoARMXMove(game));
  if (!move || !play(game, move)) throw new Error('v5.5 No-ARMX control must return a legal move');
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
  let proMs = 0, noArmxMs = 0, armxMs = 0;
  let armxVsProChanges = 0, armxVsHostChanges = 0, overrides = 0, nodes = 0;
  let eligible = 0, reviewed = 0, challengers = 0;
  let criticApplied = 0, criticRiskSum = 0, criticRiskMax = 0, criticPenaltySum = 0;

  if (samples.length) {
    clearSharedEngineCaches();
    withSeed(0x7701, () => getStonefishV5ProMove(cloneGame(samples[0])));
    clearSharedEngineCaches();
    withSeed(0x7702, () => getStonefishV55Testunit1NoARMXMove(cloneGame(samples[0])));
    clearSharedEngineCaches();
    withSeed(0x7703, () => getStonefishV55Testunit1Move(cloneGame(samples[0])));
    clearSharedEngineCaches();
  }

  for (let i = 0; i < samples.length; i += 1) {
    const seed = 0x9000 + i;
    const proResult = timedMove(seed, () => getStonefishV5ProMove(cloneGame(samples[i])));
    const noArmxResult = timedMove(seed, () => getStonefishV55Testunit1NoARMXMove(cloneGame(samples[i])));
    const armxResult = timedMove(seed, () => getStonefishV55Testunit1Move(cloneGame(samples[i])));
    const review = stonefishV55Testunit1LastARMX();

    proMs += proResult.ms;
    noArmxMs += noArmxResult.ms;
    armxMs += armxResult.ms;
    if (moveKey(proResult.move) !== moveKey(armxResult.move)) armxVsProChanges += 1;
    if (moveKey(noArmxResult.move) !== moveKey(armxResult.move)) armxVsHostChanges += 1;

    if (!review) throw new Error('v5.5 did not publish ARMX audit metadata');
    if (review.eligible) eligible += 1;
    if (review.challengerSearched) challengers += 1;
    if (review.connected) {
      reviewed += 1;
      if (review.nodes > ARMX_PREVIEW.maxNodes) throw new Error(`ARMX node budget exceeded: ${review.nodes}`);
      nodes += review.nodes || 0;
    } else if (review.eligible && typeof armxPreviewReview === 'function') {
      throw new Error('ARMX-preview was eligible but was not connected');
    }
    if (review.override) overrides += 1;
    if (review.criticApplied) criticApplied += 1;
    if (Number.isFinite(review.criticRisk)) {
      criticRiskSum += review.criticRisk;
      criticRiskMax = Math.max(criticRiskMax, review.criticRisk);
    }
    if (Number.isFinite(review.criticAdjustment) && review.criticAdjustment < 0) {
      criticPenaltySum += -review.criticAdjustment;
    }
  }

  return {
    samples: samples.length,
    armxVsProChangedMoves: armxVsProChanges,
    armxVsHostChangedMoves: armxVsHostChanges,
    armxOverrides: overrides,
    armxEligibleRate: samples.length ? eligible / samples.length : 0,
    armxReviewRate: samples.length ? reviewed / samples.length : 0,
    armxCriticAppliedRate: samples.length ? criticApplied / samples.length : 0,
    armxAverageRisk: reviewed ? criticRiskSum / reviewed : 0,
    armxMaxRisk: criticRiskMax,
    armxAveragePenaltyPerApplied: criticApplied ? criticPenaltySum / criticApplied : 0,
    challengerSearchRate: samples.length ? challengers / samples.length : 0,
    proAverageMs: samples.length ? proMs / samples.length : 0,
    noArmxAverageMs: samples.length ? noArmxMs / samples.length : 0,
    armxAverageMs: samples.length ? armxMs / samples.length : 0,
    noArmxSpeedupVsPro: noArmxMs ? proMs / noArmxMs : 0,
    armxSpeedupVsPro: armxMs ? proMs / armxMs : 0,
    armxOverheadVsHost: noArmxMs ? armxMs / noArmxMs : 0,
    armxAverageNodes: samples.length ? nodes / samples.length : 0,
    armxAverageNodesPerReview: reviewed ? nodes / reviewed : 0
  };
}

function simulateGame(contenderIsWhite, opening, seed, contenderFn, opponentFn, maxPlies = 360) {
  const game = positionAfter(opening);
  let plies = opening.length;
  return withSeed(seed, () => {
    while (!game.game_over() && plies < maxPlies) {
      const contenderTurn = (game.side === 1) === contenderIsWhite;
      const move = contenderTurn ? contenderFn(game) : opponentFn(game);
      if (!play(game, move)) return { result: contenderTurn ? 'loss' : 'win', reason: 'invalid-move', plies };
      plies += 1;
    }
    if (game.in_checkmate()) {
      const winnerIsWhite = game.side === -1;
      return { result: winnerIsWhite === contenderIsWhite ? 'win' : 'loss', reason: 'checkmate', plies };
    }
    return { result: 'draw', reason: game.game_over() ? 'draw-rule' : 'max-plies', plies };
  });
}

function variedHeadToHead(games, label, contenderFn, opponentFn) {
  const totals = { win: 0, loss: 0, draw: 0 };
  for (let i = 0; i < games; i += 1) {
    const pair = Math.floor(i / 2);
    const opening = generateOpening(pair, 10);
    const contenderIsWhite = i % 2 === 0;
    const result = simulateGame(
      contenderIsWhite,
      opening,
      (0xC550000 + pair * 977 + i) >>> 0,
      contenderFn,
      opponentFn
    );
    totals[result.result] += 1;
    console.log(`${label} game ${i + 1}: pair=${pair + 1} side=${contenderIsWhite ? 'W' : 'B'} ${result.result} ${result.reason} ${result.plies} plies`);
  }
  return Object.assign(totals, { score: games ? (totals.win + totals.draw * 0.5) / games : 0 });
}

assertContract();
assertNoARMXControlWorks();
const sampleCount = Math.max(4, Number.parseInt(process.env.SAMPLES || '12', 10) || 12);
const latency = latencyAndBehavior(buildSamplePositions(sampleCount));
const games = Math.max(0, Number.parseInt(process.env.GAMES || '12', 10) || 0);

const matchups = games ? {
  armxVsPro: variedHeadToHead(games, 'ARMX-vs-Pro', getStonefishV55Testunit1Move, getStonefishV5ProMove),
  noArmxVsPro: variedHeadToHead(games, 'NoARMX-vs-Pro', getStonefishV55Testunit1NoARMXMove, getStonefishV5ProMove),
  armxVsNoArmx: variedHeadToHead(games, 'ARMX-vs-NoARMX', getStonefishV55Testunit1Move, getStonefishV55Testunit1NoARMXMove),
} : null;

const hierarchy = matchups ? {
  hostBeatsPro: matchups.noArmxVsPro.score > 0.5,
  armxBeatsHost: matchups.armxVsNoArmx.score > 0.5,
  armxOutscoresHostVsPro: matchups.armxVsPro.score > matchups.noArmxVsPro.score,
} : null;

const result = {
  testUnit: STONEFISH_V5_5_TESTUNIT1.name,
  knowledgeBase: STONEFISH_V5_5_TESTUNIT1.knowledgeBase,
  search: STONEFISH_V5_5_SEARCH,
  host: STONEFISH_V5_5_TESTUNIT1,
  armx: ARMX_PREVIEW,
  latency,
  matchups,
  hierarchy,
  targets: {
    hierarchy: 'v5 Pro < v5.5 No ARMX < v5.5 + ARMX',
    winsPer100VsPro: 65,
    speedupVsPro: 3
  }
};
console.log('\nSTONEFISH_V5_5_TESTUNIT1 ' + JSON.stringify(result));

if (process.env.RELEASE_GATE === '1' && games >= 100) {
  if (!hierarchy.hostBeatsPro) {
    throw new Error(`v5.5 host gate failed: score vs Pro ${matchups.noArmxVsPro.score.toFixed(3)}; need >0.500`);
  }
  if (!hierarchy.armxBeatsHost) {
    throw new Error(`ARMX gate failed: score vs No-ARMX host ${matchups.armxVsNoArmx.score.toFixed(3)}; need >0.500`);
  }
  if (!hierarchy.armxOutscoresHostVsPro) {
    throw new Error(`ARMX hierarchy gate failed: ARMX-vs-Pro ${matchups.armxVsPro.score.toFixed(3)} must exceed NoARMX-vs-Pro ${matchups.noArmxVsPro.score.toFixed(3)}`);
  }
  if (matchups.armxVsPro.win < 65) {
    throw new Error(`v5.5 strength gate failed: ${matchups.armxVsPro.win} wins; need >=65`);
  }
  if (latency.armxSpeedupVsPro < 3) {
    throw new Error(`v5.5 speed gate failed: ${latency.armxSpeedupVsPro.toFixed(3)}x; need >=3x`);
  }
}
