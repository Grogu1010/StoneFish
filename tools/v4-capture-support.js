const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
  "function feature(g,m,c){if(c==='promotion')return m.promotion||0;if(c==='castleNow')return(m.flags&12)?1:0;if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;",
  "function feature(g,m,c){if(c==='promotion')return m.promotion||0;if(c==='castleNow')return(m.flags&12)?1:0;if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='captureNow')return V[m.captured]||0;if(c==='lowValueCaptor')return m.captured?-(V[m.piece]||0):0;if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;"
);
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const p10=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','kingProtection','pieceSupport','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const p11=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingProtection','kingFreedom','center','minorCentral','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,o){C.push({name,order:o});}add('p10',p10.slice());add('p11',p11.slice());
for(const [bn,b] of [['p10',p10],['p11',p11]]){
 for(const pos of[2,3,4,5,8,9,10,11,12]){const o=b.slice();o.splice(pos,0,'captureNow');add(bn+'_capture_p'+pos,o);}
 for(const pos of[2,3,4,9,10,11]){const o=b.slice();o.splice(pos,0,'captureNow','lowValueCaptor');add(bn+'_caplow_p'+pos,o);}
}
console.log('CAPTURE SUPPORT SCREEN',C.length,'x 20');const s=C.map(cfg=>({cfg,r:test(cfg,20,82000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('CAPTURE SUPPORT CONFIRM top 8 x 60');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,60,84000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('CAPTURE SUPPORT FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,88000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
