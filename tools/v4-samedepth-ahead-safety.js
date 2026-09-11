const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY: repetition history + current material lead + static post-move features.
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){
  g.fastApply(m);const s=-g.side;const visits=g.positionCounts.get(g.fastPositionKey())||0;const lead=npm(g,s)-npm(g,-s);g.fastUndo();
  if(visits<visitLimit)return 1;return lead>=leadMin?0:1;
}
function currentLead(g){return npm(g,g.side)-npm(g,-g.side);}
function aheadStatic(g,m,kind,threshold){if(currentLead(g)<threshold)return 0;g.fastApply(m);const s=-g.side;let z=0;if(kind==='support')z=ownDef(g,s,m.to)?1:0;else if(kind==='king')z=kprot(g,s);else if(kind==='freedom')z=kfree(g,s);g.fastUndo();return z;}
function feature(g,m,c){
  if(c.startsWith('rep2Lead@'))return repByLead(g,m,1,Number(c.split('@')[1]));
  if(c.startsWith('aheadSupport@'))return aheadStatic(g,m,'support',Number(c.split('@')[1]));
  if(c.startsWith('aheadKing@'))return aheadStatic(g,m,'king',Number(c.split('@')[1]));
  if(c.startsWith('aheadFreedom@'))return aheadStatic(g,m,'freedom',Number(c.split('@')[1]));
`);

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','rep2Lead@2.5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,rules){let o=M.slice();const p=o.indexOf('mobility');o.splice(p,0,...rules);C.push({name,order:o});}
add('control',[]);
for(const t of[1,3,5]){add('support'+t,['aheadSupport@'+t]);add('king'+t,['aheadKing@'+t]);add('freedom'+t,['aheadFreedom@'+t]);add('supportKing'+t,['aheadSupport@'+t,'aheadKing@'+t]);add('kingSupport'+t,['aheadKing@'+t,'aheadSupport@'+t]);}
const starts=[90000,740000,820000,860000];
function aggregate(cfg){let W=0,L=0,D=0,blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('AHEAD SAFETY',C.length,'variants x 4 blocks');const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:400,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:400,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
