const fs = require('fs');
let source = fs.readFileSync('tools/v4-tune.js', 'utf8');
source = source.replace(
  "function feature(g,m,c){if(c==='promotion')return m.promotion||0;if(c==='castleNow')return(m.flags&12)?1:0;if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;",
  "function feature(g,m,c){if(c==='promotion')return m.promotion||0;if(c==='castleNow')return(m.flags&12)?1:0;if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;"
);
source = source.replace(
  "else if(c==='hangingMax')z=hangingMax(g,s);",
  "else if(c==='movedSafety'){const atk=g._isAttacked(m.to,-s),def=g._isAttacked(m.to,s);z=atk?(def?1:0):2;}else if(c==='movedExposure'){z=g._isAttacked(m.to,-s)?-(V[Math.abs(g.boardState[m.to])]||0):0;}else if(c==='hangingMax')z=hangingMax(g,s);"
);
const start = source.indexOf('const base=[');
const end = source.indexOf('\n`;\nnew Function', start);
if (start < 0 || end < 0) throw new Error('Could not locate tuning harness tail');
const tail = String.raw`const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,o){C.push({name,order:o});}add('base',base.slice());
for(const feat of ['movedSafety','movedExposure'])for(const pos of [3,4,5,8,9,10,11,12,13]){const o=base.slice();o.splice(pos,0,feat);add(feat+'_p'+pos,o);}
for(const seq of [
 ['hangingMax','movedSafety','pieceSupport'],
 ['hangingMax','pieceSupport','movedSafety'],
 ['hangingMax','movedExposure','pieceSupport'],
 ['hangingMax','movedSafety','mobility'],
 ['hangingMax','movedExposure','mobility'],
 ['hangingMax','movedSafety','movedExposure']
]){const rest=base.filter(x=>!seq.includes(x));const idx=rest.indexOf('queenDiscipline');rest.splice(idx,0,...seq);add('seq_'+seq.join('_'),rest);}
console.log('MOVED SAFETY SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,52000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('MOVED SAFETY CONFIRM top 8 x 60');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,60,54000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('MOVED SAFETY FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,58000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
