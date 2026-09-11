const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side,visits=g.positionCounts.get(g.fastPositionKey())||0,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function cycleProgress(g,m,leadMin){const visits=g.positionCounts.get(g.fastPositionKey())||0;if(visits<2)return 0;const s=g.side,lead=npm(g,s)-npm(g,-s);if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function fiftyByLead(g,m,clockMin,leadMin){if(g.halfmove<clockMin)return 0;g.fastApply(m);const s=-g.side,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function feature(g,m,c){if(c==='rep2Lead2_5')return repByLead(g,m,1,2.5);if(c==='cycleProgress2_5')return cycleProgress(g,m,2.5);if(c==='fiftyLead60')return fiftyByLead(g,m,60,2.5);`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,o){C.push({name,order:o});}
add('control',M.slice());
function earlyRep(){let o=M.slice();o.splice(1,0,'rep2Lead2_5');return o;}
// early repetition guard + combinations around the proven hangingMax/mobility boundary.
let a=earlyRep(),h=a.indexOf('hangingMax');a.splice(h+1,0,'cycleProgress2_5','fiftyLead60');add('earlyRep_progress_fifty',a);
let b=earlyRep();h=b.indexOf('hangingMax');b.splice(h+1,0,'fiftyLead60','cycleProgress2_5');add('earlyRep_fifty_progress',b);
let c=earlyRep();c.splice(2,0,'cycleProgress2_5');h=c.indexOf('hangingMax');c.splice(h+1,0,'fiftyLead60');add('earlyRep_earlyProgress_fifty',c);
let d=earlyRep();h=d.indexOf('hangingMax');d.splice(h+1,0,'cycleProgress2_5');add('earlyRep_progress',d);
let e=earlyRep();h=e.indexOf('hangingMax');e.splice(h+1,0,'fiftyLead60');add('earlyRep_fifty',e);
// Keep the previous best placements as controls.
let f=M.slice();h=f.indexOf('hangingMax');f.splice(h+1,0,'cycleProgress2_5','rep2Lead2_5');add('late_progress_rep',f);
let g=M.slice();h=g.indexOf('hangingMax');g.splice(h+1,0,'rep2Lead2_5','fiftyLead60');add('late_rep_fifty',g);
const starts=[90000,740000,820000,860000];
function aggregate(cfg){let W=0,L=0,D=0,blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('CONVERSION STACK',C.length,'variants x 4 blocks');
const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);
for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:x.r.games,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}
console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:out[0].r.games,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
