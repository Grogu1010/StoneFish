const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
  "function feature(g,m,c){",
  "function kingPawnShield(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3;let z=0;for(const df of[-1,0,1]){const nf=f+df;if(nf<0||nf>7)continue;for(const d of[1,2]){const nr=r+s*d;if(nr<0||nr>7)continue;if(b[nr*8+nf]===s)z+=d===1?2:1;}}return z;}\nfunction feature(g,m,c){"
);
source=source.replace(
  "else if(c==='hangingMax')z=hangingMax(g,s);",
  "else if(c==='kingPawnShield')z=kingPawnShield(g,s);else if(c==='hangingMax')z=hangingMax(g,s);"
);
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const p10=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const p11=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,o){C.push({name,order:o});}add('p10',p10.slice());add('p11',p11.slice());
for(const [bn,b] of [['p10',p10],['p11',p11]])for(const pos of[3,4,5,8,9,10,11,12,13,14]){const o=b.slice();o.splice(pos,0,'kingPawnShield');add(bn+'_shield_p'+pos,o);}
for(const [bn,b] of [['p10',p10],['p11',p11]]){
 for(const seq of [['kingPawnShield','kingProtection','pieceSupport'],['kingProtection','kingPawnShield','pieceSupport'],['kingProtection','pieceSupport','kingPawnShield'],['pieceSupport','kingPawnShield','kingProtection'],['pieceSupport','kingProtection','kingPawnShield']]){
  const rest=b.filter(x=>!seq.includes(x));const idx=rest.indexOf('kingFreedom');rest.splice(idx,0,...seq);add(bn+'_seq_'+seq.join('_'),rest);
 }
}
console.log('SHIELD HYBRID SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,72000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('SHIELD HYBRID CONFIRM top 8 x 60');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,60,74000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('SHIELD HYBRID FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,78000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
