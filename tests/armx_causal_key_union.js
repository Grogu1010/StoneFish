const assert=require('node:assert/strict');
require('./armx_deferred_causal.js');
const optimized=armxCausalAvailableKeys;
const reference=(game,legal,contexts)=>{
 const keys=new Set();
 for(const move of legal)for(const key of armxCausalKeys(game,move,game.side,contexts))keys.add(key);
 return keys;
};
// Capture and check offered by different options must not become checkCapture.
const baseFeatures=armxCausalBaseFeatures;
try{
 armxCausalBaseFeatures=(_game,move)=>new Set(move.features);
 const keys=optimized({},[{features:['capture']},{features:['check']}],['phaseMiddle']);
 assert.equal(keys.has('capture&check'),false);
 assert.equal(keys.has('capture@phaseMiddle'),true);
 assert.equal(keys.has('check@phaseMiddle'),true);
}finally{armxCausalBaseFeatures=baseFeatures;}
const optimizedHorizon=armxCausalRecordHorizon;
const referenceHorizon=(map,available,chosen,impact,weight,observationId,prefix)=>{
 const normalized=armxFullClamp(impact/(Number(ARMX_PREVIEW.effectScale)||360),-1,1);
 for(const key of available){
  const row=armxCausalRow(map,key),side=chosen.has(key)?'Treated':'Control';
  row[prefix+side+'Weight']+=weight;
  row[prefix+side+'Impact']+=normalized*weight;
  row[prefix+side+'ImpactSq']+=normalized*normalized*weight;
 }
};
const cold=new Chess(),incremental=new Chess();
let positions=0,options=0;
const normalize=book=>({our:book.our,opponent:book.opponent,
 pending:book.pendingTrajectories.map(row=>({...row,map:undefined,available:row.available.slice().sort()})),
 processedPlies:book.processedPlies,replay:book.replay.fen()});
for(let ply=0;ply<120&&!cold.game_over();ply++){
 const legal=cold.fastMoves(),before=cold.fen(),depth=cold.historyStack.length;
 for(const contexts of [armxCausalContexts(cold,cold.side),['phaseEnd','queenless','weAhead','lateObserved'],['phaseMiddle','queensOn','weBehind','midObserved']]){
  assert.deepEqual([...optimized(cold,legal,contexts)].sort(),[...reference(cold,legal,contexts)].sort());
 }
 assert.equal(cold.fen(),before);assert.equal(cold.historyStack.length,depth);
 positions++;options+=legal.length;
 const raw=legal[(ply*17+11)%legal.length];
 cold._applyRaw({...raw},true);incremental._applyRaw({...raw},true);
 for(const perspective of [1,-1]){
  armxCausalAvailableKeys=reference;armxCausalRecordHorizon=referenceHorizon;
  const a=armxCausalSync(cold,perspective);
  armxCausalAvailableKeys=optimized;armxCausalRecordHorizon=optimizedHorizon;
  const b=armxCausalSync(incremental,perspective);
  assert.deepEqual(normalize(a),normalize(b));
 }
}
// A full catch-up replay must equal the incrementally maintained notebook.
const catchup=new Chess();
for(const state of cold.historyStack)catchup._applyRaw({...state.move},state.trackRepetition);
for(const perspective of [1,-1])assert.deepEqual(normalize(armxCausalSync(catchup,perspective)),normalize(armxCausalSync(incremental,perspective)));
console.log(`ARMX_CAUSAL_KEY_UNION passed: ${positions} positions, ${options} legal options, both perspectives and cold/incremental evidence parity`);
