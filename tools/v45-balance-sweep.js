const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function play(seed,modelWhite,useV45){const g=new Chess();const moveRng=seeded(seed);const modeRng=seeded((seed^0xA5A5A5A5)>>>0);const old=Math.random;const oldMode=STONEFISH_V45_MODE_RANDOM;Math.random=moveRng;STONEFISH_V45_MODE_RANDOM=modeRng;try{for(let p=0;p<1000;p++){const isModel=(g.turn()==='w')===modelWhite;const m=isModel?(useV45?getStonefishV45Move(g):getStonefishV4Move(g)):getStonefishV4Move(g);if(!m){if(!g.in_check())return'D';const ww=g.turn()==='b';return ww===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}finally{Math.random=old;STONEFISH_V45_MODE_RANDOM=oldMode;}}
function test(useV45,n,start){let W=0,L=0,D=0,wW=0,wL=0,wD=0,bW=0,bL=0,bD=0;for(let i=0;i<n;i++){let r=play(start+i,true,useV45);if(r==='W'){W++;wW++;}else if(r==='L'){L++;wL++;}else{D++;wD++;}r=play(start+i,false,useV45);if(r==='W'){W++;bW++;}else if(r==='L'){L++;bL++;}else{D++;bD++;}}const total=2*n;return{W,L,D,wp:(100*W/total).toFixed(2),lp:(100*L/total).toFixed(2),dp:(100*D/total).toFixed(2),white:{W:wW,L:wL,D:wD},black:{W:bW,L:bL,D:bD}};}
console.log('control',JSON.stringify(test(false,1000,231000)));
console.log('production60',JSON.stringify(test(true,5000,241000)));
`;
new Function(src+'\n'+harness)();
