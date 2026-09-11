const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){","function feature(g,m,c){if(c==='captureNow')return V[m.captured]||0;");
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];const base=${JSON.stringify(base)};function add(name,pos,e){const o=base.slice();o.splice(pos,0,'captureNow');C.push({name,order:o,developUntil:8,queenUntil:14,endgameMaterial:e});}
for(const e of[10,14]){add('cap3e'+e,3,e);add('cap4e'+e,4,e);add('cap5e'+e,5,e);add('cap9e'+e,9,e);}C.push({name:'base14',order:base.slice(),developUntil:8,queenUntil:14,endgameMaterial:14});
console.log('CAPTURE SCREEN',C.length,'x 20');const s=C.map(c=>({cfg:c,r:test(c,20,241000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('CAPTURE CONFIRM top 5 x 60');const c=s.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,60,244000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('CAPTURE FINAL top 3 x 100');const f=c.slice(0,3).map(x=>({cfg:x.cfg,r:test(x.cfg,100,250000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
