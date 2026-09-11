const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function control(g,s){",String.raw`function passedPawns(g,s){const b=g.boardState;let z=0;for(let q=0;q<64;q++){if(b[q]!==s)continue;const f=q&7,r=q>>3;let passed=true;for(let df=-1;df<=1;df++){const nf=f+df;if(nf<0||nf>7)continue;if(s===1){for(let rr=r+1;rr<8;rr++)if(b[rr*8+nf]===-1)passed=false;}else{for(let rr=r-1;rr>=0;rr--)if(b[rr*8+nf]===1)passed=false;}}if(passed){const progress=s===1?r-1:6-r;z+=2+progress;}}return z;}
function connectedPawns(g,s){const b=g.boardState;let z=0;for(let q=0;q<64;q++){if(b[q]!==s)continue;const f=q&7,r=q>>3;for(const df of[-1,1]){const nf=f+df;if(nf<0||nf>7)continue;for(const dr of[-1,1]){const nr=r+dr;if(nr>=0&&nr<8&&b[nr*8+nf]===s){z++;dr;}}}}return z;}
function endgameKingCenter(g,s){if(!eg(g,s))return 0;const k=g.kingSq[s],f=k&7,r=k>>3;return 7-Math.abs(f-3.5)-Math.abs(r-3.5);}
function control(g,s){`);
src=src.replace("else if(c==='endgamePawnProgress')z=pprog(g,s);", "else if(c==='endgamePawnProgress')z=pprog(g,s);else if(c==='passedPawns')z=eg(g,s)?passedPawns(g,s):0;else if(c==='connectedPawns')z=eg(g,s)?connectedPawns(g,s):0;else if(c==='endgameKingCenter')z=endgameKingCenter(g,s);");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];let id=0;function add(o,label){C.push({name:(label||'e')+(id++),order:o});}
add(base.slice(),'base');
for(const rule of ['passedPawns','connectedPawns','endgameKingCenter'])for(const pos of[7,8,9,10,11,12,14,16]){const o=base.slice();o.splice(pos,0,rule);add(o,rule+'_');}
for(const combo of[['passedPawns','endgameKingCenter'],['passedPawns','connectedPawns'],['passedPawns','connectedPawns','endgameKingCenter']])for(const pos of[7,8,9,10,12]){const o=base.slice();o.splice(pos,0,...combo);add(o,'combo_');}
console.log('ENDGAME SCREEN',C.length,'x 24');const s=C.map(cfg=>({cfg,r:test(cfg,24,42000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('FINAL top 6 x 100');const f=s.slice(0,6).map(x=>({cfg:x.cfg,r:test(x.cfg,100,46000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
