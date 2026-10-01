const assert=require('node:assert/strict');
require('./armx_finalists.js');
if(process.env.REQUIRE_POLICY_MODE==='1')assert.ok(SF55C_KERNEL&&SF55C_KERNEL.api.policy_mode_version&&SF55C_KERNEL.api.policy_mode_version()>=2,'compiled reply-verification mode missing');
const game=new Chess();
for(const uci of ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5'])assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
assert.equal(armxFullOpponentPolicy(new Chess(),1),null);
const model=armxPreviewSyncProfile(game,1).quietPolicy;
model.qualityWeight=8;model.qualitySum=-4;
const preview=armxPreviewOpponentPolicy(game,1),full=armxFullOpponentPolicy(game,1);
assert.equal(full.verifyLowPriorityReplies,true);
assert.deepEqual(full.weights,preview.weights);
assert.equal(full.searchBudget,preview.searchBudget);
assert.equal(full.maxDepth,preview.maxDepth);
for(const raw of game.fastMoves()){
 assert.equal(full.priority(raw),preview.priority(raw));
 assert.equal(full.isLowPriority(raw),false);
}
model.qualitySum=4;
assert.equal(armxFullOpponentPolicy(game,1).verifyLowPriorityReplies,false);
model.qualitySum=0;
assert.equal(armxFullOpponentPolicy(game,1).verifyLowPriorityReplies,true);
const before=game.fen();
const summarize=host=>({depth:host.depth,nodes:host.nodes,roots:host.finished.map(row=>({uci:row.uci,score:row.score,exact:row.exact}))});
const native=stonefishV55HostSearch(game,full);
assert.equal(native.verifyLowPriorityReplies,true);
const summary=summarize(native),old=process.env.ARMX_COMPILED_EXPERIMENT;
process.env.ARMX_COMPILED_EXPERIMENT='0';
try{assert.deepEqual(summarize(stonefishV55HostSearch(game,full)),summary);}
finally{if(old===undefined)delete process.env.ARMX_COMPILED_EXPERIMENT;else process.env.ARMX_COMPILED_EXPERIMENT=old;}
assert.equal(game.fen(),before);
console.log('ARMX_PREDICTION_VERIFICATION passed: earned reductions, unchanged priorities/budget, native/fallback parity and board purity');
