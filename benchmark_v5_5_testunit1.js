// Development benchmark for Stonefish v5.5 testunit1.
// Reports three controlled comparisons on the exact same varied opening/seed set:
//   1) v5.5 + ARMX vs v5 Pro
//   2) v5.5 No ARMX vs v5 Pro
//   3) v5.5 + ARMX vs v5.5 No ARMX
// Required hierarchy: v5 Pro < v5.5 No ARMX < v5.5 + ARMX.
// Release targets per 100 games: 65 No-ARMX wins vs Pro, 85 ARMX wins vs
// Pro, and 65 ARMX wins vs No-ARMX. Both v5.5 variants must also average at
// least 3x less engine think-time per move than v5 Pro in their direct games.

const fs = require('fs');
const vm = require('vm');
const { performance } = require('perf_hooks');
const crypto = require('crypto');

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
engineFiles.push(
  'Stonefish_v5_5_search.js',
  'Stonefish_v5_5_refutation_guard.js',
  'Stonefish_v5_5_native.js',
  process.env.ARMX_SOURCE || 'ARMX-preview.js',
  'Stonefish_v5_5_testunit1.js'
);
// Experiment files are explicit and included in the saved source fingerprints.
if (process.env.ENGINE_PATCH) engineFiles.push(...process.env.ENGINE_PATCH.split(',').filter(Boolean));

const loadedSources = engineFiles.map(file => ({ file, source: fs.readFileSync(file, 'utf8') }));
vm.runInThisContext(loadedSources.map(entry => entry.source).join('\n\n'), {
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
  for (const state of source.historyStack) game._applyRaw({ ...state.move }, state.trackRepetition);
  game.armxObservationStartPly = source.armxObservationStartPly || 0;
  if (game.fastPositionKey() !== source.fastPositionKey()) throw new Error('Position replay failed');
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
  if (STONEFISH_V5_5_TESTUNIT1.knowledgeBase !== 'Native tapered positional evaluation') {
    throw new Error(`Wrong v5.5 knowledge base: ${STONEFISH_V5_5_TESTUNIT1.knowledgeBase}`);
  }
  if (STONEFISH_V5_5_TESTUNIT1.search !== 'Native PVS') {
    throw new Error(`Wrong v5.5 search core: ${STONEFISH_V5_5_TESTUNIT1.search}`);
  }
  if (ARMX_PREVIEW.kind !== 'opponent-adaptation' || ARMX_PREVIEW.reset !== 'per-game') {
    throw new Error('ARMX-preview must be the separate per-game opponent adaptation model');
  }
  if (typeof sf55cHost !== 'function' || SF55C.multiPV < 2) throw new Error('Native host must expose searched alternatives');
}

function assertNoARMXControlWorks() {
  clearSharedEngineCaches();
  const game = new Chess();
  const move = withSeed(0x5150, () => getStonefishV55Testunit1NoARMXMove(game));
  if (!move || !play(game, move)) throw new Error('v5.5 No-ARMX control must return a legal move');
}

function assertARMXResetsByGame() {
  const gameA = new Chess();
  const gameB = new Chess();
  const first = stonefishV55Testunit1HostSearch(gameA).finished.slice(0, 2);
  const second = stonefishV55Testunit1HostSearch(gameB).finished.slice(0, 2);
  const reviewA = armxPreviewReview(gameA, first, gameA.side);
  const reviewB = armxPreviewReview(gameB, second, gameB.side);
  if (reviewA.observedPlies !== 0 || reviewB.observedPlies !== 0) {
    throw new Error('Fresh ARMX-preview games must start with an empty opponent profile');
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
  game.armxObservationStartPly = game.historyStack.length;
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
  let armxVsProChanges = 0, armxVsHostChanges = 0, overrides = 0;
  let adaptationApplied = 0, adaptationRejected = 0, observedPlies = 0;
  let guardEligible = 0, guardVerified = 0, guardLowered = 0;

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

    if (!review || !review.connected) throw new Error('v5.5 did not publish ARMX adaptation metadata');
    if (review.override) overrides += 1;
    if (review.adaptationApplied) adaptationApplied += 1;
    if (review.adaptationRejected) adaptationRejected += 1;
    observedPlies += review.observedPlies || 0;
    const guard = review.refutationGuard;
    if (guard && guard.eligible) guardEligible += 1;
    if (guard && guard.verified) guardVerified += 1;
    if (guard && guard.lowered) guardLowered += 1;
  }

  return {
    samples: samples.length,
    armxVsProChangedMoves: armxVsProChanges,
    armxVsHostChangedMoves: armxVsHostChanges,
    armxOverrides: overrides,
    armxAdaptationAppliedRate: samples.length ? adaptationApplied / samples.length : 0,
    armxAdaptationRejectedRate: samples.length ? adaptationRejected / samples.length : 0,
    armxAverageObservedPlies: samples.length ? observedPlies / samples.length : 0,
    refutationGuardEligibleRate: samples.length ? guardEligible / samples.length : 0,
    refutationGuardVerificationRate: samples.length ? guardVerified / samples.length : 0,
    refutationGuardLowerRate: samples.length ? guardLowered / samples.length : 0,
    proAverageMs: samples.length ? proMs / samples.length : 0,
    noArmxAverageMs: samples.length ? noArmxMs / samples.length : 0,
    armxAverageMs: samples.length ? armxMs / samples.length : 0,
    noArmxIsolatedSpeedupVsPro: noArmxMs ? proMs / noArmxMs : 0,
    armxIsolatedSpeedupVsPro: armxMs ? proMs / armxMs : 0,
    armxOverheadVsHost: noArmxMs ? armxMs / noArmxMs : 0
  };
}

function enginePerformanceSummary(games, moves, thinkMs) {
  const averageTimePerMoveMs = moves ? thinkMs / moves : 0;
  const averageMovesPerGame = games ? moves / games : 0;
  return {
    games,
    moves,
    thinkMs,
    averageTimePerMoveMs,
    averageMovesPerGame,
    averageEngineTimePerGameMs: averageTimePerMoveMs * averageMovesPerGame
  };
}

function combinePerformance(parts) {
  let games = 0, moves = 0, thinkMs = 0;
  for (const part of parts) {
    if (!part) continue;
    games += part.games || 0;
    moves += part.moves || 0;
    thinkMs += part.thinkMs || 0;
  }
  return enginePerformanceSummary(games, moves, thinkMs);
}

function simulateGame(contenderIsWhite, opening, seed, contenderFn, opponentFn, maxPlies = 360) {
  const game = positionAfter(opening);
  game.armxObservationStartPly = opening.length;
  clearSharedEngineCaches();
  let plies = opening.length;
  const playedMoves = [];
  const enginePerf = {
    contender: { moves: 0, thinkMs: 0 },
    opponent: { moves: 0, thinkMs: 0 }
  };

  return withSeed(seed, () => {
    while (!game.game_over() && plies < maxPlies) {
      const contenderTurn = (game.side === 1) === contenderIsWhite;
      const started = performance.now();
      const move = contenderTurn ? contenderFn(game) : opponentFn(game);
      const elapsed = performance.now() - started;
      if (!play(game, move)) {
        throw new Error(`Invalid move at ply ${plies}: ${JSON.stringify(move)}`);
      }
      playedMoves.push(moveKey(move));
      const bucket = contenderTurn ? enginePerf.contender : enginePerf.opponent;
      bucket.moves += 1;
      bucket.thinkMs += elapsed;
      plies += 1;
    }
    if (game.in_checkmate()) {
      const winnerIsWhite = game.side === -1;
      return {
        result: winnerIsWhite === contenderIsWhite ? 'win' : 'loss',
        reason: 'checkmate',
        plies,
        playedMoves,
        enginePerf
      };
    }
    return {
      result: 'draw',
      reason: game.game_over() ? 'draw-rule' : 'max-plies',
      plies,
      playedMoves,
      enginePerf
    };
  });
}

function variedHeadToHead(games, label, contenderFn, opponentFn) {
  const totals = {
    win: 0,
    loss: 0,
    draw: 0,
    contenderMoves: 0,
    contenderThinkMs: 0,
    opponentMoves: 0,
    opponentThinkMs: 0
  };
  const records = [];
  const startIndex = Number.parseInt(process.env.START_INDEX || '0', 10);
  for (let localIndex = 0; localIndex < games; localIndex += 1) {
    const i = startIndex + localIndex;
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
    totals.contenderMoves += result.enginePerf.contender.moves;
    totals.contenderThinkMs += result.enginePerf.contender.thinkMs;
    totals.opponentMoves += result.enginePerf.opponent.moves;
    totals.opponentThinkMs += result.enginePerf.opponent.thinkMs;
    records.push({ index: i, pair, contenderIsWhite, opening, ...result });
    console.log(`${label} game ${i + 1}: pair=${pair + 1} side=${contenderIsWhite ? 'W' : 'B'} ${result.result} ${result.reason} ${result.plies} plies`);
  }
  return {
    records,
    win: totals.win,
    loss: totals.loss,
    draw: totals.draw,
    score: games ? (totals.win + totals.draw * 0.5) / games : 0,
    performance: {
      contender: enginePerformanceSummary(games, totals.contenderMoves, totals.contenderThinkMs),
      opponent: enginePerformanceSummary(games, totals.opponentMoves, totals.opponentThinkMs)
    }
  };
}

function directGameSpeedup(matchup) {
  if (!matchup || !matchup.performance) return 0;
  const contender = matchup.performance.contender.averageTimePerMoveMs;
  const opponent = matchup.performance.opponent.averageTimePerMoveMs;
  return contender > 0 ? opponent / contender : 0;
}

assertContract();
assertNoARMXControlWorks();
assertARMXResetsByGame();
const sampleCount = Math.max(4, Number.parseInt(process.env.SAMPLES || '12', 10) || 12);
const latency = latencyAndBehavior(buildSamplePositions(sampleCount));
const games = Math.max(0, Number.parseInt(process.env.GAMES || '12', 10) || 0);
if (process.env.RELEASE_GATE === '1' && (games < 100 || games % 2 !== 0 || process.env.MATCHUP)) {
  throw new Error('Release proof requires all three matchups and at least 100 color-balanced games each');
}

const definitions = {
  armxVsPro: ['ARMX-vs-Pro', getStonefishV55Testunit1Move, getStonefishV5ProMove],
  noArmxVsPro: ['NoARMX-vs-Pro', getStonefishV55Testunit1NoARMXMove, getStonefishV5ProMove],
  armxVsNoArmx: ['ARMX-vs-NoARMX', getStonefishV55Testunit1Move, getStonefishV55Testunit1NoARMXMove]
};
if (process.env.MATCHUP && !definitions[process.env.MATCHUP]) throw new Error('Unknown MATCHUP');
const matchups = games ? Object.fromEntries(Object.entries(definitions)
  .filter(([name]) => !process.env.MATCHUP || name === process.env.MATCHUP)
  .map(([name, args]) => [name, variedHeadToHead(games, ...args)])) : null;
const fullMatchups = matchups && Object.keys(matchups).length === 3;

const hierarchy = fullMatchups ? {
  hostBeatsPro: matchups.noArmxVsPro.score > 0.5,
  armxBeatsHost: matchups.armxVsNoArmx.score > 0.5,
  armxOutscoresHostVsPro: matchups.armxVsPro.score > matchups.noArmxVsPro.score,
} : null;

const gamePerformanceByModel = fullMatchups ? {
  v5Pro: combinePerformance([
    matchups.armxVsPro.performance.opponent,
    matchups.noArmxVsPro.performance.opponent
  ]),
  v55NoARMX: combinePerformance([
    matchups.noArmxVsPro.performance.contender,
    matchups.armxVsNoArmx.performance.opponent
  ]),
  v55ARMX: combinePerformance([
    matchups.armxVsPro.performance.contender,
    matchups.armxVsNoArmx.performance.contender
  ])
} : null;

const realGameSpeedups = matchups ? {
  noArmxVsPro: directGameSpeedup(matchups.noArmxVsPro),
  armxVsPro: directGameSpeedup(matchups.armxVsPro)
} : null;

const targets = {
  hierarchy: 'v5 Pro < v5.5 No ARMX < v5.5 + ARMX',
  noArmxWinsPer100VsPro: 65,
  armxWinsPer100VsPro: 85,
  armxWinsPer100VsNoArmx: 65,
  realGameSpeedupVsPro: 3
};

const result = {
  gamesPerMatchup: games,
  startIndex: Number.parseInt(process.env.START_INDEX || '0', 10),
  sourceHashes: Object.fromEntries(loadedSources.map(({ file, source }) => [file, crypto.createHash('sha256').update(source).digest('hex')])),
  testUnit: STONEFISH_V5_5_TESTUNIT1.name,
  knowledgeBase: STONEFISH_V5_5_TESTUNIT1.knowledgeBase,
  search: SF55C,
  refutationGuard: 'Full legal reply search',
  host: STONEFISH_V5_5_TESTUNIT1,
  armx: ARMX_PREVIEW,
  latency,
  gamePerformanceByModel,
  realGameSpeedups,
  matchups,
  hierarchy,
  targets
};
if (process.env.RESULT_JSON) fs.writeFileSync(process.env.RESULT_JSON, JSON.stringify(result, null, 2) + '\n');
console.log('\nSTONEFISH_V5_5_TESTUNIT1 ' + JSON.stringify(result));

if (process.env.RELEASE_GATE === '1' && games >= 100) {
  const noArmxWinTarget = Math.ceil(games * targets.noArmxWinsPer100VsPro / 100);
  const armxProWinTarget = Math.ceil(games * targets.armxWinsPer100VsPro / 100);
  const armxHostWinTarget = Math.ceil(games * targets.armxWinsPer100VsNoArmx / 100);

  if (matchups.noArmxVsPro.win < noArmxWinTarget) {
    throw new Error(`v5.5 No-ARMX strength gate failed: ${matchups.noArmxVsPro.win} wins; need >=${noArmxWinTarget}/${games}`);
  }
  if (matchups.armxVsPro.win < armxProWinTarget) {
    throw new Error(`v5.5 + ARMX vs Pro gate failed: ${matchups.armxVsPro.win} wins; need >=${armxProWinTarget}/${games}`);
  }
  if (matchups.armxVsNoArmx.win < armxHostWinTarget) {
    throw new Error(`ARMX contribution gate failed: ${matchups.armxVsNoArmx.win} wins; need >=${armxHostWinTarget}/${games}`);
  }
  if (realGameSpeedups.noArmxVsPro < targets.realGameSpeedupVsPro) {
    throw new Error(`v5.5 No-ARMX real-game speed gate failed: ${realGameSpeedups.noArmxVsPro.toFixed(3)}x; need >=3x`);
  }
  if (realGameSpeedups.armxVsPro < targets.realGameSpeedupVsPro) {
    throw new Error(`v5.5 + ARMX real-game speed gate failed: ${realGameSpeedups.armxVsPro.toFixed(3)}x; need >=3x`);
  }
}
