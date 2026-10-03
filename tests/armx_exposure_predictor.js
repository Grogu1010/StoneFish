const assert=require('node:assert/strict');require('./armx_deferred_causal.js');
const snapshot=g=>JSON.stringify({fen:g.fen(),history:g.historyStack,counts:[...g.positionCounts]});
let seed=8911,positions=0;
for(let line=0;line<4;line++){
 const game=new Chess();
 for(let ply=0;ply<40;ply++){
  const legal=game.fastMoves();if(!legal.length)break;
  const before=snapshot(game),quiet=legal.filter(m=>!m.captured&&!m.promotion);
  const rows=armxConfidenceObservationRows(game,quiet);
  for(let i=0;i<quiet.length;i++){
   const individual=armxConfidenceObservationFeatures(game,quiet[i],game.side);
   assert.deepEqual(Array.from(rows[i],x=>x||0),Array.from(individual,x=>x||0));
   assert.equal(rows[i].length,17);assert.ok(rows[i][16]>=0&&rows[i][16]<=4);
  }
  assert.equal(snapshot(game),before);
  const policy=armxFullOpponentPolicy(game,game.side),preview=armxPreviewOpponentPolicy(game,game.side);
  if(preview){if(policy.confidencePolicyActive)assert.equal(policy.weights.length,17);else assert.deepEqual(policy.weights,preview.weights);assert.equal(policy.searchBudget,preview.searchBudget);assert.equal(policy.maxDepth,preview.maxDepth);}
  assert.equal(snapshot(game),before);positions++;
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;game.fastApply(legal[seed%legal.length]);
 }
}
const hanging=new Chess('4k3/8/2p5/8/8/8/8/3QK3 w - - 0 1');
const risky=hanging.fastMoves().find(m=>m.from===hanging._sq('d1')&&m.to===hanging._sq('d5'));
assert.ok(risky);const row=armxConfidenceObservationFeatures(hanging,risky,1);assert.equal(row[16],4);
assert.equal(armxPreviewQuietLogit(row,new Float64Array(17)),0,'exposure has no preference before actual choices train it');
const defended=new Chess('4k3/8/2p5/8/8/8/6B1/3QK3 w - - 0 1');
const protectedMove=defended.fastMoves().find(m=>m.from===defended._sq('d1')&&m.to===defended._sq('d5'));
assert.ok(protectedMove);assert.equal(armxConfidenceObservationFeatures(defended,protectedMove,1)[16],0);
console.log(`ARMX_EXPOSURE_PREDICTOR passed: ${positions} batched/individual feature positions, zero unearned search change, preserved board/history/budget/depth`);
