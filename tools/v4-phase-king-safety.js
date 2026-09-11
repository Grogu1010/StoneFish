const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("else if(c==='kingProtection')z=kprot(g,s);","else if(c==='kingProtection')z=kprot(g,s);else if(c==='kingProtectionMG')z=eg(g,s)?0:kprot(g,s);else if(c==='kingFreedomEG')z=eg(g,s)?kfree(g,s):0;");
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const front=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility'];
const layouts={
 normal:['kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 mg:['kingProtectionMG','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 mgEgFree:['kingProtectionMG','pieceSupport','kingFreedomEG','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 supportMg:['pieceSupport','kingProtectionMG','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 mgFreedom:['kingProtectionMG','kingFreedom','pieceSupport','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']
};
const tail=String.raw`const C=[];let id=0;const front=${JSON.stringify(front)},layouts=${JSON.stringify(layouts)};for(const [layout,rest] of Object.entries(layouts))for(const d of [7,8,9])for(const q of [13,14,15])for(const e of [9,10,12,14,16])C.push({name:'p'+id++,layout,developUntil:d,queenUntil:q,endgameMaterial:e,order:[...front,...rest]});
console.log('PHASE KING SAFETY SCREEN',C.length,'x 12');const s=C.map(cfg=>({cfg,r:test(cfg,12,103000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('PHASE KING SAFETY CONFIRM top 14 x 50');const c=s.slice(0,14).map(x=>({cfg:x.cfg,r:test(x.cfg,50,106000)})).sort(rank);for(const x of c)console.log(x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('PHASE KING SAFETY FINAL top 6 x 100');const f=c.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,110000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:10};\\n'+harness)();");
eval(source);
