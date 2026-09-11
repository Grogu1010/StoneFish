const fs = require('fs');
let source = fs.readFileSync('tools/v4-tune.js', 'utf8');
source = source.replace(
  "function feature(g,m,c){",
  "function activePieces(g,s){const old=g.side,ep=g.ep;g.side=s;g.ep=-1;const ms=g.fastMoves();g.side=old;g.ep=ep;const seen=new Set();for(const m of ms)seen.add(m.from);return seen.size;}\nfunction minorMobility(g,s){const old=g.side,ep=g.ep;g.side=s;g.ep=-1;const ms=g.fastMoves();g.side=old;g.ep=ep;let n=0;for(const m of ms)if(m.piece===2||m.piece===3)n++;return n;}\nfunction feature(g,m,c){"
);
source = source.replace(
  "else if(c==='mobility')z=g.fastMobility(s);",
  "else if(c==='activePieces')z=activePieces(g,s);else if(c==='minorMobility')z=minorMobility(g,s);else if(c==='mobility')z=g.fastMobility(s);"
);
const start = source.indexOf('const base=[');
const end = source.indexOf('\n`;\nnew Function', start);
if (start < 0 || end < 0) throw new Error('Could not locate tuning harness tail');
const tail = String.raw`const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];let id=0;function add(o,n){C.push({name:n||('a'+id++),order:o});}
add(base.slice(),'base');
for(const feat of ['activePieces','minorMobility']){
  for(const pos of [3,4,5,8,9,10,11,12,13]){
    const o=base.slice();o.splice(pos,0,feat);add(o,feat+'_p'+pos);
  }
}
for(const seq of [
 ['hangingMax','activePieces','mobility'],
 ['hangingMax','activePieces','pieceSupport','mobility'],
 ['hangingMax','pieceSupport','activePieces','mobility'],
 ['hangingMax','minorMobility','activePieces','mobility'],
 ['hangingMax','activePieces','minorMobility','mobility'],
 ['hangingMax','pieceSupport','minorMobility','mobility']
]){
  const rest=base.filter(x=>!seq.includes(x));
  const insert=rest.indexOf('queenDiscipline');
  rest.splice(insert,0,...seq);add(rest,'seq_'+seq.join('_'));
}
console.log('ACTIVITY SCREEN',C.length,'x 20');
const s=C.map(cfg=>({cfg,r:test(cfg,20,32000)})).sort(rank);
for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('ACTIVITY CONFIRM top 8 x 60');
const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,60,34000)})).sort(rank);
for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('ACTIVITY FINAL top 4 x 100');
const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,38000)})).sort(rank);
for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
