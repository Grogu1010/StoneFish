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
    if(i===opts.bookAt && Math.random()<opts.bookUse){const b=stonefishV45BookMove(g,opts.profile||0,c);if(b)return stonefishV3PublicMove(g,b);}
    if(k==='mobility'&&opts.inv==='beforeCheck'){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');}
    if(k==='mobility'&&opts.inv==='beforeBoth'){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}
    c=stonefishV4BestByCriterion(g,c,k);
    if(k==='mobility'&&opts.inv==='afterCheck'&&c.length>1)c=stonefishV45BestByInverse(g,c,'oppCheckRisk');
    if(k==='mobility'&&opts.inv==='afterBoth'&&c.length>1){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}
    if(i===opts.patternAfter&&c.length>1)c=stonefishV45StrictPatternTieBreak(g,c);
  }
  return pub(g,c);
}
const cfgs={
  mild25:{bookAt:5,bookUse:.25,inv:'afterCheck',patternAfter:11},
  mild40:{bookAt:5,bookUse:.40,inv:'afterCheck',patternAfter:11},
  mild55:{bookAt:5,bookUse:.55,inv:'afterCheck',patternAfter:11},
  mild70:{bookAt:5,bookUse:.70,inv:'afterCheck',patternAfter:11},
  checkBefore40:{bookAt:5,bookUse:.40,inv:'beforeCheck',patternAfter:11},
  checkBefore55:{bookAt:5,bookUse:.55,inv:'beforeCheck',patternAfter:11},
  late40:{bookAt:7,bookUse:.40,inv:'afterCheck',patternAfter:11},
  late60:{bookAt:7,bookUse:.60,inv:'afterCheck',patternAfter:11},
  noBook:{bookAt:-1,bookUse:0,inv:'afterCheck',patternAfter:11}
};
function play(seed,key,modelWhite){const g=new Chess();const rng=seeded(seed);const old=Math.random;Math.random=rng;try{for(let p=0;p<1000;p++){const isModel=(g.turn()==='w')===modelWhite;const m=isModel?candidate(g,cfgs[key]):getStonefishV4Move(g);if(!m){if(!g.in_check())return'D';const ww=g.turn()==='b';return ww===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}finally{Math.random=old;}}
function test(key,n=600,start=171000){let W=0,L=0,D=0;for(let i=0;i<n;i++){for(const white of [true,false]){const r=play(start+i,key,white);if(r==='W')W++;else if(r==='L')L++;else D++;}}return{W,L,D,score:(W+.5*D)/(2*n)};}
for(const k of Object.keys(cfgs))console.log(k,JSON.stringify(test(k)));
`;
new Function(src+'\n'+harness)();
