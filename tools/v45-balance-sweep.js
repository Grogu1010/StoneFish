const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
function candidate(g,o){let c=getStonefishV3BestRawMoves(g).slice();if(!c.length)return null;for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){const k=STONEFISH_V4_ORDER[i];if(i===o.bookAt){const b=stonefishV45BookMove(g,0,c);if(b)return stonefishV3PublicMove(g,b);}if(k==='mobility'){if(o.beforeCheck)c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(o.beforeMob&&c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}c=stonefishV4BestByCriterion(g,c,k);if(k==='mobility'){if(o.afterCheck&&c.length>1)c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(o.afterMob&&c.length>1)c=stonefishV45BestByInverse(g,c,'oppMobility');}if(i===o.patternAfter&&c.length>1)c=stonefishV45StrictPatternTieBreak(g,c);}return pub(g,c);}
const cfgs={
strong:{bookAt:5,beforeCheck:1,beforeMob:1,patternAfter:11},
noOppMob:{bookAt:5,beforeCheck:1,patternAfter:11},
noOppCheck:{bookAt:5,beforeMob:1,patternAfter:11},
invAfterBoth:{bookAt:5,afterCheck:1,afterMob:1,patternAfter:11},
invAfterCheck:{bookAt:5,afterCheck:1,patternAfter:11},
invAfterMob:{bookAt:5,afterMob:1,patternAfter:11},
bookAfterMob_both:{bookAt:6,beforeCheck:1,beforeMob:1,patternAfter:11},
bookAfterMob_check:{bookAt:6,beforeCheck:1,patternAfter:11},
bookAfterQueen_both:{bookAt:7,beforeCheck:1,beforeMob:1,patternAfter:11},
openingOnly:{bookAt:5,patternAfter:11},
inverseOnly:{bookAt:-1,beforeCheck:1,beforeMob:1,patternAfter:11},
latePattern:{bookAt:5,beforeCheck:1,beforeMob:1,patternAfter:15}
};
function game(key,modelWhite,rng){const g=new Chess();const old=Math.random;Math.random=rng;try{for(let p=0;p<1000;p++){const model=(g.turn()==='w')===modelWhite;const m=model?candidate(g,cfgs[key]):getStonefishV4Move(g);if(!m){if(!g.in_check())return'D';return ((g.turn()==='b')===modelWhite)?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}finally{Math.random=old;}}
function test(key,n=1200,seed=301001){const rng=seeded(seed);let W=0,L=0,D=0,wW=0,wL=0,wD=0,bW=0,bL=0,bD=0;for(let i=0;i<n;i++){const mw=(i%2)===0;const r=game(key,mw,rng);if(r==='W'){W++;if(mw)wW++;else bW++;}else if(r==='L'){L++;if(mw)wL++;else bL++;}else{D++;if(mw)wD++;else bD++;}}return{W,L,D,wp:(100*W/n).toFixed(1),lp:(100*L/n).toFixed(1),dp:(100*D/n).toFixed(1),white:[wW,wL,wD],black:[bW,bL,bD]};}
for(const k of Object.keys(cfgs))console.log(k,JSON.stringify(test(k)));
`;
new Function(src+'\n'+harness)();
