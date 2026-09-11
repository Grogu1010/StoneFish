const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY: static attack geometry on the resulting board; no opponent move generation.
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side;const visits=g.positionCounts.get(g.fastPositionKey())||0;const lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
const TV=[0,1,3,3.1,5,9,1000];
function cheapestAttacker(g,sq,by){const b=g.boardState,f=sq&7,r=sq>>3;let best=Infinity;const pr=r-by;if(pr>=0&&pr<8){if(f>0&&b[pr*8+f-1]===by)best=1;if(f<7&&b[pr*8+f+1]===by)best=1;}for(let i=0;i<8;i++){const nf=f+SF_KNIGHT_DF[i],nr=r+SF_KNIGHT_DR[i];if(nf>=0&&nf<8&&nr>=0&&nr<8&&b[nr*8+nf]===by*2)best=Math.min(best,3);}for(let i=0;i<SF_DIAG_DIRS.length;i+=2){const df=SF_DIAG_DIRS[i],dr=SF_DIAG_DIRS[i+1];let nf=f+df,nr=r+dr;while(nf>=0&&nf<8&&nr>=0&&nr<8){const p=b[nr*8+nf];if(p){if((p>0?1:-1)===by&&(Math.abs(p)===3||Math.abs(p)===5))best=Math.min(best,TV[Math.abs(p)]);break;}nf+=df;nr+=dr;}}for(let i=0;i<SF_ORTH_DIRS.length;i+=2){const df=SF_ORTH_DIRS[i],dr=SF_ORTH_DIRS[i+1];let nf=f+df,nr=r+dr;while(nf>=0&&nf<8&&nr>=0&&nr<8){const p=b[nr*8+nf];if(p){if((p>0?1:-1)===by&&(Math.abs(p)===4||Math.abs(p)===5))best=Math.min(best,TV[Math.abs(p)]);break;}nf+=df;nr+=dr;}}for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf>=0&&nf<8&&nr>=0&&nr<8&&b[nr*8+nf]===by*6)best=Math.min(best,1000);}return best;}
function tradeExposure(g,m,activateAt){const lead=npm(g,g.side)-npm(g,-g.side);if(lead>activateAt)return 0;g.fastApply(m);const piece=Math.abs(g.boardState[m.to]);const atk=cheapestAttacker(g,m.to,g.side);let z=2;if(atk<Infinity)z=atk+1e-9>=TV[piece]?1:0;g.fastUndo();return z;}
function feature(g,m,c){if(c.startsWith('rep2Lead@'))return repByLead(g,m,1,Number(c.split('@')[1]));if(c.startsWith('tradeExposure@'))return tradeExposure(g,m,Number(c.split('@')[1]));
`);

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const BASE=['promotion','castleNow','openingDevelop','hangingMax','rep2Lead@2.5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[{name:'control',order:BASE.slice()}];for(const t of[1,0,-1,-2,-3]){let o=BASE.slice();const p=o.indexOf('mobility');o.splice(p,0,'tradeExposure@'+t);C.push({name:'tradeAt'+t,order:o});}
const starts=[90000,740000,820000,860000];function aggregate(cfg){let W=0,L=0,D=0,blocks=[];for(const st of starts){const r=test(cfg,100,st);blocks.push([st,r]);W+=r.W;L+=r.L;D+=r.D;}return{W,L,D,games:400,score:W-8*L+.01*D,blocks};}
console.log('TRADE EXPOSURE',C.length,'variants x 4 blocks');const out=C.map(cfg=>({cfg,r:aggregate(cfg)})).sort((a,b)=>b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W);for(const x of out){console.log('TOTAL',x.cfg.name,{W:x.r.W,L:x.r.L,D:x.r.D,games:400,score:x.r.score});for(const [st,r] of x.r.blocks)console.log(' BLOCK',st,r);}console.log('WINNER',JSON.stringify(out[0].cfg),{W:out[0].r.W,L:out[0].r.L,D:out[0].r.D,games:400,score:out[0].r.score});
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
