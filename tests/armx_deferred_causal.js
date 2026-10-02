const assert=require('node:assert/strict');
require('./armx_finalists.js');
const eager=new Chess(),lazy=new Chess(),sequence=['e2e4','e7e5','g1f3','b8c6','f1b5','a7a6','b5a4','g8f6','e1g1','f8e7','f1e1','b7b5','a4b3','d7d6','c2c3','e8g8','h2h3','c8b7','d2d4','f8e8','b1d2','e5d4','c3d4'];
const entry=(game,raw,score)=>({raw,uci:stonefishV45RawUci(game,raw),score,deep:score,exact:true});
for(const uci of sequence){
 for(const game of [eager,lazy])assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4)}));
 armxCausalSync(eager,1);
 const legal=lazy.fastMoves(),before=lazy.fen();
 const roots=[entry(lazy,legal[0],100),entry(lazy,legal[1],-100)];
 for(const style of ['artemis','athena','ares']){
  const review=armxFullReview(lazy,roots,style,1);
  assert.equal(review.winner,roots[0]);assert.equal(review.causalDeferred,true);
 }
 assert.equal(lazy.fen(),before);
 assert.equal(ARMX_CAUSAL_GAME_NOTES.has(lazy),false,'blocked finalists must not instantiate causal replay');
}
const before=lazy.fen(),raws=lazy.fastMoves().slice(0,3);
const roots=raws.map((raw,i)=>entry(lazy,raw,100-i));
const active=armxFullReview(lazy,roots,'artemis',1);
assert.equal(active.causalDeferred,false);assert.equal(lazy.fen(),before);
const eagerBook=armxCausalSync(eager,1),lazyBook=armxCausalSync(lazy,1);
assert.equal(lazyBook.processedPlies,sequence.length);
for(const key of ['our','opponent','pendingTrajectories'])assert.deepEqual(lazyBook[key],eagerBook[key]);
assert.equal(lazyBook.replay.fen(),eagerBook.replay.fen());
for(const style of ['artemis','athena','ares']){
 const aRoots=raws.map((raw,i)=>entry(lazy,raw,100-i));
 const bRoots=eager.fastMoves().slice(0,3).map((raw,i)=>entry(eager,raw,100-i));
 const a=armxFullReview(lazy,aRoots,style,1),b=armxFullReview(eager,bRoots,style,1);
 assert.equal(a.winner.uci,b.winner.uci);
 assert.deepEqual(a.reports.map(r=>({causal:r.causal,noteLead:r.noteLead,decisionLead:r.decisionLead})),b.reports.map(r=>({causal:r.causal,noteLead:r.noteLead,decisionLead:r.decisionLead})));
}
const mate=raws.map((raw,i)=>entry(lazy,raw,SF55C.mate-i));
assert.equal(armxFullReview(lazy,mate,'artemis',1).causalDeferred,true);
const existing=lazyBook;lazy.reset();const reset=armxCausalSync(lazy,1);
assert.notEqual(reset,existing);assert.equal(reset.processedPlies,0);assert.equal(reset.our.size,0);
console.log('ARMX_DEFERRED_CAUSAL passed: blocked/mate deferral, complete treatment/control and pending-horizon parity, finalist parity, reset and board purity');
