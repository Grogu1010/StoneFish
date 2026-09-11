const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function immediateCaptureRisk(g){",String.raw`function kingPawnShield(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3;let z=0;for(const df of[-1,0,1]){const nf=f+df;if(nf<0||nf>7)continue;for(const d of[1,2]){const nr=r+s*d;if(nr<0||nr>7)continue;if(b[nr*8+nf]===s)z+=d===1?2:1;}}return z;}
function immediateCaptureRisk(g){`);
src=src.replace("else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='captureSafety')z=immediateCaptureRisk(g);", "else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='kingPawnShield')z=kingPawnShield(g,s);else if(c==='captureSafety')z=immediateCaptureRisk(g);");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];let id=0;function add(o,label){C.push({name:(label||'s')+(id++),order:o});}
add(base.slice(),'base');
for(const pos of[2,3,4,5,6,7,8,9,10,11,12,13,14,15]){const o=base.slice();o.splice(pos,0,'kingPawnShield');add(o);}
for(const pos of[3,4,5,8,9,10,12,14]){const o=base.filter(x=>x!=='kingProtection');o.splice(pos,0,'kingPawnShield');add(o,'shieldNoKP_');}
console.log('SHIELD SCREEN',C.length,'x 30');const s=C.map(cfg=>({cfg,r:test(cfg,30,34000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('FINAL top 6 x 100');const f=s.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,38000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
