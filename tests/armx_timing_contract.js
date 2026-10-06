const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const filename=path.resolve('tests/v5_5_range.js');
const source=fs.readFileSync(filename,'utf8');
const boundary=source.indexOf('const STYLE_FEATURES=');
assert.ok(boundary>0);
const harness=new Function('require','__filename',source.slice(0,boundary)+'\nreturn {generateTimingHistory,positionAfter,prepareTimingGame,clearSharedEngineCaches};')(require,filename);
const summarize=review=>JSON.parse(JSON.stringify(review,(key,value)=>key==='raw'?undefined:value));
let checks=0;
for(const plies of [12,52,100]){
 const game=harness.positionAfter(harness.generateTimingHistory(5001,plies));
 game.armxObservationStartPly=0;
 for(const style of ['preview','athena','ares','artemis']){
  const results=[];
  for(const incremental of [false,true]){
   const prepared=harness.prepareTimingGame(game,style,incremental);
   const before=prepared.fen(),depth=prepared.historyStack.length;
   assert.equal(before,game.fen());assert.equal(depth,game.historyStack.length);
   assert.deepEqual(prepared.positionCounts,game.positionCounts);
   harness.clearSharedEngineCaches();
   const policy=style==='preview'?armxPreviewOpponentPolicy(prepared,prepared.side):armxFullOpponentPolicy(prepared,prepared.side,style);
   const host=stonefishV55HostSearch(prepared,policy);
   const review=style==='preview'?armxPreviewReview(prepared,host.finished.slice(0,Math.max(1,ARMX_PREVIEW.candidateLimit)),prepared.side):armxFullReview(prepared,host.finished,style,prepared.side);
   results.push({roots:host.finished.map(row=>({uci:row.uci,score:row.score,deep:row.deep})),review:summarize(review)});
   assert.equal(prepared.fen(),before);assert.equal(prepared.historyStack.length,depth);
   assert.deepEqual(prepared.positionCounts,game.positionCounts);
   prepared.reset();
   const resetPolicy=style==='preview'?armxPreviewOpponentPolicy(prepared,prepared.side):armxFullOpponentPolicy(prepared,prepared.side,style);
   const fresh=new Chess();
   const freshPolicy=style==='preview'?armxPreviewOpponentPolicy(fresh,fresh.side):armxFullOpponentPolicy(fresh,fresh.side,style);
   assert.deepEqual(resetPolicy&&Array.from(resetPolicy.weights||[]),freshPolicy&&Array.from(freshPolicy.weights||[]));
  }
  assert.deepEqual(results[1],results[0],`${style}, ${plies} plies: cold/incremental search or review changed`);checks++;
 }
}
console.log(`ARMX_TIMING_CONTRACT passed: ${checks} cold/incremental decisions, repetition state, board/history purity and reset`);
