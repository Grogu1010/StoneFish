const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function immediateCaptureRisk(g){",String.raw`function safeCheck(g,m){if(!g.fastGivesCheck(m))return 0;g.fastApply(m);const s=-g.side,q=m.to;const attacked=g._isAttacked(q,-s),defended=g._isAttacked(q,s);g.fastUndo();return(!attacked||defended)?1:0;}
function immediateCaptureRisk(g){`);
src=src.replace("if(c==='check')return g.fastGivesCheck(m)?1:0;", "if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='safeCheck')return safeCheck(g,m);");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];function add(name,o){C.push({name,order:o});}
function ins(o,rule,pos){o=o.filter(x=>x!==rule);o.splice(pos,0,rule);return o;}
function mobilityEarly(o){o=o.filter(x=>x!=='mobility');const h=o.indexOf('hangingMax');o.splice(h+1,0,'mobility');return o;}
add('base',base.slice());
for(const rule of['check','safeCheck'])for(const pos of[4,5,6,8,9,10,11,12,13,14,15])add(rule+pos,ins(base.slice(),rule,pos));
const m=mobilityEarly(base.slice());add('M',m);for(const rule of['check','safeCheck'])for(const pos of[5,6,7,9,10,11,12,13,14])add('M_'+rule+pos,ins(m.slice(),rule,pos));
console.log('SAFE CHECKS',C.length,'x 100 fresh games');const f=C.map(cfg=>({cfg,r:test(cfg,100,90000)})).sort((a,b)=>a.r.L-b.r.L||b.r.W-a.r.W);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
