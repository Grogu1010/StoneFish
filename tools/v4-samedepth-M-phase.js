const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY: v3 still supplies the candidate pool. This script only changes
// v4's lexicographic order and phase thresholds.
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();", "function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
// M order: this exact same-depth family previously hit 70W/5L/25D.
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];
for(const d of[8,10,12,13,14,16])for(const q of[6,8,10,12,14])for(const e of[6,8,10,12,14])C.push({name:'d'+d+'q'+q+'e'+e,order:M.slice(),developUntil:d,queenUntil:q,endgameMaterial:e});
console.log('SAMEDEPTH M-PHASE SCREEN',C.length,'x 10');
const s=C.map(cfg=>({cfg,r:test(cfg,10,720000)})).sort(rank);for(const x of s.slice(0,25))console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH M-PHASE CONFIRM top 12 x 40');
const c=s.slice(0,12).map(x=>({cfg:x.cfg,r:test(x.cfg,40,725000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH M-PHASE FINAL top 6 x 100');
const f=c.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,735000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:13,queenUntil:10,endgameMaterial:10};\\n'+harness)();");
eval(src);
