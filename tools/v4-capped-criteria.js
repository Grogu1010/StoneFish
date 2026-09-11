const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("else if(c==='mobility')z=g.fastMobility(s);", "else if(c==='mobility')z=g.fastMobility(s);else if(c.startsWith('mobilityCap@'))z=Math.min(g.fastMobility(s),Number(c.split('@')[1]));");
src=src.replace("else if(c==='kingFreedom')z=kfree(g,s);", "else if(c==='kingFreedom')z=kfree(g,s);else if(c.startsWith('kingFreedomCap@'))z=Math.min(kfree(g,s),Number(c.split('@')[1]));");
src=src.replace("else if(c==='kingProtection')z=kprot(g,s);", "else if(c==='kingProtection')z=kprot(g,s);else if(c.startsWith('kingProtectionCap@'))z=Math.min(kprot(g,s),Number(c.split('@')[1]));");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];function add(name,o){C.push({name,order:o});}
function rep(o,from,to){return o.map(x=>x===from?to:x);}
function earlyMob(o,rule){o=o.filter(x=>x!=='mobility');const h=o.indexOf('hangingMax');o.splice(h+1,0,rule);return o;}
add('base',base.slice());
for(const n of[10,12,15,18,20,22,25,30])add('mobCap'+n,rep(base.slice(),'mobility','mobilityCap@'+n));
for(const n of[10,12,15,18,20,22,25,30])add('earlyMobCap'+n,earlyMob(base.slice(),'mobilityCap@'+n));
for(const n of[1,2,3,4,5])add('kingFreeCap'+n,rep(base.slice(),'kingFreedom','kingFreedomCap@'+n));
for(const n of[3,5,7,9,12])add('kingProtCap'+n,rep(base.slice(),'kingProtection','kingProtectionCap@'+n));
for(const m of[12,15,18,20,22])for(const k of[2,3]){let o=earlyMob(base.slice(),'mobilityCap@'+m);o=rep(o,'kingFreedom','kingFreedomCap@'+k);add('comboM'+m+'K'+k,o);}
console.log('CAPPED CRITERIA',C.length,'x 100 fresh games');const f=C.map(cfg=>({cfg,r:test(cfg,100,85000)})).sort((a,b)=>a.r.L-b.r.L||b.r.W-a.r.W);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
