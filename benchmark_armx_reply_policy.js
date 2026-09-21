// Contracts for learned reply guidance and unchanged No-ARMX behavior.
const fs = require('node:fs'), vm = require('node:vm');
const assert = require('node:assert/strict'), zlib = require('node:zlib');
const files = [
  'StonefishChess.js', 'Stonefish_v3.js', 'Stonefish_v4.js', 'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js', 'Stonefish_v4_5_safety_patch.js',
  'Stonefish_v4_5_balance_patch.js', 'Stonefish_v5.js', 'Stonefish_v5_pro.js',
  'Stonefish_v5_pro_speed_patch.js', 'Stonefish_v5_pro_geometry_patch.js',
  'Stonefish_runtime_speed_patch.js', 'Stonefish_fast_moves_experiment.js',
  'Stonefish_v5_5_search.js', 'Stonefish_v5_5_refutation_guard.js',
  'Stonefish_v5_5_native.js', 'ARMX-preview.js', 'Stonefish_v5_5_testunit1.js'
];
vm.runInThisContext(files.map(file => fs.readFileSync(file, 'utf8')).join('\n'));

function play(game, ...moves) {
  for (const uci of moves) assert.ok(game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' }), uci);
  return game;
}
function snapshot(game) {
  return JSON.stringify({ fen: game.fen(), history: game.historyStack, counts: [...game.positionCounts],
    cacheDepth: game._stonefishRuntimeCacheStack ? game._stonefishRuntimeCacheStack.length : 0 });
}
function summarize(entries) {
  return { depth: SF55C_LAST.depth, nodes: SF55C_LAST.nodes, entries: entries.map(row => ({
    uci: row.uci, score: Number.isFinite(row.score) ? row.score || 0 : null,
    deep: Number.isFinite(row.deep) ? row.deep || 0 : null, exact: !!row.exact
  })) };
}

// The same legal alternatives receive different priorities after different
// observed choices. No opponent name or identifier is supplied to either game.
const knights = play(new Chess(), 'g1f3', 'b8c6', 'b1c3', 'c6b8', 'f3g1', 'b8c6', 'c3b1', 'c6b8');
const pawns = play(new Chess(), 'g1f3', 'a7a6', 'b1c3', 'a6a5', 'f3g1', 'h7h6', 'c3b1', 'h6h5');
const knightPolicy = armxPreviewOpponentPolicy(knights, 1);
const pawnPolicy = armxPreviewOpponentPolicy(pawns, 1);
assert.equal(knightPolicy.observations, 4);
assert.equal(pawnPolicy.observations, 4);
const choices = play(new Chess(), 'e2e4').fastMoves();
const knight = choices.find(move => move.from === 57 && move.to === 42);
const pawn = choices.find(move => move.from === 49 && move.to === 41);
assert.ok(knightPolicy.priority(knight) > knightPolicy.priority(pawn));
assert.ok(pawnPolicy.priority(pawn) > pawnPolicy.priority(knight));

// A policy is a frozen per-search snapshot, and a new round gets no policy.
const remembered = knightPolicy.priority(knight);
const rememberedBudget = knightPolicy.searchBudget;
armxPreviewSyncProfile(knights, 1).quietPolicy.weights.fill(-6);
assert.equal(knightPolicy.priority(knight), remembered);
assert.notEqual(armxPreviewOpponentPolicy(knights, 1).priority(knight), remembered);
// Identical board and preference weights, different prediction-quality notes.
const effortModel = armxPreviewSyncProfile(knights, 1).quietPolicy;
effortModel.qualityWeight = 1;
effortModel.qualitySum = 1;
assert.equal(armxPreviewOpponentPolicy(knights, 1).searchBudget, 1200);
effortModel.qualitySum = -1;
assert.equal(armxPreviewOpponentPolicy(knights, 1).searchBudget, 4800);
assert.equal(knightPolicy.searchBudget, rememberedBudget);
assert.equal(armxPreviewOpponentPolicy(new Chess(), 1), null);
knights.reset();
assert.equal(armxPreviewOpponentPolicy(knights, 1), null);
assert.equal(armxPreviewSyncProfile(knights, 1).quietPolicy, null);
pawns.armxObservationStartPly = pawns.historyStack.length;
assert.equal(armxPreviewOpponentPolicy(pawns, 1), null);

// Forced check evasions are not evidence of a voluntary quiet preference.
const checked = play(new Chess(), 'e2e4', 'f7f6', 'd1h5');
assert.ok(checked.in_check());
const forcedProfile = armxPreviewNewProfile(1);
armxPreviewObserveQuietChoice(forcedProfile, checked, checked.fastMoves()[0]);
assert.equal(forcedProfile.quietPolicy, null);

// Callback failures unwind the board and do not leave a policy active for the
// next call. The No-ARMX search uses the same unmodified evaluation and budget.
const clean = new Chess(), before = snapshot(clean);
const expected = summarize(stonefishV55Testunit1NoARMXScoreAllMoves(clean));
assert.throws(() => sf55cHost(clean, {
  priority() { throw new Error('injected policy failure'); }, isLowPriority() { return false; }
}), /injected policy failure/);
assert.equal(snapshot(clean), before);
assert.deepEqual(summarize(stonefishV55Testunit1NoARMXScoreAllMoves(clean)), expected);
assert.equal(SF55C.nodes, 1200);
assert.equal(SF55C.maxDepth, 4);
for (const [request, budget] of [[-1, 1200], [99999, 4800], [NaN, 1200]]) {
  const result = sf55cHost(clean, { searchBudget: request,
    priority() { return 0; }, isLowPriority() { return false; } });
  assert.equal(result.searchBudget, budget);
  assert.equal(snapshot(clean), before);
}
assert.equal(sf55cHost(clean).searchBudget, 1200);
for (const [request, depth] of [[-1, 4], [999, 6], [NaN, 4]]) {
  const result = sf55cHost(clean, { maxDepth: request,
    priority() { return 0; }, isLowPriority() { return false; } });
  assert.equal(result.depthLimit, depth);
  assert.equal(snapshot(clean), before);
}
assert.equal(sf55cHost(clean).depthLimit, 4);

// Quality uses the old weights, before this observed choice updates the model.
const learningGame = new Chess(), learningProfile = armxPreviewNewProfile(-1);
const learningMoves = learningGame.fastMoves().filter(move => !move.captured && !move.promotion);
armxPreviewObserveQuietChoice(learningProfile, learningGame, learningMoves[0]);
const learningModel = learningProfile.quietPolicy;
assert.equal(learningModel.qualityWeight, 0);
const logits = learningMoves.map(move => armxPreviewQuietLogit(
  armxPreviewQuietFeatures(move, learningGame.side), learningModel.weights));
const maximum = Math.max(...logits), probabilities = logits.map(logit => Math.exp(logit - maximum));
const gain = Math.log(learningMoves.length * probabilities[1] / probabilities.reduce((a,b) => a+b, 0));
armxPreviewObserveQuietChoice(learningProfile, learningGame, learningMoves[1]);
assert.equal(learningModel.qualitySum, gain);
assert.equal(learningModel.qualityWeight, 1);

// Golden results were generated before integration, with the old native host
// and the separately tested prototype. Scores, ordering, depths, node counts,
// learned weights, and board restoration must all agree exactly.
const golden = JSON.parse(zlib.gunzipSync(fs.readFileSync('benchmarks/v5_5/adaptive-horizon-golden.json.gz')));
for (const row of golden.positions) {
  const game = play(new Chess(), ...row.history);
  game.armxObservationStartPly = row.observationStartPly;
  const original = snapshot(game);
  assert.deepEqual(summarize(stonefishV55Testunit1NoARMXScoreAllMoves(game)), row.native);
  assert.deepEqual(summarize(stonefishV55Testunit1ScoreAllMoves(game)), row.armx);
  const model = armxPreviewSyncProfile(game, game.side).quietPolicy;
  assert.equal(model ? model.count : 0, row.quietChoices);
  assert.deepEqual(model ? Array.from(model.weights) : null, row.weights);
  assert.equal(model ? model.qualitySum : 0, row.qualitySum);
  assert.equal(model ? model.qualityWeight : 0, row.qualityWeight);
  const policy = armxPreviewOpponentPolicy(game, game.side);
  assert.equal(policy ? policy.searchBudget : SF55C.nodes, row.searchBudget);
  assert.equal(SF55C_LAST.searchBudget, row.searchBudget);
  assert.equal(policy ? policy.maxDepth : SF55C.maxDepth, row.maxDepth);
  assert.equal(SF55C_LAST.depthLimit, row.maxDepth);
  assert.deepEqual(summarize(stonefishV55Testunit1NoARMXScoreAllMoves(game)), row.native);
  assert.equal(snapshot(game), original);
}
console.log('ARMX_REPLY_POLICY passed: preference learning, reset, forced moves, snapshot isolation, failure cleanup, '
  + golden.positions.length + ' native/prototype parity positions');
