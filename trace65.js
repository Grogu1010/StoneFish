const fs=require('fs'), path=require('path'), vm=require('vm');
global.window=global; global.addEventListener=()=>{}; global.document={}; global.performance={now:()=>Date.now()};
for (const file of ['chess.js','stonefishv1.js','stonefishv2.js','stonefishv3.js','stonefishv3.1.js','stonefishv4.js','openings.js','stonefishv4.5flash.js','stonefishv4.5.js','stonefishv5flash.js','stonefishv5.js','stonefishv6flash.js','stonefishv6.js','stonefishv6.5flash.js','stonefishv6.5.js']) vm.runInThisContext(fs.readFileSync(path.join(__dirname,file),'utf8'),{filename:file});
const engines={v5:StonefishV5,v6f:StonefishV6Flash,v6:StonefishV6,v65f:StonefishV65Flash,v65:StonefishV65};
function legal(sim,m){return sim.getAllLegalMoves(sim.state.turn).some(x=>x.from.r===m.from.r&&x.from.c===m.from.c&&x.to.r===m.to.r&&x.to.c===m.to.c)}
function material(sim,state,color){const V={P:1,N:3.2,B:3.3,R:5,Q:9,K:0}; let s=0; for(let r=0;r<8;r++) for(let c=0;c<8;c++){const p=state.board[r][c]; if(p) s+=(sim.colorOf(p)===color?1:-1)*V[sim.typeOf(p)];} return s;}
function board(sim){return sim.state.board.map(row=>row.map(p=>p||'..').join(' ')).join('\n')}
const white=engines[process.argv[2]], black=engines[process.argv[3]]; const sim=new ChessGame();
for(let ply=0;ply<240;ply++){
 const status=sim.getStatus(sim.state); if(status.over){console.log('OVER',ply,status);break;}
 const e=sim.state.turn==='w'?white:black; const side=sim.state.turn; const t=Date.now(); let m=e.chooseMove(sim,side); const ms=Date.now()-t; const legalMoves=sim.getAllLegalMoves(side); if(!m||!legal(sim,m)) { console.log('INVALID', side, m); m=legalMoves[0]; }
 const from=sim.squareName(m.from.r,m.from.c), to=sim.squareName(m.to.r,m.to.c); const cap=sim.state.board[m.to.r][m.to.c];
 console.log(`${ply+1}. ${side} ${e.name} ${from}-${to}${m._stonefishOpeningName?' ['+m._stonefishOpeningName+']':''} cap=${cap||''} ms=${ms} matW=${material(sim,sim.state,'w').toFixed(1)}`);
 sim.applyMoveToState(sim.state,m); sim.moveHistory.push({from,to,color:side,label:e.name});
 const reps=new Map(); const key=sim.state.board.map(row=>row.map(p=>p||'..').join('')).join('/')+'|'+sim.state.turn;
}
console.log(board(sim)); console.log('matW',material(sim,sim.state,'w'));
