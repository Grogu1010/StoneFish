const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
"function feature(g,m,c){",
`function movedAttacks(g,s,from,to){const b=g.boardState,p=Math.abs(b[from]);if(!p)return false;const ff=from&7,fr=from>>3,tf=to&7,tr=to>>3,df=tf-ff,dr=tr-fr;if(p===1)return dr===s&&Math.abs(df)===1;if(p===2)return(Math.abs(df)===1&&Math.abs(dr)===2)||(Math.abs(df)===2&&Math.abs(dr)===1);if(p===6)return Math.max(Math.abs(df),Math.abs(dr))===1;let stepF=0,stepR=0;if(p===3||p===5){if(Math.abs(df)===Math.abs(dr)&&df!==0){stepF=Math.sign(df);stepR=Math.sign(dr);}}if(!stepF&&!stepR&&(p===4||p===5)){if(df===0&&dr!==0)stepR=Math.sign(dr);else if(dr===0&&df!==0)stepF=Math.sign(df);}if(!stepF&&!stepR)return false;let f=ff+stepF,r=fr+stepR;while(f!==tf||r!==tr){if(b[r*8+f])return false;f+=stepF;r+=stepR;}return true;}
function threatMetrics(g,s,sq){const b=g.boardState;let count=0,sum=0,max=0;for(let q=0;q<64;q++){const p=b[q];if(!p||(p>0?1:-1)!==-s||Math.abs(p)===6)continue;if(movedAttacks(g,s,sq,q)){const v=V[Math.abs(p)]||0;sum+=v;if(v>max)max=v;if(v>=3)count++;}}return{count,sum,max,fork:count>=2?sum:0};}
function feature(g,m,c){`
);
source=source.replace(
"else if(c==='hangingMax')z=hangingMax(g,s);",
"else if(c==='forkTargets'||c==='threatSum'||c==='threatMax'||c==='forkValue'){const t=threatMetrics(g,s,m.to);z=c==='forkTargets'?t.count:c==='threatSum'?t.sum:c==='threatMax'?t.max:t.fork;}else if(c==='hangingMax')z=hangingMax(g,s);"
);
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,o){C.push({name,order:o});}add('base',base.slice());
for(const feat of ['forkTargets','forkValue','threatMax','threatSum'])for(const pos of[3,4,5,8,9,10,11,12,13]){const o=base.slice();o.splice(pos,0,feat);add(feat+'_p'+pos,o);}
for(const seq of [
 ['hangingMax','forkTargets','threatMax'],
 ['hangingMax','forkValue','pieceSupport'],
 ['hangingMax','threatMax','pieceSupport'],
 ['hangingMax','pieceSupport','forkValue'],
 ['hangingMax','forkValue','mobility'],
 ['hangingMax','threatSum','pieceSupport']
]){const rest=base.filter(x=>!seq.includes(x));const idx=rest.indexOf('queenDiscipline');rest.splice(idx,0,...seq);add('seq_'+seq.join('_'),rest);}
console.log('THREAT SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,102000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('THREAT CONFIRM top 8 x 60');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,60,104000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('THREAT FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,108000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
