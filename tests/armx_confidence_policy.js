const assert=require('node:assert/strict');
require('./armx_deferred_causal.js');
const game=new Chess(),sequence=['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5','a4b3'];
for(const uci of sequence)assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
const side=game.side,profile=armxPreviewSyncProfile(game,side),book=armxConfidenceSync(game,side,profile);
assert.deepEqual(book.shadow.quietPolicy,profile.quietPolicy,'comparator must learn exactly the same choices as Preview');
assert.equal(book.model.count,profile.quietPolicy.count);
assert.equal(book.model.predictions,book.model.count-1);
const count=book.model.count;armxConfidenceSync(game,side,profile);assert.equal(book.model.count,count,'repeated reads cannot add observations');
assert.equal(ARMX_CAUSAL_GAME_NOTES.has(game),false,'learning reply predictions cannot force causal-plan replay');
Object.assign(book.model,{count:13,predictions:12,fullGain:1.2,fullGainSq:12.12,pairedGain:1.2,pairedGainSq:12.12});
assert.equal(armxConfidenceQuality(book).trusted,false,'positive noisy means are insufficient');
Object.assign(book.model,{fullGain:2.4,fullGainSq:.48,pairedGain:0,pairedGainSq:0});
assert.equal(armxConfidenceQuality(book).trusted,false,'uniform improvement cannot replace comparison with Preview');
Object.assign(book.model,{pairedGain:2.4,pairedGainSq:.48});
assert.equal(armxConfidenceQuality(book).trusted,true);
book.model.weights[13]=.8;book.model.weights[14]=-1.1;
const before=game.fen(),preview=armxPreviewOpponentPolicy(game,side),policy=armxFullOpponentPolicy(game,side);
assert.equal(policy.confidencePolicyActive,true);assert.equal(policy.weights.length,15);
assert.equal(policy.searchBudget,preview.searchBudget);assert.equal(policy.maxDepth,preview.maxDepth);
const frozen=Array.from(policy.weights);book.model.weights.fill(-2);assert.deepEqual(Array.from(policy.weights),frozen);
for(const move of game.fastMoves()){
 const expected=armxPreviewQuietLogit(armxConfidenceFeatures(game,move,-side),policy.weights);
 assert.equal(policy.priority(move),Math.round(300*expected));assert.equal(policy.isLowPriority(move),expected<0);
}
const summarize=host=>({depth:host.depth,nodes:host.nodes,roots:host.finished.map(row=>({uci:row.uci,score:row.score,exact:row.exact}))});
const native=summarize(stonefishV55HostSearch(game,policy));
const old=process.env.ARMX_COMPILED_EXPERIMENT;process.env.ARMX_COMPILED_EXPERIMENT='0';
try{assert.deepEqual(summarize(stonefishV55HostSearch(game,policy)),native);}
finally{if(old===undefined)delete process.env.ARMX_COMPILED_EXPERIMENT;else process.env.ARMX_COMPILED_EXPERIMENT=old;}
assert.equal(game.fen(),before);
const excluded=new Chess();for(const uci of sequence)assert.ok(excluded.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
excluded.armxObservationStartPly=excluded.historyStack.length;
assert.equal(armxConfidenceSync(excluded,excluded.side).model.count,0);
game.reset();assert.equal(armxFullOpponentPolicy(game,side),null);const reset=armxConfidenceSync(game,side);assert.notEqual(reset,book);assert.equal(reset.model.count,0);assert.ok(reset.model.weights.every(x=>x===0));
console.log('ARMX_CONFIDENCE_POLICY passed: exact pre-update comparator, unique observations, consistent paired gains, immutable weights, earned budget/depth, native parity, opening exclusion, reset and board purity');
