const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`function fourPlyScore(g,root){
  const M=1000000, immediate=V[root.captured]||0;g.fastApply(root);const replies=g.fastMoves();
  if(!replies.length){const z=g.in_check()?M:immediate;g.fastUndo();return z;}let worst=Infinity;
  for(const reply of replies){const oppGain=V[reply.captured]||0;g.fastApply(reply);const responses=g.fastMoves();if(!responses.length&&g.in_check()){g.fastUndo();if(-M<worst)worst=-M;continue;}let best=-Infinity;
    for(const response of responses){const ourGain=V[response.captured]||0;g.fastApply(response);const fourth=g.fastMoves();let score;if(!fourth.length&&g.in_check())score=M;else{let fourthGain=0,fourthMate=false;for(const fm of fourth){const cap=V[fm.captured]||0;if(cap>fourthGain)fourthGain=cap;if(!fourthMate&&g.fastGivesCheck(fm)){g.fastApply(fm);if(g.fastMoves().length===0&&g.in_check())fourthMate=true;g.fastUndo();}}score=fourthMate?-M:(immediate-oppGain+ourGain-fourthGain);}g.fastUndo();if(score>best)best=score;if(best===M)break;}
    g.fastUndo();if(best<worst)worst=best;if(worst===-M)break;}
  g.fastUndo();return worst;}
function feature(g,m,c){if(c==='fourPly')return fourPlyScore(g,m);`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const base=${JSON.stringify(base)};const fp=base.slice();fp.splice(5,0,'fourPly');const configs=[{name:'control_e14',order:base,developUntil:8,queenUntil:14,endgameMaterial:14},{name:'fourply_e14',order:fp,developUntil:8,queenUntil:14,endgameMaterial:14},{name:'fourply_e10',order:fp,developUntil:8,queenUntil:14,endgameMaterial:10}];for(const cfg of configs)console.log('SAMEBLOCK',cfg.name,test(cfg,100,50000));`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
