const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`const FOUR_CACHE=new Map();
function fourPlyScore(g,root){
  const key=g.fastPositionKey()+':'+root.from+','+root.to+','+(root.promotion||0);if(FOUR_CACHE.has(key))return FOUR_CACHE.get(key);
  const M=1000000, immediate=V[root.captured]||0;g.fastApply(root);const replies=g.fastMoves();
  if(!replies.length){const z=g.in_check()?M:immediate;g.fastUndo();FOUR_CACHE.set(key,z);return z;}let worst=Infinity;
  for(const reply of replies){const oppGain=V[reply.captured]||0;g.fastApply(reply);const responses=g.fastMoves();if(!responses.length&&g.in_check()){g.fastUndo();worst=-M;break;}let best=-Infinity;
    for(const response of responses){const ourGain=V[response.captured]||0;g.fastApply(response);const fourth=g.fastMoves();let score;if(!fourth.length&&g.in_check())score=M;else{let fourthGain=0,fourthMate=false;for(const fm of fourth){const cap=V[fm.captured]||0;if(cap>fourthGain)fourthGain=cap;if(!fourthMate&&g.fastGivesCheck(fm)){g.fastApply(fm);if(g.fastMoves().length===0&&g.in_check())fourthMate=true;g.fastUndo();}}score=fourthMate?-M:(immediate-oppGain+ourGain-fourthGain);}g.fastUndo();if(score>best)best=score;if(best===M)break;}g.fastUndo();if(best<worst)worst=best;if(worst===-M)break;}
  g.fastUndo();if(FOUR_CACHE.size>100000)FOUR_CACHE.clear();FOUR_CACHE.set(key,worst);return worst;}
function feature(g,m,c){if(c==='fourPly')return fourPlyScore(g,m);`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];const base=${JSON.stringify(base)};for(const e of[8,10,12,14])for(const fp of[5,8,9])for(const cm of['none','afterFour']){const o=base.slice();o.splice(fp,0,'fourPly');if(cm==='afterFour')o.splice(o.indexOf('fourPly')+1,0,'check');C.push({name:'e'+e+'p'+fp+'c'+cm,order:o,developUntil:8,queenUntil:14,endgameMaterial:e});}
console.log('FOURPLY COMBO SCREEN',C.length,'x 6');const s=C.map(c=>({cfg:c,r:test(c,6,260000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.r);
console.log('FOURPLY COMBO CONFIRM top 8 x 24');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,24,263000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('FOURPLY COMBO FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,268000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
