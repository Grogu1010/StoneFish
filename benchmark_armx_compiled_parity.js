// Diagnostic: compare the experimental compiled ARMX search against the exact
// full-ARMX golden positions. This does not alter production/default search.
const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js','Stonefish_v4_5_balance_patch.js',
'Stonefish_v5.js','Stonefish_v5_pro.js','Stonefish_v5_pro_speed_patch.js','Stonefish_v5_pro_geometry_patch.js',
'Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js','Stonefish_v5_5_search.js',
'Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5.js'];
vm.runInThisContext(files.map(f=>fs.readFileSync(f,'utf8')).join('\n'));
function play(game,moves){for(const uci of moves)assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'}),uci);return game;}
function snap(game){return JSON.stringify({fen:game.fen(),history:game.historyStack,counts:[...game.positionCounts]});}
function summary(result){return {depth:result.depth,nodes:result.nodes,entries:result.finished.map(row=>({
 uci:row.uci,score:Number.isFinite(row.score)?row.score||0:null,deep:Number.isFinite(row.deep)?row.deep||0:null,exact:!!row.exact
}))};}
const golden=JSON.parse(zlib.gunzipSync(fs.readFileSync('benchmarks/v5_5/evidence-effort-golden.json.gz')));
let active=0,exact=0,moveMatch=0,scoreOrderMatch=0,totalMs=0;
const mismatches=[];
for(let index=0;index<golden.positions.length;index++){
 const row=golden.positions[index],game=play(new Chess(),row.history);
 game.armxObservationStartPly=row.observationStartPly;
 const before=snap(game);
 armxPreviewSyncProfile(game,game.side);
 const policy=armxPreviewOpponentPolicy(game,game.side);
 if(!policy)continue;
 active++;
 const started=performance.now();
 const result=sf55cNativeAcceleratedHost(game,policy);
 totalMs+=performance.now()-started;
 assert(result,'compiled search unavailable');
 assert.equal(snap(game),before,'compiled search mutated game '+index);
 const got=summary(result),want=row.armx;
 const same=JSON.stringify(got)===JSON.stringify(want);
 if(same)exact++;
 const gotMove=got.entries[0]&&got.entries[0].uci,wantMove=want.entries[0]&&want.entries[0].uci;
 if(gotMove===wantMove)moveMatch++;
 if(JSON.stringify(got.entries.map(x=>x.uci))===JSON.stringify(want.entries.map(x=>x.uci)))scoreOrderMatch++;
 if(!same&&mismatches.length<20)mismatches.push({index,history:row.history,searchBudget:policy.searchBudget,maxDepth:policy.maxDepth,
  want:{depth:want.depth,nodes:want.nodes,top:want.entries.slice(0,5)},got:{depth:got.depth,nodes:got.nodes,top:got.entries.slice(0,5)}});
}
const out={positions:golden.positions.length,active,exact,moveMatch,scoreOrderMatch,
 exactRate:active?exact/active:1,moveMatchRate:active?moveMatch/active:1,orderMatchRate:active?scoreOrderMatch/active:1,
 averageCompiledMs:active?totalMs/active:0,mismatches};
console.log('ARMX_COMPILED_PARITY '+JSON.stringify(out));
