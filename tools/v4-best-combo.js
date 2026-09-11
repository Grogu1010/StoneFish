const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function control(g,s){",String.raw`function kingPawnShield(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3;let z=0;for(const df of[-1,0,1]){const nf=f+df;if(nf<0||nf>7)continue;for(const d of[1,2]){const nr=r+s*d;if(nr<0||nr>7)continue;if(b[nr*8+nf]===s)z+=d===1?2:1;}}return z;}
function passedPawns(g,s){const b=g.boardState;let z=0;for(let q=0;q<64;q++){if(b[q]!==s)continue;const f=q&7,r=q>>3;let passed=true;for(let df=-1;df<=1;df++){const nf=f+df;if(nf<0||nf>7)continue;if(s===1){for(let rr=r+1;rr<8;rr++)if(b[rr*8+nf]===-1)passed=false;}else{for(let rr=r-1;rr>=0;rr--)if(b[rr*8+nf]===1)passed=false;}}if(passed){const progress=s===1?r-1:6-r;z+=2+progress;}}return z;}
function connectedPawns(g,s){const b=g.boardState;let z=0;for(let q=0;q<64;q++){if(b[q]!==s)continue;const f=q&7,r=q>>3;for(const df of[-1,1]){const nf=f+df;if(nf<0||nf>7)continue;for(const dr of[-1,1]){const nr=r+dr;if(nr>=0&&nr<8&&b[nr*8+nf]===s)z++;}}}return z;}
function endgameKingCenter(g,s){if(!eg(g,s))return 0;const k=g.kingSq[s],f=k&7,r=k>>3;return 7-Math.abs(f-3.5)-Math.abs(r-3.5);}
function control(g,s){`);
src=src.replace("else if(c==='endgamePawnProgress')z=pprog(g,s);", "else if(c==='endgamePawnProgress')z=pprog(g,s);else if(c==='kingPawnShield')z=kingPawnShield(g,s);else if(c==='midCenter')z=eg(g,s)?0:center(g,s);else if(c==='passedPawns')z=eg(g,s)?passedPawns(g,s):0;else if(c==='connectedPawns')z=eg(g,s)?connectedPawns(g,s):0;else if(c==='endgameKingCenter')z=endgameKingCenter(g,s);");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];function add(name,o){C.push({name,order:o});}
function mobilityEarly(o){o=o.filter(x=>x!=='mobility');const h=o.indexOf('hangingMax');o.splice(h+1,0,'mobility');return o;}
function shield(o,where='afterQueen'){o=o.filter(x=>x!=='kingPawnShield');let p;if(where==='afterHanging')p=o.indexOf('hangingMax')+1;else if(where==='afterMobility')p=o.indexOf('mobility')+1;else p=o.indexOf('queenDiscipline')+1;o.splice(p,0,'kingPawnShield');return o;}
function midCenter(o){return o.map(x=>x==='center'?'midCenter':x);}
function endgamePack(o,mode='full'){o=o.filter(x=>!['passedPawns','connectedPawns','endgameKingCenter'].includes(x));const p=o.indexOf('endgamePawnProgress')+1;const a=mode==='king'?['endgameKingCenter']:mode==='passedKing'?['passedPawns','endgameKingCenter']:['passedPawns','connectedPawns','endgameKingCenter'];o.splice(p,0,...a);return o;}
add('base',base.slice());
add('M',mobilityEarly(base.slice()));
add('S',shield(base.slice()));
add('C',midCenter(base.slice()));
add('E',endgamePack(base.slice()));
for(const [name,ops] of [
 ['MS',['M','S']],['MC',['M','C']],['ME',['M','E']],['SC',['S','C']],['SE',['S','E']],['CE',['C','E']],
 ['MSC',['M','S','C']],['MSE',['M','S','E']],['MCE',['M','C','E']],['SCE',['S','C','E']],['MSCE',['M','S','C','E']]
]){let o=base.slice();for(const op of ops){if(op==='M')o=mobilityEarly(o);if(op==='S')o=shield(o);if(op==='C')o=midCenter(o);if(op==='E')o=endgamePack(o);}add(name,o);}
let o=mobilityEarly(base.slice());add('M_shieldAfterHanging',shield(o,'afterHanging'));add('M_shieldAfterMobility',shield(o,'afterMobility'));
o=midCenter(mobilityEarly(base.slice()));add('MC_shieldAfterHanging',shield(o,'afterHanging'));add('MC_shieldAfterMobility',shield(o,'afterMobility'));
o=endgamePack(midCenter(mobilityEarly(base.slice())));add('MCE_shieldAfterHanging',shield(o,'afterHanging'));add('MCE_shieldAfterMobility',shield(o,'afterMobility'));
add('M_kingEnd',endgamePack(mobilityEarly(base.slice()),'king'));add('M_passedKing',endgamePack(mobilityEarly(base.slice()),'passedKing'));
function acceptRank(a,b){const aa=a.r.L<=4?1:0,bb=b.r.L<=4?1:0;if(aa!==bb)return bb-aa;return a.r.L-b.r.L||b.r.W-a.r.W||a.r.D-b.r.D;}
console.log('BEST COMBO',C.length,'x 100 fresh games');const f=C.map(cfg=>({cfg,r:test(cfg,100,60000)})).sort(acceptRank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
