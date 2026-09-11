const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
src=src.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
src=src.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c==='openingDevelop')z=g.fullmove<=ACTIVE.developUntil?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){", "else if(c==='queenDiscipline'){if(g.fullmove<=ACTIVE.queenUntil){");
src=src.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;for(const c of cfg.order){if(a.length<=1)break;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);}return a[Math.floor(r()*a.length)];}",String.raw`function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;for(const c of cfg.order){if(a.length<=1)break;if(c.startsWith('mobilityMargin@')){const margin=+c.split('@')[1],S=[],bestObj={v:-Infinity};for(let i=0;i<a.length;i++){const s=feature(g,a[i],'mobility');S[i]=s;if(s>bestObj.v)bestObj.v=s;}a=a.filter((_,i)=>S[i]>=bestObj.v-margin);continue;}let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);}return a[Math.floor(r()*a.length)];}`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];for(const m of[0,0.5,1,1.5,2,3,4,5,6,8,10,12])C.push({name:'m'+m,order:base.map(x=>x==='mobility'?'mobilityMargin@'+m:x),developUntil:8,queenUntil:14,endgameMaterial:14});
console.log('SAMEDEPTH MOBILITY MARGIN SCREEN',C.length,'x 30');const s=C.map(cfg=>({cfg,r:test(cfg,30,520000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH MOBILITY MARGIN CONFIRM top 7 x 60');const c=s.slice(0,7).map(x=>({cfg:x.cfg,r:test(x.cfg,60,525000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('SAMEDEPTH MOBILITY MARGIN FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,535000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r,JSON.stringify(x.cfg));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);
src=src.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(src);
