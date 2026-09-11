const fs=require('fs');
const engine=fs.readFileSync('StonefishChess.js','utf8');
const v3=fs.readFileSync('Stonefish_v3.js','utf8');
const pre=fs.readFileSync('tools/v4-tune.js','utf8');
const hs=pre.indexOf('function seeded('),he=pre.indexOf('const base=[',hs);if(hs<0||he<0)throw new Error('harness core not found');
let core=pre.slice(hs,he);
core=core.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
core=core.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
core=core.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
core=core.replace("function feature(g,m,c){",String.raw`function matDiff(g,s){let z=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(!p||Math.abs(p)===6)continue;const v=V[Math.abs(p)]||0;z+=(p>0?1:-1)===s?v:-v;}return z;}
function fourPlyScore(g,root){const M=1000000,immediate=V[root.captured]||0;g.fastApply(root);const replies=g.fastMoves();if(!replies.length){const z=g.in_check()?M:immediate;g.fastUndo();return z;}let worst=Infinity;for(const reply of replies){const oppGain=V[reply.captured]||0;g.fastApply(reply);const responses=g.fastMoves();if(!responses.length&&g.in_check()){g.fastUndo();worst=-M;break;}let best=-Infinity;for(const response of responses){const ourGain=V[response.captured]||0;g.fastApply(response);const fourth=g.fastMoves();let score;if(!fourth.length&&g.in_check())score=M;else{let fourthGain=0,fourthMate=false;for(const fm of fourth){const cap=V[fm.captured]||0;if(cap>fourthGain)fourthGain=cap;if(!fourthMate&&g.fastGivesCheck(fm)){g.fastApply(fm);if(g.fastMoves().length===0&&g.in_check())fourthMate=true;g.fastUndo();}}score=fourthMate?-M:(immediate-oppGain+ourGain-fourthGain);}g.fastUndo();if(score>best)best=score;if(best===M)break;}g.fastUndo();if(best<worst)worst=best;if(worst===-M)break;}g.fastUndo();return worst;}
function feature(g,m,c){if(c==='fourPlyLead2')return matDiff(g,g.side)>2?0:fourPlyScore(g,m);`);
const tail=String.raw`
const CFG={name:'lead2winner',developUntil:8,queenUntil:14,endgameMaterial:14,order:['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','fourPlyLead2','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl']};
ACTIVE=CFG;
function moveName(g,m){return g._alg(m.from)+g._alg(m.to)+(m.promotion?g._typeChar(m.promotion):'');}
function choose4Trace(g,r,cfg,events,ply){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;const startCount=a.length,reductions=[],own=g.side,mat=npm(g,own)-npm(g,-own);for(const c of cfg.order){if(a.length<=1)break;const before=a.length;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);if(a.length<before)reductions.push(c+':'+before+'>'+a.length+'@'+best);}const raw=a[Math.floor(r()*a.length)];if(startCount>1){events.push({ply,fullmove:g.fullmove,turn:g.turn(),mat:Number(mat.toFixed(1)),start:startCount,chosen:moveName(g,raw),reductions});if(events.length>36)events.shift();}return raw;}
function playTrace(cfg,n,max=1000){const g=new Chess(),vw=(n&1)===0,r3=seeded(0x9e3779b9^(n*0x45d9f3b)),r4=seeded(0x85ebca6b^(n*0x27d4eb2d));const events=[];let ply=0;for(;ply<max;ply++){const vt=(g.turn()==='w')===vw,m=vt?choose4Trace(g,r4,cfg,events,ply):choose3(g,r3);if(!m){if(!g.in_check())return{result:'D',events,ply,vw};const ww=g.turn()==='b';return{result:ww===vw?'W':'L',events,ply,vw};}g._applyRaw(m,true);if(draw(g))return{result:'D',events,ply:ply+1,vw};}return{result:'D',events,ply,vw};}
let W=0,L=0,D=0;const losses=[],decisive={};for(let i=0;i<100;i++){const n=210000+i,res=playTrace(CFG,n,1000);if(res.result==='W')W++;else if(res.result==='L'){L++;losses.push({game:n,color:res.vw?'W':'B',plies:res.ply,events:res.events});for(const e of res.events)for(const x of e.reductions){const c=x.split(':')[0];decisive[c]=(decisive[c]||0)+1;}}else D++;}
console.log('TRACE SCORE',{W,L,D,games:100});console.log('LOSS GAMES',losses.map(x=>({game:x.game,color:x.color,plies:x.plies})));console.log('CRITERIA REDUCTIONS',decisive);for(const loss of losses){console.log('LOSS',loss.game,'v4='+loss.color,'plies='+loss.plies);for(const e of loss.events)console.log(' ',JSON.stringify(e));}
`;
let ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};
new Function(engine+'\n'+v3+'\nlet ACTIVE='+JSON.stringify(ACTIVE)+';\n'+core+'\n'+tail)();
