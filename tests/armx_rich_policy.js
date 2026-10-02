const assert=require('node:assert/strict');
require('./armx_finalists.js');
const moves=['g1f3','b8c6','b1c3','c6b8','f3g1','b8c6','c3b1','c6b8','g1f3','b8c6','b1c3','c6b8'];
function play(game,sequence){for(const uci of sequence)assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));return game;}
const game=play(new Chess(),moves),profile=armxPreviewSyncProfile(game,1);
const before=game.fen(),book=armxCausalSync(game,1,profile);
assert.equal(book.richQuiet.count,profile.quietPolicy.count);
assert.equal(book.previewShadow.quietPolicy,profile.quietPolicy);
assert.ok(ARMX_RICH_QUIET_SIZE===13);
assert.equal(game.fen(),before);
const quality=armxRichPolicyQuality(book);
assert.equal(quality.predictions,quality.observations-1);
for(const raw of game.fastMoves()){
  const dense=armxRichQuietFeatures(game,raw,1),sparse=armxRichSparseFeatures(game,raw,1);
  assert.equal(armxRichSparseLogit(sparse,book.richQuiet.weights),armxPreviewQuietLogit(dense,book.richQuiet.weights));

}
assert.ok(Object.values(quality).every(x=>typeof x==='boolean'||Number.isFinite(x)));
// Accuracy of the full feature model cannot stand in for native projection accuracy.
book.richQuiet.qualitySum=100;book.richQuiet.projectionQualitySum=-100;book.richQuiet.qualityWeight=10;
assert.equal(armxFullOpponentPolicy(game,1).richPolicyActive,false);
book.richQuiet.projectionQualitySum=100;
const policy=armxFullOpponentPolicy(game,1);
assert.equal(policy.richPolicyActive,true);
const frozen=Array.from(policy.weights);book.richQuiet.weights.fill(-6);
assert.deepEqual(Array.from(policy.weights),frozen);
for(const raw of game.fastMoves()){
 assert.equal(policy.priority(raw),Math.round(300*armxPreviewQuietLogit(armxPreviewQuietFeatures(raw,-1),policy.weights)));
 assert.equal(policy.isLowPriority(raw),armxPreviewQuietLogit(armxPreviewQuietFeatures(raw,-1),policy.weights)<0);
}
const excluded=play(new Chess(),moves);excluded.armxObservationStartPly=excluded.historyStack.length;
assert.equal(armxCausalSync(excluded,1).richQuiet.count,0);
game.reset();const reset=armxCausalSync(game,1);
assert.notEqual(reset,book);assert.equal(reset.richQuiet.count,0);assert.ok(reset.richQuiet.weights.every(x=>x===0));
console.log('ARMX_RICH_POLICY passed: matched pre-move comparator, projection trust, frozen native weights, reset and opening exclusion');

// The policy accepted by the trust gate must be identical in native WASM and
// the JavaScript fallback, including completed depth, nodes and exact roots.
const parityGame=play(new Chess(),['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5','a4b3']);
const parityBook=armxCausalSync(parityGame,parityGame.side);
parityBook.richQuiet.projectionQualitySum=100;parityBook.richQuiet.qualityWeight=10;
const parityPolicy=armxFullOpponentPolicy(parityGame,parityGame.side);
assert.equal(parityPolicy.richPolicyActive,true);
const summarize=host=>({depth:host.depth,nodes:host.nodes,roots:host.finished.map(row=>({uci:row.uci,score:row.score,exact:row.exact}))});
const compiled=summarize(stonefishV55HostSearch(parityGame,parityPolicy));
const env=process.env.ARMX_COMPILED_EXPERIMENT;
process.env.ARMX_COMPILED_EXPERIMENT='0';
try{assert.deepEqual(summarize(stonefishV55HostSearch(parityGame,parityPolicy)),compiled);}
finally{if(env===undefined)delete process.env.ARMX_COMPILED_EXPERIMENT;else process.env.ARMX_COMPILED_EXPERIMENT=env;}
console.log('ARMX_RICH_NATIVE_PARITY passed');
