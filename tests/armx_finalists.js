// Full-only finalist safety and deferred style-history contracts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
vm.runInThisContext(['StonefishChess.js', ...['v1.js','v2.js','v3.js','v4.js','v4_5.js','v5.js','v5_pro.js','v5_5.js'].map(file=>`models/${file}`),
  'ARMX/ARMX-preview.js','ARMX/ARMX.js'].map(file=>fs.readFileSync(file,'utf8')).join('\n'));
const opening=['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6'];
function play(game, moves) {
  for (const uci of moves) assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
  return game;
}
function host(game, gap) {
  return game.fastMoves().slice(0,2).map((raw,index)=>({raw,score:100-index*gap,deep:100-index*gap}));
}
for (const style of ['athena','ares']) {
  const game=play(new Chess(),opening);
  const before=game.fen();
  const sync=armxFullSyncNotebook;
  let calls=0;
  armxFullSyncNotebook=(...args)=>{calls++;return sync(...args);};
  try {
    const far=host(game,80);
    const blocked=armxFullReview(game,far,style);
    assert.equal(calls,0);
    assert.equal(blocked.winner,far[0]);
    assert.equal(blocked.reports[1].objectiveEligible,false);
    const mate=host(game,0);mate[0].score=mate[0].deep=100000;
    armxFullReview(game,mate,style);
    assert.equal(calls,0);
    armxFullReview(game,host(game,0),style);
    assert.equal(calls,1);
    assert.equal(game.fen(),before);
  } finally {armxFullSyncNotebook=sync;}
  const eager=new Chess();
  for(const uci of opening) {
    play(eager,[uci]);
    armxFullSyncNotebook(eager,1,armxPreviewSyncProfile(eager,1));
  }
  const lazyBook=armxFullSyncNotebook(game,1,armxPreviewSyncProfile(game,1));
  const eagerBook=armxFullSyncNotebook(eager,1,armxPreviewSyncProfile(eager,1));
  assert.equal(lazyBook.processedPlies,opening.length);
  assert.deepEqual(armxFullNotebookSummary(lazyBook),armxFullNotebookSummary(eagerBook));
  assert.deepEqual(lazyBook.extendedEffects,eagerBook.extendedEffects);
  assert.deepEqual(lazyBook.ourContextEffects,eagerBook.ourContextEffects);
  assert.deepEqual(lazyBook.responseEffects,eagerBook.responseEffects);
}
console.log('ARMX_FINALISTS passed: safety windows, deferred style replay, complete history parity, board purity');
