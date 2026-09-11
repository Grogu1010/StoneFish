const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
src=src.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
src=src.replace("function feature(g,m,c){",String.raw`
function matSide(g,s){let z=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(p&&(p>0?1:-1)===s)z+=V[Math.abs(p)]||0;}return z;}
function boardMaterial(g){let z=0;for(let q=0;q<64;q++)z+=V[Math.abs(g.boardState[q])]||0;return z;}
function queenCount(g){let z=0;for(let q=0;q<64;q++)if(Math.abs(g.boardState[q])===5)z++;return z;}
function simplifyScore(g,m,lim,mode){const s=g.side,diff=matSide(g,s)-matSide(g,-s);g.fastApply(m);let t=mode==='queens'?queenCount(g):boardMaterial(g);g.fastUndo();if(diff>=lim)return-t;if(diff<=-lim)return t;return 0;}
function feature(g,m,c){if(c.startsWith('simplify@'))return simplifyScore(g,m,+c.split('@')[1],'material');if(c.startsWith('queenSimplify@'))return simplifyScore(g,m,+c.split('@')[1],'queens');`);
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();", "function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];C.push({name:'control',order:base.slice(),developUntil:8,queenUntil:14,endgameMaterial:14});for(const feat of['simplify','queenSimplify'])for(const lim of[1,2,3,5])for(const pos of[5,7,9,10,11]){const o=base.slice();o.splice(pos,0,feat+'@'+lim);C.push({name:feat+lim+'p'+pos,order:o,developUntil:8,queenUntil:14,endgameMaterial:14});}
console.log('SAMEDEPTH SIMPLIFY SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,680000)})).sort(rank);for(const x of s.slice(0,18))console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH SIMPLIFY CONFIRM top 10 x 50');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,50,685000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH SIMPLIFY FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,695000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(src);
