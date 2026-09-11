const fs=require('fs');
const engine=fs.readFileSync('StonefishChess.js','utf8');
const v3=fs.readFileSync('Stonefish_v3.js','utf8');
const baseSource=fs.readFileSync('tools/v4-tune.js','utf8');
const hStart=baseSource.indexOf('function seeded');
const tailStart=baseSource.indexOf('const base=[',hStart);
if(hStart<0||tailStart<0)throw new Error('Harness helpers not found');
const helpers=baseSource.slice(hStart,tailStart);
const harness=String.raw`
${helpers}
const cfg={name:'h3',order:['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl']};
function choose4Diag(g,r,ply,trace){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;const initial=a.length;let decisive='random',lastReducer='none';for(const c of cfg.order){if(a.length<=1)break;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}const kept=a.filter((_,i)=>S[i]===best);if(kept.length<a.length){lastReducer=c;if(kept.length===1)decisive=c;}a=kept;}const raw=a[Math.floor(r()*a.length)];if(initial>1){trace.push({ply,initial,decisive,lastReducer,from:g._alg(raw.from),to:g._alg(raw.to),piece:raw.piece,captured:raw.captured,fen:g.fen()});}return raw;}
function playDiag(n,max=1000){const g=new Chess(),vw=(n&1)===0,r3=seeded(0x9e3779b9^(n*0x45d9f3b)),r4=seeded(0x85ebca6b^(n*0x27d4eb2d)),trace=[];for(let p=0;p<max;p++){const vt=(g.turn()==='w')===vw,m=vt?choose4Diag(g,r4,p,trace):choose3(g,r3);if(!m){if(!g.in_check())return{result:'D',trace};const ww=g.turn()==='b';return{result:ww===vw?'W':'L',trace};}g._applyRaw(m,true);if(draw(g))return{result:'D',trace};}return{result:'D',trace};}
const all={W:[],L:[],D:[]},counts={W:{},L:{},D:{}},late={W:{},L:{},D:{}};
for(let n=100000;n<100100;n++){const x=playDiag(n);all[x.result].push(x);for(const e of x.trace)counts[x.result][e.decisive]=(counts[x.result][e.decisive]||0)+1;for(const e of x.trace.slice(-6))late[x.result][e.decisive]=(late[x.result][e.decisive]||0)+1;}
console.log('RESULTS',{W:all.W.length,L:all.L.length,D:all.D.length});
console.log('ALL_DECISIVE',JSON.stringify(counts));
console.log('LAST6_DECISIVE',JSON.stringify(late));
for(let i=0;i<Math.min(12,all.L.length);i++){const x=all.L[i];console.log('LOSS',i,'last decisions',JSON.stringify(x.trace.slice(-8)));}
`;
new Function(engine+'\n'+v3+'\n'+harness)();
