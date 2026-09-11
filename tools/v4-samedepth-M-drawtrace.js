const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const cfg={name:'M',order:M};
function drawReason(g){if(g.halfmove>=100)return'fifty';if(g._insufficientMaterial())return'insufficient';if((g.positionCounts.get(g.fastPositionKey())||0)>=3)return'repetition';return null;}
function playReason(cfg,n,max=1000){const g=new Chess(),vw=(n&1)===0,r3=seeded(0x9e3779b9^(n*0x45d9f3b)),r4=seeded(0x85ebca6b^(n*0x27d4eb2d));for(let p=0;p<max;p++){const vt=(g.turn()==='w')===vw,m=vt?choose4(g,r4,cfg):choose3(g,r3);if(!m){if(!g.in_check())return{result:'D',reason:'stalemate',plies:p,fen:g.fen()};const ww=g.turn()==='b';return{result:ww===vw?'W':'L',reason:'mate',plies:p,fen:g.fen()};}g._applyRaw(m,true);const dr=drawReason(g);if(dr)return{result:'D',reason:dr,plies:p+1,fen:g.fen()};}return{result:'D',reason:'timeout',plies:max,fen:g.fen()};}
const totals={W:0,L:0,D:0},reasons={};for(let i=0;i<100;i++){const seed=90000+i,r=playReason(cfg,seed);totals[r.result]++;if(r.result==='D'){reasons[r.reason]=(reasons[r.reason]||0)+1;console.log('DRAW',seed,r.reason,r.plies,r.fen);}else if(r.result==='L')console.log('LOSS',seed,r.plies,r.fen);}
console.log('M TRACE TOTAL',totals);console.log('DRAW REASONS',reasons);
`;
src=src.slice(0,start)+tail+src.slice(end);
eval(src);
