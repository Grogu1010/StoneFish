const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY. Inspect only the resulting board/history state of each
// existing v3-best candidate. No opponent reply generation and no extra ply.
src=src.replace("function feature(g,m,c){",String.raw`
function conditionalRepeatGuard(g,m,visitLimit,leadMin,endgameMax){
  g.fastApply(m);
  const s=-g.side;
  const visits=g.positionCounts.get(g.fastPositionKey())||0;
  const lead=npm(g,s)-npm(g,-s);
  const own=npm(g,s),opp=npm(g,-s);
  g.fastUndo();
  if(visits<visitLimit)return 1;
  if(endgameMax!=null && Math.max(own,opp)>endgameMax)return 1;
  return lead>=leadMin?0:1;
}
function feature(g,m,c){
  if(c.startsWith('rep2Lead@'))return conditionalRepeatGuard(g,m,1,Number(c.split('@')[1]),null);
  if(c.startsWith('rep3Lead@'))return conditionalRepeatGuard(g,m,2,Number(c.split('@')[1]),null);
  if(c.startsWith('rep2Eg@')){const a=c.split('@');return conditionalRepeatGuard(g,m,1,Number(a[1]),Number(a[2]));}
`);

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,rule){let o=M.slice();if(rule)o.splice(4,0,rule);C.push({name,order:o});}
add('control',null);
for(const n of[0,1,2,3,5,8])add('rep2Lead'+n,'rep2Lead@'+n);
for(const n of[0,1,3])add('rep3Lead'+n,'rep3Lead@'+n);
for(const n of[1,3])for(const e of[10,14,18])add('rep2Eg'+n+'_'+e,'rep2Eg@'+n+'@'+e);
const starts=[90000,740000,820000,860000];
function aggregate(cfg){let W=0,L=0,D=0;const blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('CONDITIONAL REPETITION',C.length,'variants x 4 fresh/exact blocks');
const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);
for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:x.r.games,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}
console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:out[0].r.games,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
