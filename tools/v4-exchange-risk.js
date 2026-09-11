const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function immediateCaptureRisk(g){",String.raw`function badExchangeRisk(g){let worst=0;const replies=g.fastMoves();for(let i=0;i<replies.length;i++){const m=replies[i];if(!m.captured)continue;const margin=(V[m.captured]||0)-(V[m.piece]||0);if(margin>worst)worst=margin;}return-worst;}
function immediateCaptureRisk(g){`);
src=src.replace("else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='captureSafety')z=immediateCaptureRisk(g);", "else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='badExchangeRisk')z=badExchangeRisk(g);else if(c==='captureSafety')z=immediateCaptureRisk(g);");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];function add(name,o){C.push({name,order:o});}
function ins(o,pos){o=o.filter(x=>x!=='badExchangeRisk');o.splice(pos,0,'badExchangeRisk');return o;}
function mobilityEarly(o){o=o.filter(x=>x!=='mobility');const h=o.indexOf('hangingMax');o.splice(h+1,0,'mobility');return o;}
add('base',base.slice());
for(const pos of[3,4,5,6,8,9,10,11,12])add('B'+pos,ins(base.slice(),pos));
const m=mobilityEarly(base.slice());add('M',m);for(const pos of[4,5,6,7,9,10,11,12])add('MB'+pos,ins(m.slice(),pos));
console.log('EXCHANGE RISK',C.length,'x 100 fresh games');const f=C.map(cfg=>({cfg,r:test(cfg,100,65000)})).sort((a,b)=>a.r.L-b.r.L||b.r.W-a.r.W);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
