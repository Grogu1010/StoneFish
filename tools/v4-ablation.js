const fs = require('fs');

const source = fs.readFileSync('tools/v4-tune.js', 'utf8');
const start = source.indexOf('const base=[');
const end = source.indexOf('\n`;\nnew Function', start);
if (start < 0 || end < 0) throw new Error('Could not locate tuning harness tail');

const tail = String.raw`const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];
C.push({name:'base',order:base.slice()});
for(let i=3;i<base.length;i++){
  const o=base.slice();
  const removed=o.splice(i,1)[0];
  C.push({name:'drop_'+removed,order:o});
}
for(let i=3;i<base.length-1;i++){
  const o=base.slice();
  const moved=o.splice(i,1)[0];
  o.push(moved);
  C.push({name:'late_'+moved,order:o});
}
for(const name of ['repetitionAvoid','fiftyReset','endgameCheck','kingProtection']){
  const o=base.filter(x=>x!==name);
  C.push({name:'riskdrop_'+name,order:o});
}
for(const pair of [['repetitionAvoid','fiftyReset'],['repetitionAvoid','endgameCheck'],['fiftyReset','endgameCheck'],['kingProtection','endgameCheck'],['repetitionAvoid','kingProtection']]){
  const o=base.filter(x=>!pair.includes(x));
  C.push({name:'pairdrop_'+pair.join('_'),order:o});
}
console.log('ABLATION SCREEN',C.length,'x 20');
const s=C.map(cfg=>({cfg,r:test(cfg,20,12000)})).sort(rank);
for(const x of s.slice(0,15))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('ABLATION CONFIRM top 10 x 60');
const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,60,14000)})).sort(rank);
for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('ABLATION FINAL top 4 x 100');
const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,18000)})).sort(rank);
for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;

eval(source.slice(0, start) + tail + source.slice(end));
