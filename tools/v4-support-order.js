const fs = require('fs');

const source = fs.readFileSync('tools/v4-tune.js', 'utf8');
const start = source.indexOf('const base=[');
const end = source.indexOf('\n`;\nnew Function', start);
if (start < 0 || end < 0) throw new Error('Could not locate tuning harness tail');

const tail = String.raw`const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];let id=0;function add(o,n){C.push({name:n||('s'+id++),order:o});}
add(base.slice(),'base');
const focus=['pieceSupport','kingFreedom','kingProtection','mobility','center','minorCentral'];
for(const name of focus){
  const without=base.filter(x=>x!==name);
  for(const pos of [3,4,5,6,7,8,9,10,11,12]){
    const o=without.slice();o.splice(Math.min(pos,o.length),0,name);add(o,name+'_p'+pos);
  }
}
for(const trio of [
 ['hangingMax','pieceSupport','mobility'],
 ['hangingMax','pieceSupport','kingFreedom'],
 ['hangingMax','kingProtection','pieceSupport'],
 ['hangingMax','kingFreedom','pieceSupport'],
 ['hangingMax','pieceSupport','kingProtection'],
 ['hangingMax','mobility','pieceSupport']
]){
  const rest=base.filter(x=>!trio.includes(x));
  const idx=rest.indexOf('queenDiscipline');
  rest.splice(idx,0,...trio);
  add(rest,'trio_'+trio.join('_'));
}
console.log('SUPPORT ORDER SCREEN',C.length,'x 20');
const s=C.map(cfg=>({cfg,r:test(cfg,20,22000)})).sort(rank);
for(const x of s.slice(0,15))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('SUPPORT ORDER CONFIRM top 10 x 60');
const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,60,24000)})).sort(rank);
for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('SUPPORT ORDER FINAL top 4 x 100');
const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,28000)})).sort(rank);
for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;

eval(source.slice(0, start) + tail + source.slice(end));
