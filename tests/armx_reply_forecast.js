const assert=require('node:assert/strict');
require('./armx_causal_key_union.js');
const game=new Chess(),before=game.fen(),root=game.fastMoves().find(m=>m.from===game._sq('e2')&&m.to===game._sq('e4'));
const weights=new Float64Array(13),uniform=armxLearnedReplyResidual(game,{raw:root},weights,1);
assert.ok(uniform&&uniform.replies>1);assert.ok(Math.abs(uniform.residual)<1e-10);
weights[0]=1;weights[8]=2;const frozen=Array.from(weights);
const learned=armxLearnedReplyResidual(game,{raw:root},weights,1);
assert.ok(Number.isFinite(learned.residual)&&Math.abs(learned.residual)>1e-6);
assert.equal(game.fen(),before);assert.equal(game.historyStack.length,0);assert.deepEqual(Array.from(weights),frozen);
for(const limit of [0,1,3,512]){
 const budget={limit,nodes:0};const result=armxLearnedReplyResidual(game,{raw:root},weights,1,budget);
 assert.ok(budget.nodes<=limit);if(limit<=3)assert.equal(result,null);
 assert.equal(game.fen(),before);assert.equal(game.historyStack.length,0);
}
for(const uci of ['e2e4','e7e5'])assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
const d4=game.fastMoves().find(m=>m.from===game._sq('d2')&&m.to===game._sq('d4'));const current=game.fen();
assert.equal(armxLearnedReplyResidual(game,{raw:d4},weights,1),null);
assert.equal(game.fen(),current);
// A qualified forecast cannot reduce the host search budget, even if no
// finalist is eligible. The host policy itself remains Preview's exact object.
const observed=new Chess();
for(const uci of ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5','a4b3'])assert.ok(observed.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
const profile=armxPreviewSyncProfile(observed,observed.side);profile.quietPolicy.count=8;profile.quietPolicy.qualitySum=2;profile.quietPolicy.qualityWeight=10;
const preview=armxPreviewOpponentPolicy(observed,observed.side),full=armxFullOpponentPolicy(observed,observed.side);
assert.equal(full.searchBudget,preview.searchBudget);assert.equal(full.maxDepth,preview.maxDepth);assert.deepEqual(full.weights,preview.weights);
const roots=observed.fastMoves().slice(0,2).map((raw,i)=>({raw,score:100-i*100,deep:100-i*100}));
const blocked=armxFullReview(observed,roots,'artemis');assert.equal(blocked.replyForecastActive,false);assert.equal(blocked.replyForecastNodes,0);assert.equal(blocked.winner,roots[0]);
console.log('ARMX_REPLY_FORECAST passed: learned residual, uniform zero vote, conditional reply exclusion, bounded nodes, board purity, unchanged host budget and blocked-finalist deferral');
// If the provisional cannot be modelled, no challenger probe can contribute
// a differential learned vote. Skip those calls without changing the choice.
const originalForecast=armxLearnedReplyResidual;
let forecastCalls=0;
try{
 armxLearnedReplyResidual=()=>{forecastCalls++;return null;};
 roots[1].score=roots[1].deep=99;
 const skipped=armxFullReview(observed,roots,'artemis');
 assert.equal(forecastCalls,1);assert.equal(skipped.replyForecastNodes,0);
 assert.equal(skipped.replyForecastChangedWinner,false);
 roots[0].raw={...roots[0].raw,captured:1};forecastCalls=0;
 const capture=armxFullReview(observed,roots,'artemis');
 assert.equal(forecastCalls,0);assert.equal(capture.replyForecastActive,false);
}finally{armxLearnedReplyResidual=originalForecast;}
console.log('ARMX_REPLY_FORECAST_IDLE passed: unmodelled provisional and captured provisional cannot trigger useless challenger probes');
