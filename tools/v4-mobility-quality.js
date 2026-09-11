const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function control(g,s){",String.raw`function mobilityStats(g,s){const os=g.side,oe=g.ep;g.side=s;g.ep=-1;const ms=g.fastMoves();g.side=os;g.ep=oe;const from=new Set();let nonQueen=0,minor=0;for(const m of ms){from.add(m.from);if(m.piece!==5)nonQueen++;if(m.piece===2||m.piece===3)minor++;}return{total:ms.length,distinct:from.size,nonQueen,minor};}
function control(g,s){`);
src=src.replace("else if(c==='mobility')z=g.fastMobility(s);", "else if(c==='mobility')z=g.fastMobility(s);else if(c==='distinctMobility')z=mobilityStats(g,s).distinct;else if(c==='balancedMobility'){const ms=mobilityStats(g,s);z=ms.distinct*100+ms.total;}else if(c==='nonQueenMobility')z=mobilityStats(g,s).nonQueen;else if(c==='minorMobility')z=mobilityStats(g,s).minor;");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];function add(name,o){C.push({name,order:o});}
function repl(o,rule){return o.map(x=>x==='mobility'?rule:x);}
function early(o,rule){o=o.filter(x=>!['mobility','distinctMobility','balancedMobility','nonQueenMobility','minorMobility'].includes(x));const h=o.indexOf('hangingMax');o.splice(h+1,0,rule);return o;}
add('base',base.slice());for(const rule of['distinctMobility','balancedMobility','nonQueenMobility','minorMobility'])add('normal_'+rule,repl(base.slice(),rule));
for(const rule of['mobility','distinctMobility','balancedMobility','nonQueenMobility','minorMobility'])add('early_'+rule,early(base.slice(),rule));
for(const pair of[['distinctMobility','mobility'],['nonQueenMobility','mobility'],['distinctMobility','nonQueenMobility'],['balancedMobility','minorMobility']]){let o=base.filter(x=>x!=='mobility');const h=o.indexOf('hangingMax');o.splice(h+1,0,...pair);add('early_'+pair.join('_'),o);}
console.log('MOBILITY QUALITY',C.length,'x 100 fresh games');const f=C.map(cfg=>({cfg,r:test(cfg,100,75000)})).sort((a,b)=>a.r.L-b.r.L||b.r.W-a.r.W);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
