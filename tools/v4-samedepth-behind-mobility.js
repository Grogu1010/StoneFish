const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side,visits=g.positionCounts.get(g.fastPositionKey())||0,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function cycleProgress(g,m,leadMin){const visits=g.positionCounts.get(g.fastPositionKey())||0;if(visits<2)return 0;const s=g.side,lead=npm(g,s)-npm(g,-s);if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function mobilityByLead(g,m,minLead){g.fastApply(m);const s=-g.side,lead=npm(g,s)-npm(g,-s),z=lead>=minLead?g.fastMobility(s):0;g.fastUndo();return z;}
function feature(g,m,c){if(c==='rep2Lead2_5')return repByLead(g,m,1,2.5);if(c==='cycleProgress2_5')return cycleProgress(g,m,2.5);if(c.startsWith('mobilityLead@'))return mobilityByLead(g,m,Number(c.split('@')[1]));`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const B=['promotion','rep2Lead2_5','castleNow','openingDevelop','hangingMax','cycleProgress2_5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[{name:'bestControl',order:B.slice()}];
for(const t of[-5,-3,-2,-1,0,1,3]){const o=B.map(x=>x==='mobility'?'mobilityLead@'+t:x);C.push({name:'mobLead'+t,order:o});}
const starts=[90000,740000,820000,860000];
function aggregate(cfg){let W=0,L=0,D=0,blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('BEHIND MOBILITY',C.length,'variants x 4 blocks');const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:x.r.games,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:out[0].r.games,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
