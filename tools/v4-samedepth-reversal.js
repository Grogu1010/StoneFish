const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
src=src.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
src=src.replace("function feature(g,m,c){",String.raw`
function noReverse(g,m,lim){
  if(lim<999&&g.fullmove>lim)return 0;const h=g.historyStack;if(h.length<2)return 1;const prev=h[h.length-2];
  if(!prev||prev.side!==g.side)return 1;
  const reverse=m.from===prev.move.to&&m.to===prev.move.from;
  if(!reverse||m.captured||(m.flags&12)||g.fastGivesCheck(m))return 1;return 0;
}
function feature(g,m,c){if(c.startsWith('noReverse@'))return noReverse(g,m,+c.split('@')[1]);`);
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();", "function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];C.push({name:'control',order:base.slice(),developUntil:8,queenUntil:14,endgameMaterial:14});for(const lim of[6,8,10,12,16,24,40,999])for(const pos of[3,4,5,9,10]){const o=base.slice();o.splice(pos,0,'noReverse@'+lim);C.push({name:'r'+lim+'p'+pos,order:o,developUntil:8,queenUntil:14,endgameMaterial:14});}
console.log('SAMEDEPTH REVERSAL SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,600000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH REVERSAL CONFIRM top 10 x 50');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,50,605000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH REVERSAL FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,615000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(src);
