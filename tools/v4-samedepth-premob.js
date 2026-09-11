const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY: selective repetition guard + reordering existing static criteria.
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side;const visits=g.positionCounts.get(g.fastPositionKey())||0;const lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function feature(g,m,c){if(c.startsWith('rep2Lead@'))return repByLead(g,m,1,Number(c.split('@')[1]));
`);

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const BASE=['promotion','castleNow','openingDevelop','hangingMax','rep2Lead@2.5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,premob){let o=BASE.filter(x=>!premob.includes(x));const p=o.indexOf('mobility');o.splice(p,0,...premob);C.push({name,order:o});}
add('control',[]);
for(const x of['queenDiscipline','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'])add('pre_'+x,[x]);
add('pre_q_support',['queenDiscipline','pieceSupport']);
add('pre_q_king',['queenDiscipline','kingProtection']);
add('pre_support_king',['pieceSupport','kingProtection']);
add('pre_king_support',['kingProtection','pieceSupport']);
add('pre_q_support_king',['queenDiscipline','pieceSupport','kingProtection']);
add('pre_q_king_support',['queenDiscipline','kingProtection','pieceSupport']);
const starts=[90000,740000,820000,860000];
function aggregate(cfg){let W=0,L=0,D=0,blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('PREMOB',C.length,'variants x 4 blocks');const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:400,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:400,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
