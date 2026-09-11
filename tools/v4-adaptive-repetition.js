const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='captureSafety')", "else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='adaptiveRepetition'){const rep=g.positionCounts.get(g.fastPositionKey())||0;z=hangingMax(g,s)<0?rep:-rep;}else if(c==='captureSafety')");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];function add(name,o){C.push({name,order:o});}
function adapt(o){return o.map(x=>x==='repetitionAvoid'?'adaptiveRepetition':x);}
function mobilityEarly(o){o=o.filter(x=>x!=='mobility');const h=o.indexOf('hangingMax');o.splice(h+1,0,'mobility');return o;}
add('base',base.slice());add('adaptive',adapt(base.slice()));add('M',mobilityEarly(base.slice()));add('M_adaptive',adapt(mobilityEarly(base.slice())));
for(const pos of[4,5,6,7,8,9,10,11]){let o=base.filter(x=>x!=='repetitionAvoid');o.splice(pos,0,'adaptiveRepetition');add('A'+pos,o);let m=mobilityEarly(base.slice()).filter(x=>x!=='repetitionAvoid');m.splice(pos,0,'adaptiveRepetition');add('MA'+pos,m);}
console.log('ADAPTIVE REPETITION',C.length,'x 100 fresh games');const f=C.map(cfg=>({cfg,r:test(cfg,100,70000)})).sort((a,b)=>a.r.L-b.r.L||b.r.W-a.r.W);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
