const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
  "function center(g,s){",
  "function kprotW(g,s,pw,ow,dw){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k];let z=0;b[k]=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const q=nr*8+nf,p=b[q];if(p&&(p>0?1:-1)===s)z+=Math.abs(p)===1?pw:ow;if(dw&&g._isAttacked(q,s))z+=dw;}b[k]=kp;return z;}\nfunction center(g,s){"
);
source=source.replace(
  "else if(c==='kingProtection')z=kprot(g,s);",
  "else if(c==='kingProtection')z=kprot(g,s);else if(c.startsWith('kp:')){const a=c.split(':');z=kprotW(g,s,+a[1],+a[2],+a[3]);}"
);
const start=source.indexOf('const base=[');
const end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const prefix=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility'];
const suffix=['pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];let id=0;for(const pw of [1,2,3,4,5])for(const ow of [0,1,2,3])for(const dw of [0,1,2,3])C.push({name:'k'+id++,order:[...prefix,'kp:'+pw+':'+ow+':'+dw,...suffix],pw,ow,dw});
console.log('KING PROTECTION VALUES SCREEN',C.length,'x 16');const s=C.map(cfg=>({cfg,r:test(cfg,16,61000)})).sort(rank);for(const x of s.slice(0,15))console.log(x.cfg.name,{pw:x.cfg.pw,ow:x.cfg.ow,dw:x.cfg.dw},x.r);
console.log('KING PROTECTION VALUES CONFIRM top 12 x 60');const c=s.slice(0,12).map(x=>({cfg:x.cfg,r:test(x.cfg,60,64000)})).sort(rank);for(const x of c)console.log(x.cfg.name,{pw:x.cfg.pw,ow:x.cfg.ow,dw:x.cfg.dw},x.r);
console.log('KING PROTECTION VALUES FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,69000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,{pw:x.cfg.pw,ow:x.cfg.ow,dw:x.cfg.dw},x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
