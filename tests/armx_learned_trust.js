const assert=require('node:assert/strict');
require('./armx_finalists.js');
const game=new Chess();
for(const uci of ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5','a4b3'])assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
const perspective=game.side,profile=armxPreviewSyncProfile(game,perspective),book=armxCausalSync(game,perspective,profile);
profile.quietPolicy.qualitySum=-1;profile.quietPolicy.qualityWeight=10;
book.richQuiet.count=8;book.richQuiet.qualityWeight=10;book.richQuiet.qualitySum=-1;
const poor=armxCausalPredictionReliability(book,profile);
assert.equal(poor,0);
book.richQuiet.qualitySum=2;
const earned=armxCausalPredictionReliability(book,profile);
assert.ok(earned>poor&&earned<=1);
const preview=armxPreviewOpponentPolicy(game,perspective),full=armxFullOpponentPolicy(game,perspective);
assert.equal(full.richPolicyActive,false);assert.equal(full.richTrustActive,true);
assert.deepEqual(full.weights,preview.weights);
assert.equal(full.searchBudget,preview.searchBudget);assert.equal(full.maxDepth,preview.maxDepth);
const before=game.fen();
for(const move of game.fastMoves()){
 assert.equal(full.priority(move),preview.priority(move));
 assert.equal(full.isLowPriority(move),preview.isLowPriority(move));
}
assert.equal(game.fen(),before);
const cold=new Chess();assert.equal(armxFullOpponentPolicy(cold,1),null);
assert.equal(armxCausalPredictionReliability(armxCausalSync(cold,1),armxPreviewSyncProfile(cold,1)),0);
game.reset();assert.notEqual(armxCausalSync(game,perspective),book);
console.log('ARMX_LEARNED_TRUST passed: prequential earned confidence, identical Preview ordering/budget/depth, cold fallback, reset and board purity');
