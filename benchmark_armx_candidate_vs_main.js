// Paired same-run timing: current 100%-effort ARMX candidate vs production main.
// Both engines run the identical golden histories on the same runner/process.
const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib'),assert=require('node:assert/strict'),path=require('node:path');
const {performance}=require('node:perf_hooks');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js',
'Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js','Stonefish_v4_5_balance_patch.js',
'Stonefish_v5.js','Stonefish_v5_pro.js','Stonefish_v5_pro_speed_patch.js','Stonefish_v5_pro_geometry_patch.js',
'Stonefish_runtime_speed_patch.js','Stonefish_fast_moves_experiment.js','Stonefish_v5_5_search.js',
'Stonefish_v5_5_refutation_guard.js','Stonefish_v5_5_native.js','ARMX-preview.js','Stonefish_v5_5_testunit1.js'];
vm.runInThisContext(files.map(f=>fs.readFileSync(f,'utf8')).join('\n'),{filename:'candidate-bundle.js'});
const mainDir=process.env.MAIN_DIR;if(!mainDir)throw Error('MAIN_DIR required');
const mainContext=vm.createContext({console,performance,Math,process});
vm.runInContext(files.map(f=>fs.readFileSync(path.join(mainDir,f),'utf8')).join('\n'),mainContext,{filename:'main-bundle.js'});
vm.runInContext(`
globalThis.runMainGolden=function(row){
 const game=new Chess();
 for(const uci of row.history)if(!game.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'}))throw Error('bad history '+uci);
 game.armxObservationStartPly=row.observationStartPly;
 armxPreviewSyncProfile(game,game.side);
 const policy=armxPreviewOpponentPolicy(game,game.side);
 if(!policy)return null;
 const started=performance.now(),result=sf55cNativeAcceleratedHost(game,policy),ms=performance.now()-started;
 return {ms,depth:result.depth,nodes:result.nodes,entries:result.finished.map(x=>[x.uci,Number.isFinite(x.score)?x.score:null,Number.isFinite(x.deep)?x.deep:null,!!x.exact])};
};`,mainContext);
const runMain=mainContext.runMainGolden;
function runCandidate(row){
 const game=new Chess();
 for(const uci of row.history)assert.ok(game.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'}),uci);
 game.armxObservationStartPly=row.observationStartPly;
 armxPreviewSyncProfile(game,game.side);
 const policy=armxPreviewOpponentPolicy(game,game.side);
 if(!policy)return null;
 const started=performance.now(),result=sf55cNativeAcceleratedHost(game,policy),ms=performance.now()-started;
 return {ms,depth:result.depth,nodes:result.nodes,entries:result.finished.map(x=>[x.uci,Number.isFinite(x.score)?x.score:null,Number.isFinite(x.deep)?x.deep:null,!!x.exact])};
}
const golden=JSON.parse(zlib.gunzipSync(fs.readFileSync('benchmarks/v5_5/evidence-effort-golden.json.gz')));
const repeats=Math.max(1,Number.parseInt(process.env.REPEATS||'4',10)||4);
let candidateMs=0,mainMs=0,runs=0,matches=0;
for(let repeat=0;repeat<repeats;repeat++){
 for(let index=0;index<golden.positions.length;index++){
  const row=golden.positions[index];let a,b;
  if((repeat+index)&1){b=runMain(row);a=runCandidate(row);}else{a=runCandidate(row);b=runMain(row);}
  if(!a&&!b)continue;
  assert(a&&b,'policy activation differs at '+index);
  candidateMs+=a.ms;mainMs+=b.ms;runs++;
  const same=a.depth===b.depth&&a.nodes===b.nodes&&JSON.stringify(a.entries)===JSON.stringify(b.entries);
  if(same)matches++;
 }
}
const out={repeats,runs,matches,candidateMs,mainMs,candidateAverageMs:runs?candidateMs/runs:0,mainAverageMs:runs?mainMs/runs:0,
 candidateVsMainRatio:mainMs?candidateMs/mainMs:0,speedup: candidateMs?mainMs/candidateMs:0};
console.log('ARMX_CANDIDATE_VS_MAIN '+JSON.stringify(out));
