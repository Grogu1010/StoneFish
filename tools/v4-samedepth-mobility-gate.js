const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
src=src.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
src=src.replace("function feature(g,m,c){",String.raw`
function homeMinors(g,s){const b=g.boardState,nh=s===1?[1,6]:[57,62],bh=s===1?[2,5]:[58,61];let n=0;if(b[nh[0]]===s*2)n++;if(b[nh[1]]===s*2)n++;if(b[bh[0]]===s*3)n++;if(b[bh[1]]===s*3)n++;return n;}
function feature(g,m,c){if(c.startsWith('mobilityAfter@')){const lim=+c.split('@')[1],active=g.fullmove>lim;g.fastApply(m);const s=-g.side,z=active?g.fastMobility(s):0;g.fastUndo();return z;}if(c==='mobilityAfterMinors'){g.fastApply(m);const s=-g.side,z=homeMinors(g,s)?0:g.fastMobility(s);g.fastUndo();return z;}`);
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();", "function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function repl(name,to,d=8,q=14,e=14){C.push({name,order:base.map(x=>x==='mobility'?to:x),developUntil:d,queenUntil:q,endgameMaterial:e});}
C.push({name:'control',order:base.slice(),developUntil:8,queenUntil:14,endgameMaterial:14});
for(const n of[2,3,4,5,6,8,10,12,14])repl('after'+n,'mobilityAfter@'+n);
repl('afterMinors','mobilityAfterMinors');
console.log('SAMEDEPTH MOBILITY GATE SCREEN',C.length,'x 30');const s=C.map(cfg=>({cfg,r:test(cfg,30,440000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH MOBILITY GATE CONFIRM top 6 x 60');const c=s.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,60,445000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH MOBILITY GATE FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,455000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(src);
