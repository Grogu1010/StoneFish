const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
src=src.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
src=src.replace("function feature(g,m,c){",String.raw`
function repeatTempo(g,m,lim){
  if(g.fullmove>lim)return 0;const h=g.historyStack;if(h.length<2)return 1;const prev=h[h.length-2];
  if(!prev||prev.side!==g.side||prev.move.to!==m.from)return 1;
  if(m.captured||(m.flags&12)||g.fastGivesCheck(m))return 1;return 0;
}
function freshMinor(g,m,lim){
  if(g.fullmove>lim)return 0;const s=g.side,b=g.boardState,p=Math.abs(b[m.from]);
  const nh=s===1?[1,6]:[57,62],bh=s===1?[2,5]:[58,61];
  let undeveloped=0;if(b[nh[0]]===s*2)undeveloped++;if(b[nh[1]]===s*2)undeveloped++;if(b[bh[0]]===s*3)undeveloped++;if(b[bh[1]]===s*3)undeveloped++;
  if(!undeveloped)return 0;
  if(p===2)return nh.includes(m.from)?2:0;if(p===3)return bh.includes(m.from)?2:0;return 1;
}
function majorDiscipline(g,m,lim){
  if(g.fullmove>lim)return 0;const p=Math.abs(g.boardState[m.from]);
  if((m.flags&12)||m.captured||g.fastGivesCheck(m))return 1;
  return(p===4||p===6)?0:1;
}
function feature(g,m,c){if(c.startsWith('repeatTempo@'))return repeatTempo(g,m,+c.split('@')[1]);if(c.startsWith('freshMinor@'))return freshMinor(g,m,+c.split('@')[1]);if(c.startsWith('majorDiscipline@'))return majorDiscipline(g,m,+c.split('@')[1]);`);
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();", "function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function mk(name,items,d=8,q=14,e=14){const o=base.slice();for(const [pos,feat] of items)o.splice(pos,0,feat);C.push({name,order:o,developUntil:d,queenUntil:q,endgameMaterial:e});}
C.push({name:'control',order:base.slice(),developUntil:8,queenUntil:14,endgameMaterial:14});
for(const lim of[6,8,10,12,14])for(const pos of[3,4,5])mk('fresh'+lim+'p'+pos,[[pos,'freshMinor@'+lim]]);
for(const lim of[6,8,10,12,14])for(const pos of[4,5,9])mk('major'+lim+'p'+pos,[[pos,'majorDiscipline@'+lim]]);
for(const lim of[8,10,12])mk('freshRepeat'+lim,[[4,'freshMinor@'+lim],[5,'repeatTempo@'+lim]]);
for(const lim of[8,10,12])mk('freshMajor'+lim,[[4,'freshMinor@'+lim],[5,'majorDiscipline@'+lim]]);
for(const lim of[8,10,12])mk('all'+lim,[[4,'freshMinor@'+lim],[5,'majorDiscipline@'+lim],[6,'repeatTempo@'+lim]]);
console.log('SAMEDEPTH OPENING SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,400000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH OPENING CONFIRM top 10 x 50');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,50,405000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH OPENING FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,415000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(src);
