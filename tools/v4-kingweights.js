const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
"function kprot(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k];let z=0;b[k]=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const q=nr*8+nf,p=b[q];if(p&&(p>0?1:-1)===s)z+=Math.abs(p)===1?3:2;if(g._isAttacked(q,s))z++;}b[k]=kp;return z;}",
"function kprot(g,s,cfg){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k],pw=cfg.pawnCover??3,ow=cfg.pieceCover??2,dw=cfg.ringDefense??1;let z=0;b[k]=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const q=nr*8+nf,p=b[q];if(p&&(p>0?1:-1)===s)z+=Math.abs(p)===1?pw:ow;if(g._isAttacked(q,s))z+=dw;}b[k]=kp;return z;}"
);
source=source.replace("function feature(g,m,c){","function feature(g,m,c,cfg){");
source=source.replace("else if(c==='kingProtection')z=kprot(g,s);","else if(c==='kingProtection')z=kprot(g,s,cfg);");
source=source.replace("const s=feature(g,a[i],c);","const s=feature(g,a[i],c,cfg);");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const p10=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const p11=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const weights=[[1,1,0],[2,1,1],[3,1,1],[3,2,1],[4,1,1],[4,2,1],[5,1,1],[5,2,1],[3,1,2],[4,1,2],[5,1,2],[6,1,1],[6,2,1]];
const C=[];for(const [bn,b] of [['p10',p10],['p11',p11]])for(const [pw,ow,dw] of weights)C.push({name:bn+'_w'+pw+'_'+ow+'_'+dw,order:b.slice(),pawnCover:pw,pieceCover:ow,ringDefense:dw});
console.log('KING WEIGHT SCREEN',C.length,'x 24');const s=C.map(cfg=>({cfg,r:test(cfg,24,92000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.r);
console.log('KING WEIGHT CONFIRM top 8 x 60');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,60,94000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('KING WEIGHT FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,98000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
