const assert=require('node:assert/strict');
require('./armx_finalists.js');
const game=new Chess();
const entries=game.fastMoves().slice(0,2).map(raw=>({raw}));
const before=JSON.stringify({fen:game.fen(),history:game.historyStack,counts:[...game.positionCounts]});
const done=armxCausalVerifyPair(game,...entries,3,120000);
assert.equal(done.complete,true);
assert.ok(Number.isFinite(done.incumbentScore)&&Number.isFinite(done.challengerScore));
const aborted=armxCausalVerifyPair(game,...entries,5,1);
assert.equal(aborted.complete,false);
assert.ok(aborted.nodes>0);
assert.equal(JSON.stringify({fen:game.fen(),history:game.historyStack,counts:[...game.positionCounts]}),before);
const search=sf55cSearch;
sf55cSearch=()=>{throw new Error('verification failure');};
try{assert.throws(()=>armxCausalVerifyPair(game,...entries,3),/verification failure/);}
finally{sf55cSearch=search;}
assert.equal(JSON.stringify({fen:game.fen(),history:game.historyStack,counts:[...game.positionCounts]}),before);
const incumbent={entry:entries[0],causal:{},noteAdjustment:0};
const challenger={entry:entries[1],causal:{},noteAdjustment:100,objectiveEligible:true,fullNoteGate:{allowed:false}};
assert.equal(armxCausalVerifiedProposal(game,[incumbent,challenger],incumbent,0,{}),null);
assert.equal(armxCausalVerifiedProposal(game,[incumbent,challenger],incumbent,20,{}),null);
console.log('ARMX_VERIFIED_PROPOSALS passed: no cold verification, bounded abort, exact scores, failure cleanup and board purity');

const effect={confidence:0.2,signal:0.12,reliability:0.5,evidence:4,delayedEvidence:2};
incumbent.causal=effect;challenger.causal=effect;
const verify=armxCausalVerifyPair;
armxCausalVerifyPair=()=>({complete:true,nodes:20,incumbentScore:100,challengerScore:100});
try {
  assert.equal(armxCausalVerifiedProposal(game,[incumbent,challenger],incumbent,20,{}).accepted,false);
  armxCausalVerifyPair=()=>({complete:true,nodes:20,incumbentScore:100,challengerScore:110});
  assert.equal(armxCausalVerifiedProposal(game,[incumbent,challenger],incumbent,20,{}).accepted,true);
  armxCausalVerifyPair=()=>({complete:false,nodes:2401});
  assert.equal(armxCausalVerifiedProposal(game,[incumbent,challenger],incumbent,20,{}).accepted,false);
} finally {armxCausalVerifyPair=verify;}
