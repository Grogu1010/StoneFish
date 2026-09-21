const fs=require('fs'),vm=require('vm'),assert=require('assert');
const contract=fs.readFileSync('benchmark_v5_5_native_contract.js','utf8');
const files=vm.runInNewContext(contract.match(/const files=(\[[^;]+\]);/)[1]);
vm.runInThisContext(files.map(f=>fs.readFileSync(f,'utf8')).join('\n'));
const key=m=>[m.from,m.to,m.piece,m.captured,m.promotion||0,m.flags].join(':');
let rng=19301,positions=0;
function check(g){
 const before=g.fen(),legal=g.fastMoves();
 assert.deepStrictEqual(sf55cLegalMoves(g).map(key),legal.map(key),before);
 assert.deepStrictEqual(sf55cTacticalMoves(g).map(key),legal.filter(m=>m.captured||m.promotion).map(key),before);
 assert.equal(sf55cHasLegalMove(g),legal.length>0,before);
 assert.equal(sf55cInCheck(g),g.in_check(),before);
 assert.equal(sf55cEvaluate(g),sf55cEvaluateJS(g),before);
 assert.equal(g.fen(),before);positions++;return legal;
}
for(let line=0;line<40;line++){
 const g=new Chess();
 for(let ply=0;ply<140;ply++){
  const legal=check(g);if(!legal.length)break;
  rng=(Math.imul(rng,1664525)+1013904223)>>>0;
  g._applyRaw(legal[rng%legal.length],true);
 }
}
function position(pieces,side=1){const g=new Chess();g.boardState.fill(0);g.castling=0;g.ep=-1;g.side=side;g.positionCounts.clear();g._stonefishRuntimePositionKey=null;g._stonefishRuntimeMemo=null;for(const [sq,p] of Object.entries(pieces)){const n=g._sq(sq);g.boardState[n]=p;if(Math.abs(p)===6)g.kingSq[p>0?1:-1]=n;}return g;}
for(const side of [1,-1]){
 for(const spec of [{a7:1,b8:-4,e1:6,h8:-6},{h2:-1,g1:4,e8:-6,a1:6},{e5:1,d5:-1,e1:6,h8:-6},{h8:-6,g7:5,f6:6},{h8:-6,f7:5,f6:6},{a1:4,e1:6,h1:4,a8:-4,e8:-6,h8:-4}]){
  const g=position(spec,side);if(spec.e5)g.ep=g._sq('d6');if(spec.h1)g.castling=15;check(g);
 }
}
assert.ok(SF55C_KERNEL,'Compiled module must load on the CI runtime');
assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(SF55C_WASM_BYTES)).length,0);

// Packed identity must preserve every public state field independently.
const identityGame=new Chess(),identities=new Set();
for(const side of [1,-1])for(let castling=0;castling<16;castling++)for(let ep=-1;ep<64;ep++){
 identityGame.side=side;identityGame.castling=castling;identityGame.ep=ep;
 const packed=sf55cPackedPositionKey(identityGame);
 assert.equal(packed,sf55cPackHistoryKey(stonefishRuntimeBasePositionKey.call(identityGame)));
 identities.add(packed);
}
assert.equal(identities.size,2080);
for(let square=0;square<64;square++)for(let piece=-6;piece<=6;piece++){
 identityGame.boardState.fill(0);identityGame.boardState[square]=piece;
 assert.equal(sf55cPackedPositionKey(identityGame),sf55cPackHistoryKey(stonefishRuntimeBasePositionKey.call(identityGame)));
}

// Verify the material shortcut against the board after every search mutation.
let materialChecks=0;
const originalDraw=sf55cDraw;
sf55cDraw=function(g,ctx,key){
 if(Number.isFinite(ctx.material)){
  const actual=Array.from(g.boardState).filter(p=>[1,4,5].includes(Math.abs(p))).length;
  assert.equal(ctx.material,actual,g.fen());materialChecks++;
 }
 return originalDraw(g,ctx,key);
};
const fixtures=JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync('benchmarks/v5_5/evidence-effort-golden.json.gz'))).positions;
const compiled=SF55C_KERNEL;
const summarize=entries=>({depth:SF55C_LAST.depth,nodes:SF55C_LAST.nodes,entries:entries.map(row=>({uci:row.uci,score:Number.isFinite(row.score)?row.score||0:null,deep:Number.isFinite(row.deep)?row.deep||0:null,exact:!!row.exact}))});
for(const row of fixtures){
 const g=new Chess();for(const uci of row.history)assert.ok(g.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||'q'}));
 g.armxObservationStartPly=row.observationStartPly;
 SF55C_KERNEL=compiled;
 assert.deepStrictEqual(summarize(stonefishV55Testunit1NoARMXScoreAllMoves(g)),row.native);
 const candidateCompiled=summarize(stonefishV55Testunit1ScoreAllMoves(g));
 SF55C_KERNEL=null;
 assert.deepStrictEqual(summarize(stonefishV55Testunit1NoARMXScoreAllMoves(g)),row.native);
 assert.deepStrictEqual(summarize(stonefishV55Testunit1ScoreAllMoves(g)),candidateCompiled);
}
SF55C_KERNEL=compiled;sf55cDraw=originalDraw;
// Explicit underpromotions, promotion captures and en passant exercise deltas.
for(const spec of [{a7:1,b8:-4,e1:6,h8:-6},{e5:1,d5:-1,e1:6,h8:-6}]){
 const g=position(spec);if(spec.e5)g.ep=g._sq('d6');
 const before=Array.from(g.boardState).filter(p=>[1,4,5].includes(Math.abs(p))).length;
 for(const move of g.fastMoves()){
  g.fastApply(move);
  assert.equal(before-sf55cMaterialMoveDelta(move),Array.from(g.boardState).filter(p=>[1,4,5].includes(Math.abs(p))).length);
  g.fastUndo();
 }
}
console.log({ok:true,positions,identities:identities.size,fullSearchFixtures:fixtures.length,materialChecks});

