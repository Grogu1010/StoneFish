const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY. The guard only inspects current/resulting position history
// and static material; it never generates an opponent reply or adds search ply.
src=src.replace("function feature(g,m,c){",String.raw`
function cycleEscape(g,m,currentVisitsMin,resultVisitsMax,leadMin){
  const currentVisits=g.positionCounts.get(g.fastPositionKey())||0;
  if(currentVisits<currentVisitsMin)return 1;
  g.fastApply(m);
  const s=-g.side;
  const resultVisits=g.positionCounts.get(g.fastPositionKey())||0;
  const lead=npm(g,s)-npm(g,-s);
  g.fastUndo();
  if(leadMin!=null && lead<leadMin)return 1;
  return resultVisits<=resultVisitsMax?1:0;
}
function feature(g,m,c){
  if(c.startsWith('cycleEscape@')){const a=c.split('@');const lead=a[3]==='x'?null:Number(a[3]);return cycleEscape(g,m,Number(a[1]),Number(a[2]),lead);}
`);

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,rule){let o=M.slice();if(rule)o.splice(4,0,rule);C.push({name,order:o});}
add('control',null);
// Only intervene once the current position is already a repeated state.
add('cur2_novel','cycleEscape@2@0@x');
add('cur2_noThird','cycleEscape@2@1@x');
for(const lead of[0,1,2,3,5])add('cur2_novel_lead'+lead,'cycleEscape@2@0@'+lead);
for(const lead of[0,1,3])add('cur2_noThird_lead'+lead,'cycleEscape@2@1@'+lead);
// Slightly earlier warning: current state has been seen once before.
for(const lead of[1,3,5])add('cur1_novel_lead'+lead,'cycleEscape@1@0@'+lead);
const starts=[90000,740000,820000,860000];
function aggregate(cfg){let W=0,L=0,D=0;const blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('CYCLE ESCAPE',C.length,'variants x 4 blocks');
const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);
for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:x.r.games,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}
console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:out[0].r.games,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
