const assert=require('node:assert/strict');
require('./armx_deferred_causal.js');
const game=new Chess(),fen=game.fen(),weights=new Float64Array(16);
const legal=game.fastMoves();
for(const move of legal){
 const row=armxConfidenceObservationFeatures(game,move,game.side);
 assert.equal(row.length,16);assert.ok(row.every(Number.isFinite));
 assert.equal(armxPreviewQuietLogit(row,weights),0,'unseen evaluation feature cannot add a prior preference');
 assert.equal(game.fen(),fen);assert.equal(game.historyStack.length,0);
}
for(const uci of ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5','a4b3'])assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
const side=game.side,profile=armxPreviewSyncProfile(game,side),book=armxConfidenceSync(game,side,profile);
assert.equal(book.model.count,profile.quietPolicy.count);
assert.deepEqual(book.shadow.quietPolicy,profile.quietPolicy);
const before=game.fen(),preview=armxPreviewOpponentPolicy(game,side),policy=armxFullOpponentPolicy(game,side);
assert.equal(policy.confidencePolicyActive,false);assert.deepEqual(policy.weights,preview.weights);
assert.equal(policy.searchBudget,preview.searchBudget);assert.equal(policy.maxDepth,preview.maxDepth);
assert.equal(game.fen(),before);
console.log('ARMX_EVALUATION_PREDICTOR passed: zero learned prior, finite legal-alternative features, exact comparator, unchanged search policy/budget/depth and board purity');
