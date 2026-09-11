const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];let id=0;function add(o,label){C.push({name:(label||'a')+(id++),order:o});}
add(base.slice(),'base');
for(const rule of base){if(rule==='promotion')continue;add(base.filter(x=>x!==rule),'drop_'+rule+'_');}
for(const rule of ['hangingMax','queenDiscipline','mobility','pieceSupport','kingFreedom','center','kingProtection']){
  const stripped=base.filter(x=>x!==rule);
  for(const pos of [2,3,4,5,8,10,12,15]){const o=stripped.slice();o.splice(Math.min(pos,o.length),0,rule);add(o,'move_'+rule+'_');}
}
console.log('ABLATION SCREEN',C.length,'x 30');const s=C.map(cfg=>({cfg,r:test(cfg,30,22000)})).sort(rank);for(const x of s.slice(0,15))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('FINAL top 6 x 100');const f=s.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,25000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
