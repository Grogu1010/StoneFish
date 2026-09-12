const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function pub(g,c){const r=stonefishV3RandomRaw(c);return r?stonefishV3PublicMove(g,r):null;}
const profiles={
  canonical:{},
  mild:{engine:0.80,mainline:0.82,rare:1.65,dynamic:1.18},
  medium:{engine:0.62,mainline:0.65,rare:2.40,dynamic:1.35,tactical:1.10},
  offbeat:{engine:0.45,mainline:0.48,rare:3.50,dynamic:1.60,tactical:1.18,solid:0.92},
  rareHeavy:{engine:0.30,mainline:0.32,rare:5.00,dynamic:1.85,tactical:1.25,solid:0.85},
  veryRare:{engine:0.20,mainline:0.22,rare:7.50,dynamic:2.10,tactical:1.35,solid:0.78}
};
const configs={
  can_engine:{profile:'canonical',mode:'engine'},
  mild_engine:{profile:'mild',mode:'engine'},
  med_engine:{profile:'medium',mode:'engine'},
  off_engine:{profile:'offbeat',mode:'engine'},
  rare_engine:{profile:'rareHeavy',mode:'engine'},
  vr_engine:{profile:'veryRare',mode:'engine'},
  med_both:{profile:'medium',mode:'both'},
  off_both:{profile:'offbeat',mode:'both'},
  rare_both:{profile:'rareHeavy',mode:'both'},
  vr_both:{profile:'veryRare',mode:'both'}
};
let ACTIVE={};
stonefishV45ProfileWeight=function(line,profileIndex){let v=line.weight;for(const tag of line.tags){const m=ACTIVE[tag];if(m)v*=m;}return v;};
function chosenLine(g){const map=STONEFISH_V45_BOOK_STATE.get(g);if(!map)return null;const state=map.get('0:'+g.turn());if(!state)return null;return STONEFISH_V45_OPENINGS.find(x=>x.id===state.lineId)||null;}
function lineQualifies(line,mode){if(!line)return false;const e=line.tags.includes('engine'),m=line.tags.includes('mainline');return mode==='both'?(e&&m):e;}
function candidate(g,cfg){let c=getStonefishV3BestRawMoves(g).slice();if(!c.length)return null;for(let i=0;i<STONEFISH_V4_ORDER.length&&c.length>1;i++){const k=STONEFISH_V4_ORDER[i];if(i===5){const b=stonefishV45BookMove(g,0,c);if(b)return stonefishV3PublicMove(g,b);}if(k==='mobility'&&c.length>1){c=stonefishV45BestByInverse(g,c,'oppCheckRisk');if(c.length>1&&lineQualifies(chosenLine(g),cfg.mode))c=stonefishV45BestByInverse(g,c,'oppMobility');}c=stonefishV4BestByCriterion(g,c,k);if(i===11&&c.length>1)c=stonefishV45StrictPatternTieBreak(g,c);}return pub(g,c);}
function game(cfg,modelWhite){const g=new Chess();for(let p=0;p<1000;p++){const model=(g.turn()==='w')===modelWhite;const m=model?candidate(g,cfg):getStonefishV4Move(g);if(!m){if(!g.in_check())return'D';return ((g.turn()==='b')===modelWhite)?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function test(key,n=3000){const cfg=configs[key];ACTIVE=profiles[cfg.profile];let W=0,L=0,D=0,wW=0,wL=0,wD=0,bW=0,bL=0,bD=0;for(let i=0;i<n;i++){const mw=(i%2)===0;const r=game(cfg,mw);if(r==='W'){W++;if(mw)wW++;else bW++;}else if(r==='L'){L++;if(mw)wL++;else bL++;}else{D++;if(mw)wD++;else bD++;}}return{W,L,D,wp:(100*W/n).toFixed(1),lp:(100*L/n).toFixed(1),dp:(100*D/n).toFixed(1),white:[wW,wL,wD],black:[bW,bL,bD]};}
for(const k of Object.keys(configs))console.log(k,JSON.stringify(test(k)));
`;
new Function(src+'\n'+harness)();
