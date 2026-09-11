const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const M=['promotion','castleNow','openingDevelop','hangingMax','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const cfg={name:'M',order:M};
function sq(q){return 'abcdefgh'[q&7]+String((q>>3)+1);}function ml(m){return sq(m.from)+sq(m.to)+(m.promotion?('='+m.promotion):'');}
function choose4Diag(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;const t={start:a.length,steps:[]};for(const c of cfg.order){if(a.length<=1)break;const before=a.length;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);if(a.length<before)t.steps.push(c+':'+before+'>'+a.length);}const raw=a[Math.floor(r()*a.length)];t.final=a.length;return{raw,t};}
function playDiag(n,max=1000){const g=new Chess(),vw=(n&1)===0,vs=vw?1:-1,r3=seeded(0x9e3779b9^(n*0x45d9f3b)),r4=seeded(0x85ebca6b^(n*0x27d4eb2d)),dec=[];for(let p=0;p<max;p++){const vt=(g.turn()==='w')===vw;if(vt){const d=choose4Diag(g,r4,cfg);if(!d){return{result:g.in_check()?'L':'D',dec,fen:g.fen()};}const lead0=npm(g,vs)-npm(g,-vs),name=ml(d.raw),fen0=g.fen();g._applyRaw(d.raw,true);const lead1=npm(g,vs)-npm(g,-vs);dec.push({ply:p+1,move:name,lead0:+lead0.toFixed(1),lead1:+lead1.toFixed(1),cand:d.t.start,steps:d.t.steps.join(','),fen:fen0});}else{const m=choose3(g,r3);if(!m){if(!g.in_check())return{result:'D',dec,fen:g.fen()};const ww=g.turn()==='b';return{result:ww===vw?'W':'L',dec,fen:g.fen()};}g._applyRaw(m,true);}if(draw(g))return{result:'D',dec,fen:g.fen()};}return{result:'D',dec,fen:g.fen()};}
for(const seed of[90004,90006,90029,90030,90099]){const r=playDiag(seed);console.log('SEED',seed,'RESULT',r.result,'FINAL',r.fen);const interesting=r.dec.filter(x=>x.cand>1||x.lead1!==x.lead0);for(const x of interesting.slice(-18))console.log(' ',x.ply,x.move,'lead',x.lead0+'>'+x.lead1,'cand',x.cand,x.steps,'FEN',x.fen);}
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
