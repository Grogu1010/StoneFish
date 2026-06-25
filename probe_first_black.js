const fs=require('fs'), path=require('path'), vm=require('vm');
global.window=global; global.addEventListener=()=>{}; global.document={}; global.performance={now:()=>Date.now()};
for (const file of ['chess.js','stonefishv1.js','stonefishv2.js','stonefishv3.js','stonefishv3.1.js','stonefishv4.js','openings.js','stonefishv4.5flash.js','stonefishv4.5.js','stonefishv5flash.js','stonefishv5.js','stonefishv6flash.js','stonefishv6.js','stonefishv6.5flash.js','stonefishv6.5.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,file),'utf8'),{filename:file});
const W=StonefishV65Flash, B=StonefishV65;
function key(m,sim){return sim.squareName(m.from.r,m.from.c)+sim.squareName(m.to.r,m.to.c)}
function legal(sim,m){return sim.getAllLegalMoves(sim.state.turn).some(x=>x.from.r===m.from.r&&x.from.c===m.from.c&&x.to.r===m.to.r&&x.to.c===m.to.c)}
function material(sim,state,color){const V={P:1,N:3.2,B:3.3,R:5,Q:9,K:0}; let s=0; for(let r=0;r<8;r++) for(let c=0;c<8;c++){const p=state.board[r][c]; if(p) s+=(sim.colorOf(p)===color?1:-1)*V[sim.typeOf(p)];} return s;}
function simWith(forcedKey){const sim=new ChessGame(); let invalid=0; for(let ply=0; ply<160; ply++){const status=sim.getStatus(sim.state); if(status.over) return {winner:status.winner||'draw',plies:ply,reason:status.kind,matW:material(sim,sim.state,'w'),hist:sim.moveHistory.map(e=>e.from+e.to).join(' ')}; let m; if(ply===1){const legalMoves=sim.getAllLegalMoves('b'); m=legalMoves.find(x=>key(x,sim)===forcedKey); if(!m) return {invalidForce:forcedKey};} else { const e=sim.state.turn==='w'?W:B; m=e.chooseMove(sim,sim.state.turn); }
 const leg=sim.getAllLegalMoves(sim.state.turn); if(!m||!legal(sim,m)){m=leg[0]; invalid++;}
 const from=sim.squareName(m.from.r,m.from.c), to=sim.squareName(m.to.r,m.to.c); const side=sim.state.turn; sim.applyMoveToState(sim.state,m); sim.moveHistory.push({from,to,color:side}); }
 return {winner:'draw',plies:160,reason:'max',matW:material(sim,sim.state,'w'),hist:sim.moveHistory.map(e=>e.from+e.to).join(' ')};}
const base=new ChessGame(); const wm=W.chooseMove(base,'w'); base.applyMoveToState(base.state,wm); base.moveHistory.push({from:base.squareName(wm.from.r,wm.from.c),to:base.squareName(wm.to.r,wm.to.c),color:'w'});
console.log('white first', base.moveHistory[0]);
let rows=[]; for(const m of base.getAllLegalMoves('b')){const k=key(m,base); const r=simWith(k); rows.push({k,...r});}
rows.sort((a,b)=> (a.winner==='b'?0:a.winner==='draw'?1:2) - (b.winner==='b'?0:b.winner==='draw'?1:2) || a.plies-b.plies || a.matW-b.matW);
for(const r of rows.slice(0,40)) console.log(JSON.stringify(r));
