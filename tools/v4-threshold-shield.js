const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function endgame\(g,s\)\{return nonPawnMaterial\(g,s\)<=10;\}/,"function endgame(g,s){return nonPawnMaterial(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?development\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?development(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function chooseV4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function chooseV4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const front=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck'];
const tails={
 base:['mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 shieldA:['mobility','kingPawnShield','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 shieldB:['mobility','kingProtection','kingPawnShield','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 shieldC:['mobility','kingProtection','pieceSupport','kingPawnShield','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 earlyShield:['kingPawnShield','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']
};
const tail=String.raw`const C=[];let id=0;const front=${JSON.stringify(front)},tails=${JSON.stringify(tails)};for(const [layout,rest] of Object.entries(tails))for(const d of [6,8,10])for(const q of [12,14,16])for(const e of [8,10,12,14])C.push({name:'s'+id++,layout,developUntil:d,queenUntil:q,endgameMaterial:e,order:[...front,...rest]});
console.log('THRESHOLD SHIELD SCREEN',C.length,'x 12');const s=C.map(cfg=>({cfg,r:test(cfg,12,93000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('THRESHOLD SHIELD CONFIRM top 14 x 50');const c=s.slice(0,14).map(x=>({cfg:x.cfg,r:test(x.cfg,50,96000)})).sort(rank);for(const x of c)console.log(x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('THRESHOLD SHIELD FINAL top 6 x 100');const f=c.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,100000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:10};\\n'+harness)();");
eval(source);
