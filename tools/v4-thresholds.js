const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function control(g,s){",String.raw`function egAt(g,s,lim){return npm(g,s)<=lim;}
function pprogAt(g,s,lim){if(!egAt(g,s,lim))return 0;let z=0;for(let q=0;q<64;q++)if(g.boardState[q]===s){const r=q>>3;z+=s===1?r-1:6-r;}return z;}
function kplaceAt(g,s,lim){const k=g.kingSq[s],f=k&7,r=k>>3;if(egAt(g,s,lim))return 7-Math.abs(f-3.5)-Math.abs(r-3.5);const a=s===1?2:58,b=s===1?6:62,h=s===1?4:60;return(k===a||k===b)?3:(k===h?1:0);}
function control(g,s){`);
src=src.replace("if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;", "if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;if(c.startsWith('fiftyReset@'))return g.halfmove>=Number(c.split('@')[1])&&(m.piece===1||m.captured)?1:0;");
src=src.replace("if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;", "if(c.startsWith('openingDevelop@'))z=g.fullmove<=Number(c.split('@')[1])?dev(g,s):0;else if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;");
src=src.replace("else if(c==='queenDiscipline'){if(g.fullmove<=10){const h=s===1?3:59;z=g.boardState[h]===s*5?1:0;}}", "else if(c.startsWith('queenDiscipline@')){const lim=Number(c.split('@')[1]);if(g.fullmove<=lim){const h=s===1?3:59;z=g.boardState[h]===s*5?1:0;}}else if(c==='queenDiscipline'){if(g.fullmove<=10){const h=s===1?3:59;z=g.boardState[h]===s*5?1:0;}}");
src=src.replace("else if(c==='endgamePawnProgress')z=pprog(g,s);", "else if(c.startsWith('endgamePawnProgress@'))z=pprogAt(g,s,Number(c.split('@')[1]));else if(c==='endgamePawnProgress')z=pprog(g,s);");
src=src.replace("else if(c==='endgameCheck')z=eg(g,s)&&g.in_check()?1:0;", "else if(c.startsWith('endgameCheck@'))z=egAt(g,s,Number(c.split('@')[1]))&&g.in_check()?1:0;else if(c==='endgameCheck')z=eg(g,s)&&g.in_check()?1:0;");
src=src.replace("else if(c==='center')z=center(g,s);", "else if(c.startsWith('midCenter@'))z=egAt(g,s,Number(c.split('@')[1]))?0:center(g,s);else if(c==='center')z=center(g,s);");
src=src.replace("else if(c==='kingPlacement')z=kplace(g,s);", "else if(c.startsWith('kingPlacement@'))z=kplaceAt(g,s,Number(c.split('@')[1]));else if(c==='kingPlacement')z=kplace(g,s);");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];function add(name,o){C.push({name,order:o});}
function replace(o,from,to){return o.map(x=>x===from?to:x);}
add('base',base.slice());
for(const n of[8,10,11,12,13,14,16,18])add('open'+n,replace(base.slice(),'openingDevelop','openingDevelop@'+n));
for(const n of[6,8,9,10,11,12,14,16])add('queen'+n,replace(base.slice(),'queenDiscipline','queenDiscipline@'+n));
for(const n of[30,40,50,60,70,80,90])add('fifty'+n,replace(base.slice(),'fiftyReset','fiftyReset@'+n));
for(const n of[6,8,10,12,14,16,18,20,24]){let o=replace(base.slice(),'endgamePawnProgress','endgamePawnProgress@'+n);o=replace(o,'endgameCheck','endgameCheck@'+n);o=replace(o,'kingPlacement','kingPlacement@'+n);add('eg'+n,o);let p=replace(o,'center','midCenter@'+n);add('egMid'+n,p);}
console.log('THRESHOLDS',C.length,'x 100 fresh games');const f=C.map(cfg=>({cfg,r:test(cfg,100,80000)})).sort((a,b)=>a.r.L-b.r.L||b.r.W-a.r.W);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
