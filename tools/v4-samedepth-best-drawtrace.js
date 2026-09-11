const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side,visits=g.positionCounts.get(g.fastPositionKey())||0,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function cycleProgress(g,m,leadMin){const visits=g.positionCounts.get(g.fastPositionKey())||0;if(visits<2)return 0;const s=g.side,lead=npm(g,s)-npm(g,-s);if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function feature(g,m,c){if(c==='rep2Lead2_5')return repByLead(g,m,1,2.5);if(c==='cycleProgress2_5')return cycleProgress(g,m,2.5);`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const cfg={name:'best',order:['promotion','rep2Lead2_5','castleNow','openingDevelop','hangingMax','cycleProgress2_5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl']};
function reason(g){if(g.halfmove>=100)return'fifty';if(g._insufficientMaterial())return'insufficient';if((g.positionCounts.get(g.fastPositionKey())||0)>=3)return'repetition';return null;}
function playReason(n,max=1000){const g=new Chess(),vw=(n&1)===0,vs=vw?1:-1,r3=seeded(0x9e3779b9^(n*0x45d9f3b)),r4=seeded(0x85ebca6b^(n*0x27d4eb2d));for(let p=0;p<max;p++){const vt=(g.turn()==='w')===vw,m=vt?choose4(g,r4,cfg):choose3(g,r3);if(!m){if(!g.in_check())return{result:'D',reason:'stalemate',lead:npm(g,vs)-npm(g,-vs),plies:p,fen:g.fen()};const ww=g.turn()==='b';return{result:ww===vw?'W':'L',reason:'mate',lead:npm(g,vs)-npm(g,-vs),plies:p,fen:g.fen()};}g._applyRaw(m,true);const dr=reason(g);if(dr)return{result:'D',reason:dr,lead:npm(g,vs)-npm(g,-vs),plies:p+1,fen:g.fen()};}return{result:'D',reason:'timeout',lead:npm(g,vs)-npm(g,-vs),plies:max,fen:g.fen()};}
let W=0,L=0,D=0;const reasons={};for(let i=0;i<100;i++){const seed=90000+i,r=playReason(seed);if(r.result==='W')W++;else if(r.result==='L')L++;else{D++;reasons[r.reason]=(reasons[r.reason]||0)+1;console.log('DRAW',seed,r.reason,'lead',r.lead.toFixed(1),'plies',r.plies,r.fen);}}console.log('TOTAL',{W,L,D});console.log('REASONS',reasons);
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
