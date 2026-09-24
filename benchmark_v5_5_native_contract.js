const fs=require('fs'),vm=require('vm'),assert=require('assert');
const files=['StonefishChess.js','models/models.js','ARMX/ARMX.js'];
vm.runInThisContext(files.map(f=>fs.readFileSync(f,'utf8')).join('\n'));
function position(pieces,side=1,halfmove=0){const g=new Chess();g.boardState.fill(0);g.castling=0;g.ep=-1;g.side=side;g.halfmove=halfmove;g.positionCounts.clear();g._stonefishRuntimePositionKey=null;g._stonefishRuntimeMemo=null;for(const [sq,p] of Object.entries(pieces)){const n=g._sq(sq);g.boardState[n]=p;if(Math.abs(p)===6)g.kingSq[p>0?1:-1]=n;}return g;}
function context(){return {nodes:0,limit:1600,depth:1,abort:false,tt:new Map(),path:new Map(),pathIds:[],positionIds:new Map(),killers:[],history:new Int32Array(32768)};}
function snap(g){return JSON.stringify({fen:g.fen(),history:g.historyStack,counts:[...g.positionCounts],cacheDepth:g._stonefishRuntimeCacheStack.length});}
const game=new Chess(),before=snap(game);
const host=sf55cHost(game);assert.strictEqual(snap(game),before);assert(game.fastMoves().some(m=>sf55cMoveId(m)===sf55cMoveId(host.finished[0].raw)));
assert(host.finished.filter(e=>Number.isFinite(e.score)).every(e=>e.exact));
const stale=position({h8:-6,f7:5,f6:6},-1);assert.strictEqual(sf55cQ(stale,context(),-10000,-5000,1,5),0);
const mate=position({h8:-6,g7:5,f6:6},-1,100);assert.strictEqual(sf55cQ(mate,context(),-SF55C.mate,SF55C.mate,1,5),-SF55C.mate+1);
assert.strictEqual(sf55cSearch(mate,context(),3,-SF55C.mate,SF55C.mate,1),-SF55C.mate+1);
const fifty=position({h8:-6,a1:4,e1:6},1,100);assert.strictEqual(sf55cQ(fifty,context(),-SF55C.mate,SF55C.mate,1,5),0);
const repeat=position({h8:-6,a1:4,e1:6},1,8);repeat.positionCounts.set(repeat.fastPositionKey(),2);assert.strictEqual(sf55cQ(repeat,context(),-SF55C.mate,SF55C.mate,1,5),0);
const material=position({h8:-6,a1:3,e1:6});assert.strictEqual(sf55cQ(material,context(),-SF55C.mate,SF55C.mate,1,5),0);
const win=position({h8:-6,g6:5,f6:6});const winning=sf55cHost(win).finished[0];win.fastApply(winning.raw);assert(win.in_checkmate());win.fastUndo();
const originalEvaluate=sf55cEvaluate;sf55cEvaluate=()=>{throw new Error('injected failure');};assert.throws(()=>sf55cHost(game),/injected failure/);sf55cEvaluate=originalEvaluate;assert.strictEqual(snap(game),before);
// Search history must retain the first cycle even when it is too early for a
// third occurrence. A second speculative knight cycle is a repetition draw.
const cycleGame=new Chess(),cycleContext=context(),cycleBefore=snap(cycleGame),cycleKeys=[];
for(let ply=0;ply<8;ply++){
  const uci=['g1f3','g8f6','f3g1','f6g8'][ply%4];
  const move=cycleGame.fastMoves().find(m=>stonefishV45RawUci(cycleGame,m)===uci);
  assert(move);cycleGame.fastApply(move);
  const key=sf55cPositionKey(cycleGame);cycleKeys.push(key);
  assert.strictEqual(key,stonefishRuntimeBasePositionKey.call(cycleGame));
  assert.strictEqual(!!sf55cDraw(cycleGame,cycleContext,key),ply===7);
  sf55cEnter(cycleContext,key);
}
for(let ply=7;ply>=0;ply--){sf55cExit(cycleContext,cycleKeys[ply]);cycleGame.fastUndo();}
assert.strictEqual(snap(cycleGame),cycleBefore);assert.strictEqual(cycleContext.path.size,0);
let randomState = 991;
let positions = 0;
const moveKey = move => [move.from, move.to, move.piece, move.captured, move.promotion, move.flags].join(':');
for (let line = 0; line < 20; line++) {
  const varied = new Chess();
  for (let ply = 0; ply < 50; ply++) {
    const legal = varied.fastMoves();
    assert.strictEqual(sf55cPositionKey(varied), stonefishRuntimeBasePositionKey.call(varied));
    assert.deepStrictEqual(sf55cTacticalMoves(varied).map(moveKey), legal.filter(move => move.captured || move.promotion).map(moveKey));
    assert.strictEqual(sf55cInsufficient(varied), varied._insufficientMaterial());
    positions++;
    if (!legal.length) break;
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    varied._applyRaw(legal[randomState % legal.length], true);
  }
}
for (const varied of [position({a7:1,b8:-4,e1:6,h8:-6}), position({e5:1,d5:-1,e1:6,h8:-6})]) {
  if (varied.boardState[varied._sq('e5')]) varied.ep = varied._sq('d6');
  assert.deepStrictEqual(sf55cTacticalMoves(varied).map(moveKey), varied.fastMoves().filter(move => move.captured || move.promotion).map(moveKey));
}
console.log(JSON.stringify({ok:true,startDepth:host.depth,startNodes:host.nodes,exactRoots:host.finished.filter(e=>e.exact).length,checks:8,captureParityPositions:positions+2}));
