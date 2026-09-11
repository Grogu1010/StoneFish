const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side,visits=g.positionCounts.get(g.fastPositionKey())||0,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function fiftyByLead(g,m,clockMin,leadMin){if(g.halfmove<clockMin)return 0;g.fastApply(m);const s=-g.side,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function feature(g,m,c){if(c==='rep2Lead2_5')return repByLead(g,m,1,2.5);if(c.startsWith('fiftyLead@')){const a=c.split('@');return fiftyByLead(g,m,Number(a[1]),Number(a[2]));}`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,order){C.push({name,order});}
add('control',M.slice());
for(const clock of[60,70]){
  // proven repetition priority: directly after promotion.
  let a=M.slice();a.splice(1,0,'rep2Lead2_5');const h=a.indexOf('hangingMax');a.splice(h+1,0,'fiftyLead@'+clock+'@2.5');add('repEarly_fAfterHang_'+clock,a);
  let b=M.slice();b.splice(1,0,'rep2Lead2_5','fiftyLead@'+clock+'@2.5');add('repEarly_fEarly_'+clock,b);
  let c=M.slice();c.splice(1,0,'rep2Lead2_5');const mob=c.indexOf('mobility');c.splice(mob,0,'fiftyLead@'+clock+'@2.5');add('repEarly_fBeforeMob_'+clock,c);
  // Slightly less aggressive rep placement for comparison.
  let d=M.slice();d.splice(2,0,'rep2Lead2_5');const dh=d.indexOf('hangingMax');d.splice(dh+1,0,'fiftyLead@'+clock+'@2.5');add('repP2_fAfterHang_'+clock,d);
}
const starts=[90000,740000,820000,860000];
function aggregate(cfg){let W=0,L=0,D=0,blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('REP PRIORITY + FIFTY',C.length,'variants x 4 blocks');
const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);
for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:x.r.games,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}
console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:out[0].r.games,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
