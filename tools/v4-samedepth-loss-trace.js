const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');

// SAME DEPTH ONLY. Add the current best repetition-conversion rule.
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){
  g.fastApply(m);
  const s=-g.side;
  const visits=g.positionCounts.get(g.fastPositionKey())||0;
  const lead=npm(g,s)-npm(g,-s);
  g.fastUndo();
  if(visits<visitLimit)return 1;
  return lead>=leadMin?0:1;
}
function feature(g,m,c){
  if(c.startsWith('rep2Lead@'))return repByLead(g,m,1,Number(c.split('@')[1]));
`);

const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const ORDER=['promotion','castleNow','openingDevelop','hangingMax','rep2Lead@2.5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const cfg={name:'rep2_2.5',order:ORDER};
function leadFor(g,s){return npm(g,s)-npm(g,-s);}
function sq(s){return 'abcdefgh'[s&7]+String((s>>3)+1);}
function mvText(m){return sq(m.from)+sq(m.to)+(m.promotion?('='+m.promotion):'')+(m.captured?('x'+m.captured):'');}
function choose4Trace(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();const root=a.length,reducers=[];if(!a.length)return{m:null,root,reducers};for(const c of cfg.order){if(a.length<=1)break;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}const before=a.length;a=a.filter((_,i)=>S[i]===best);if(a.length<before)reducers.push(c+':'+before+'>'+a.length+'@'+best);}return{m:a[Math.floor(r()*a.length)],root,reducers};}
function playSeed(seed,trace){const g=new Chess(),vw=(seed&1)===0,vSide=vw?1:-1,r3=seeded(0x9e3779b9^(seed*0x45d9f3b)),r4=seeded(0x85ebca6b^(seed*0x27d4eb2d));const hist=[];let firstNeg3=-1;for(let p=0;p<1000;p++){const vt=(g.turn()==='w')===vw,before=leadFor(g,vSide);let m,meta=null;if(vt){meta=choose4Trace(g,r4,cfg);m=meta.m;}else m=choose3(g,r3);if(!m){if(!g.in_check())return{result:'D',hist,firstNeg3};const ww=g.turn()==='b';return{result:ww===vw?'W':'L',hist,firstNeg3};}const row={ply:p+1,who:vt?'V4':'V3',move:mvText(m),before,root:meta?meta.root:null,reducers:meta?meta.reducers:[]};g._applyRaw(m,true);row.after=leadFor(g,vSide);hist.push(row);if(firstNeg3<0&&row.after<=-3)firstNeg3=hist.length-1;if(draw(g))return{result:'D',hist,firstNeg3};}return{result:'D',hist,firstNeg3};}
const losses=[];let W=0,L=0,D=0;for(let i=0;i<100;i++){const seed=90000+i,r=playSeed(seed,false);if(r.result==='W')W++;else if(r.result==='L'){L++;losses.push(seed);}else D++;}console.log('TRACE BASE',{W,L,D},'losses',losses);
for(const seed of losses){const r=playSeed(seed,true);console.log('\nLOSS-SEED',seed,'firstNeg3Index',r.firstNeg3);const ix=r.firstNeg3>=0?r.firstNeg3:r.hist.length-1;const from=Math.max(0,ix-12),to=Math.min(r.hist.length,ix+8);for(let i=from;i<to;i++){const e=r.hist[i];console.log('EV',JSON.stringify(e));}console.log('TAIL');for(const e of r.hist.slice(-16))console.log('EV',JSON.stringify(e));}
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
