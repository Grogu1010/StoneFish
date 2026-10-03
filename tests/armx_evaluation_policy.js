const assert=require('node:assert/strict');
require('./armx_confidence_policy.js');
const snapshot=g=>JSON.stringify({fen:g.fen(),history:g.historyStack,counts:[...g.positionCounts],board:[...g.boardState]});
const summarize=h=>({depth:h.depth,nodes:h.nodes,roots:h.finished.map(r=>({uci:r.uci,score:r.score,exact:r.exact}))});
assert.equal(SF55C_KERNEL.policyWeights.length,16);
let rng=19907,checked=0;
for(let line=0;line<5;line++){
 const g=new Chess();
 for(let ply=0;ply<36;ply++){
  const legal=g.fastMoves();if(!legal.length)break;
  const quiet=legal.filter(m=>!m.captured&&!m.promotion),prior=snapshot(g);
  const batch=armxConfidenceObservationRows(g,quiet);
  assert.deepEqual([...SF55C_KERNEL.board],[...g.boardState]);
  for(let i=0;i<quiet.length;i++)assert.deepEqual(Array.from(batch[i],v=>v||0),Array.from(armxConfidenceObservationFeatures(g,quiet[i],g.side),v=>v||0),'batch must equal individual feature evaluation (zero signs are equivalent logits)');
  assert.equal(snapshot(g),prior);
  if(ply>=12&&ply%8===4){
   const side=g.side,book=armxConfidenceSync(g,side);
   Object.assign(book.model,{count:13,predictions:12,fullGain:2.4,fullGainSq:.48,pairedGain:2.4,pairedGainSq:.48});
   for(let i=0;i<16;i++)book.model.weights[i]=Math.sin(i+line)*.6;
   const before=snapshot(g),policy=armxFullOpponentPolicy(g,side);assert.ok(policy.confidencePolicyActive);
   const compact={...policy,searchBudget:1200,maxDepth:4};
   process.env.ARMX_COMPILED_EXPERIMENT='1';const native=summarize(stonefishV55HostSearch(g,compact));
   process.env.ARMX_COMPILED_EXPERIMENT='0';const fallback=summarize(stonefishV55HostSearch(g,compact));
   assert.deepEqual(fallback,native,`full search parity at ${g.fen()}`);assert.equal(snapshot(g),before);checked++;
   // Callbacks must recover the pre-reply feature vector without adding history.
   const reply=legal.find(m=>!m.captured&&!m.promotion);if(reply){
    const replyPolicy={...policy};
    // The search policy predicts the opposite actor; use an opponent position.
    const ctx={};sf55cApply(g,ctx,reply,1);
    const responses=g.fastMoves().filter(m=>!m.captured&&!m.promotion);
    for(const m of responses.slice(0,4)){
     const expected=replyPolicy.priority(m),low=replyPolicy.isLowPriority(m),prior=snapshot(g),undo={};
     sf55cApply(g,undo,m,1);const applied=snapshot(g);
     assert.equal(replyPolicy.priority(m),expected);assert.equal(replyPolicy.isLowPriority(m),low);
     assert.equal(snapshot(g),applied);sf55cUndo(g,undo,m,1);assert.equal(snapshot(g),prior);
    }
    sf55cUndo(g,ctx,reply,1);assert.equal(snapshot(g),before);
   }
  }
  rng=(Math.imul(rng,1664525)+1013904223)>>>0;g.fastApply(legal[rng%legal.length]);
 }
}
const forced=new Chess();
for(const uci of ['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5','a4b3'])forced.move({from:uci.slice(0,2),to:uci.slice(2,4)});
const forcedBook=armxConfidenceSync(forced,1);
Object.assign(forcedBook.model,{count:13,predictions:12,fullGain:2.4,fullGainSq:.48,pairedGain:2.4,pairedGainSq:.48});
forcedBook.model.weights.fill(-1);
const forcedPolicy=armxFullOpponentPolicy(forced,1);
assert.ok(forcedPolicy.confidencePolicyActive);
forced.load('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1');
assert.ok(forced.in_check());
for(const move of forced.fastMoves()){
 const before=snapshot(forced),ctx={};
 assert.equal(forcedPolicy.priority(move),0);assert.equal(forcedPolicy.isLowPriority(move),false);
 sf55cApply(forced,ctx,move,1);const applied=snapshot(forced);
 assert.equal(forcedPolicy.priority(move),0);assert.equal(forcedPolicy.isLowPriority(move),false);
 assert.equal(snapshot(forced),applied);sf55cUndo(forced,ctx,move,1);assert.equal(snapshot(forced),before);
}
console.log(`ARMX_EVALUATION_POLICY passed: ${checked} exact native/fallback searches, exact batched features, forced-reply scope, frozen learned features, pre/post reply identity and history/board purity`);
