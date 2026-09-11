const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("else if(c==='kingProtection')z=kprot(g,s);else if(c==='pawnStructure')", "else if(c==='kingProtection')z=kprot(g,s);else if(c==='midKingProtection')z=eg(g,s)?0:kprot(g,s);else if(c==='midCenter')z=eg(g,s)?0:center(g,s);else if(c==='midMinorCentral')z=eg(g,s)?0:minor(g,s);else if(c==='pawnStructure')");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];let id=0;function add(o,label){C.push({name:(label||'p')+(id++),order:o});}
function repl(map){return base.map(x=>map[x]||x);}
add(base.slice(),'base');
add(repl({kingProtection:'midKingProtection'}),'midKP_');
add(repl({center:'midCenter'}),'midC_');
add(repl({minorCentral:'midMinorCentral'}),'midM_');
add(repl({kingProtection:'midKingProtection',center:'midCenter'}),'midKPC_');
add(repl({kingProtection:'midKingProtection',minorCentral:'midMinorCentral'}),'midKPM_');
add(repl({center:'midCenter',minorCentral:'midMinorCentral'}),'midCM_');
add(repl({kingProtection:'midKingProtection',center:'midCenter',minorCentral:'midMinorCentral'}),'allPhase_');
console.log('PHASE GATES 8 x 100');const f=C.map(cfg=>({cfg,r:test(cfg,100,50000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
