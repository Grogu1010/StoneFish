const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];let id=0;function add(o,label){C.push({name:(label||'r')+(id++),order:o});}
function drop(...rules){return base.filter(x=>!rules.includes(x));}
add(base.slice(),'base');
add(drop('repetitionAvoid'),'noRep_');
add(drop('fiftyReset'),'no50_');
add(drop('endgameCheck'),'noEgCheck_');
add(drop('kingProtection'),'noKProt_');
add(drop('repetitionAvoid','fiftyReset'),'noRep50_');
add(drop('repetitionAvoid','endgameCheck'),'noRepEg_');
add(drop('repetitionAvoid','kingProtection'),'noRepKP_');
add(drop('fiftyReset','endgameCheck'),'no50Eg_');
add(drop('endgameCheck','kingProtection'),'noEgKP_');
add(drop('repetitionAvoid','fiftyReset','endgameCheck'),'noDrawPush_');
add(drop('repetitionAvoid','fiftyReset','endgameCheck','kingProtection'),'lean_');
console.log('RISK PRUNE 12 x 100');const f=C.map(cfg=>({cfg,r:test(cfg,100,30000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
