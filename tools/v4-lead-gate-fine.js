const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`const FOUR_CACHE=new Map();
function matDiff(g,s){let z=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(!p||Math.abs(p)===6)continue;const v=V[Math.abs(p)]||0;z+=(p>0?1:-1)===s?v:-v;}return z;}
function fourPlyScore(g,root){const key=g.fastPositionKey()+':'+root.from+','+root.to+','+(root.promotion||0);if(FOUR_CACHE.has(key))return FOUR_CACHE.get(key);const M=1000000,immediate=V[root.captured]||0;g.fastApply(root);const replies=g.fastMoves();if(!replies.length){const z=g.in_check()?M:immediate;g.fastUndo();FOUR_CACHE.set(key,z);return z;}let worst=Infinity;for(const reply of replies){const oppGain=V[reply.captured]||0;g.fastApply(reply);const responses=g.fastMoves();if(!responses.length&&g.in_check()){g.fastUndo();worst=-M;break;}let best=-Infinity;for(const response of responses){const ourGain=V[response.captured]||0;g.fastApply(response);const fourth=g.fastMoves();let score;if(!fourth.length&&g.in_check())score=M;else{let fourthGain=0,fourthMate=false;for(const fm of fourth){const cap=V[fm.captured]||0;if(cap>fourthGain)fourthGain=cap;if(!fourthMate&&g.fastGivesCheck(fm)){g.fastApply(fm);if(g.fastMoves().length===0&&g.in_check())fourthMate=true;g.fastUndo();}}score=fourthMate?-M:(immediate-oppGain+ourGain-fourthGain);}g.fastUndo();if(score>best)best=score;if(best===M)break;}g.fastUndo();if(best<worst)worst=best;if(worst===-M)break;}g.fastUndo();if(FOUR_CACHE.size>120000)FOUR_CACHE.clear();FOUR_CACHE.set(key,worst);return worst;}
function feature(g,m,c){if(c.startsWith('fourPlyLead:')){const t=+c.split(':')[1];return matDiff(g,g.side)>t?0:fourPlyScore(g,m);}`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];const base=${JSON.stringify(base)};for(const t of[1.5,1.75,2,2.25,2.5,2.75,3,3.1,3.5,4]){const o=base.slice();o.splice(5,0,'fourPlyLead:'+t);C.push({name:'lead'+t,order:o,developUntil:8,queenUntil:14,endgameMaterial:14});}
console.log('LEAD GATE FINE SCREEN',C.length,'x 16');const s=C.map(c=>({cfg:c,r:test(c,16,321000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('LEAD GATE FINE CONFIRM top 6 x 50');const c=s.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,50,325000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('LEAD GATE FINE FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,332000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
