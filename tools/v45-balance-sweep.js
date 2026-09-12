const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function candidate(g,opts){
  let c=getStonefishV3BestRawMoves(g).slice(); if(!c.length)return null;
  for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){
    const k=STONEFISH_V4_ORDER[i];
    if(i===opts.bookAt && Math.random()<opts.bookUse){const b=stonefishV45BookMove(g,0,c);if(b)return stonefishV3PublicMove(g,b);}
    if(k==='mobility'&&opts.inv==='beforeCheck'){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');}
    if(k==='mobility'&&opts.inv==='beforeBoth'){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}
    c=stonefishV4BestByCriterion(g,c,k);
    if(i===11&&c.length>1)c=stonefishV45StrictPatternTieBreak(g,c);
  }
  return pub(g,c);
}
const strong={bookAt:5,bookUse:1,inv:'beforeBoth'};
const weak={bookAt:5,bookUse:.40,inv:'beforeCheck'};
function optsFor(seed,strongPct){return ((seed%100)<strongPct)?strong:weak;}
function play(seed,strongPct,modelWhite){const g=new Chess();const rng=seeded(seed);const old=Math.random;Math.random=rng;const opts=optsFor(seed,strongPct);try{for(let p=0;p<1000;p++){const isModel=(g.turn()==='w')===modelWhite;const m=isModel?candidate(g,opts):getStonefishV4Move(g);if(!m){if(!g.in_check())return'D';const ww=g.turn()==='b';return ww===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}finally{Math.random=old;}}
function test(strongPct,n=1000,start=181000){let W=0,L=0,D=0;for(let i=0;i<n;i++){for(const white of [true,false]){const r=play(start+i,strongPct,white);if(r==='W')W++;else if(r==='L')L++;else D++;}}return{W,L,D,wp:(100*W/(2*n)).toFixed(1),lp:(100*L/(2*n)).toFixed(1),dp:(100*D/(2*n)).toFixed(1)};}
for(const p of [45,50,55,60,65,70]) console.log('mix'+p,JSON.stringify(test(p)));
`;
new Function(src+'\n'+harness)();
