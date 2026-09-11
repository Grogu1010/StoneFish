const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=8?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=14");
const old="function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;for(const c of cfg.order){if(a.length<=1)break;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);}return a[Math.floor(r()*a.length)];}";
const neu="function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;const order=npm(g,g.side)<=cfg.endgameMaterial?cfg.endOrder:(g.fullmove<=8?cfg.openOrder:cfg.midOrder);for(const c of order){if(a.length<=1)break;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);}return a[Math.floor(r()*a.length)];}";
source=source.replace(old,neu);
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const O=[
['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
['promotion','hangingMax','castleNow','openingDevelop','queenDiscipline','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
['promotion','castleNow','hangingMax','openingDevelop','queenDiscipline','mobility','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl']
];
const M=[
['promotion','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'],
['promotion','hangingMax','queenDiscipline','mobility','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl','repetitionAvoid','fiftyReset'],
['promotion','hangingMax','mobility','kingProtection','pieceSupport','queenDiscipline','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl','repetitionAvoid','fiftyReset']
];
const E=[
['promotion','hangingMax','endgamePawnProgress','endgameCheck','mobility','kingPlacement','kingFreedom','pawnStructure','rookActivity','pieceSupport','center','minorCentral','boardControl'],
['promotion','hangingMax','endgamePawnProgress','kingPlacement','mobility','kingFreedom','pawnStructure','rookActivity','pieceSupport','endgameCheck','center','minorCentral','boardControl'],
['promotion','hangingMax','kingPlacement','endgamePawnProgress','mobility','kingFreedom','pawnStructure','rookActivity','pieceSupport','endgameCheck','center','minorCentral','boardControl']
];
const tail=String.raw`const C=[];let id=0;const O=${JSON.stringify(O)},M=${JSON.stringify(M)},E=${JSON.stringify(E)};for(let o=0;o<O.length;o++)for(let m=0;m<M.length;m++)for(let e=0;e<E.length;e++)for(const em of[10,12,14])C.push({name:'p'+id++,o,m,e,endgameMaterial:em,openOrder:O[o],midOrder:M[m],endOrder:E[e]});
console.log('PHASE ORDER SCREEN',C.length,'x 12');const s=C.map(cfg=>({cfg,r:test(cfg,12,114000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,{o:x.cfg.o,m:x.cfg.m,e:x.cfg.e,em:x.cfg.endgameMaterial},x.r);
console.log('PHASE ORDER CONFIRM top 14 x 50');const c=s.slice(0,14).map(x=>({cfg:x.cfg,r:test(x.cfg,50,117000)})).sort(rank);for(const x of c)console.log(x.cfg.name,{o:x.cfg.o,m:x.cfg.m,e:x.cfg.e,em:x.cfg.endgameMaterial},x.r);
console.log('PHASE ORDER FINAL top 6 x 100');const f=c.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,121000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,{o:x.cfg.o,m:x.cfg.m,e:x.cfg.e,em:x.cfg.endgameMaterial},x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={endgameMaterial:10};\\n'+harness)();");
eval(source);
