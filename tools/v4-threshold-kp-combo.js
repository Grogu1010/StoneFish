const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const prefix=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck'];
const layouts={
 kp10:['mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 kp11:['mobility','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 kp9:['kingProtection','mobility','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
 kp10kf:['mobility','kingProtection','kingFreedom','pieceSupport','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']
};
const tail=String.raw`const C=[];let id=0;const prefix=${JSON.stringify(prefix)},layouts=${JSON.stringify(layouts)};for(const [layout,rest] of Object.entries(layouts))for(const d of [6,8,10])for(const q of [12,14,16])for(const e of [8,10,12,14])C.push({name:'c'+id++,layout,developUntil:d,queenUntil:q,endgameMaterial:e,order:[...prefix,...rest]});
console.log('THRESHOLD+KP SCREEN',C.length,'x 12');const s=C.map(cfg=>({cfg,r:test(cfg,12,83000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('THRESHOLD+KP CONFIRM top 14 x 50');const c=s.slice(0,14).map(x=>({cfg:x.cfg,r:test(x.cfg,50,86000)})).sort(rank);for(const x of c)console.log(x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);
console.log('THRESHOLD+KP FINAL top 6 x 100');const f=c.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,90000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,{l:x.cfg.layout,d:x.cfg.developUntil,q:x.cfg.queenUntil,e:x.cfg.endgameMaterial},x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:13,queenUntil:10,endgameMaterial:10};\\n'+harness)();");
eval(source);
