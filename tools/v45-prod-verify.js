const fs=require('fs');
const files=['StonefishChess.js','Stonefish_v3.js','Stonefish_v4.js','Stonefish_v4_5.js','Stonefish_v4_5_opening_overrides.js','Stonefish_v4_5_safety_patch.js'];
const src=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
const models={control:g=>getStonefishV4Move(g),prod:g=>getStonefishV45Move(g)};
function play(seed,key,modelWhite){const g=new Chess();const rng=seeded((0x9e3779b9^(seed*0x45d9f3b))>>>0);for(let ply=0;ply<1000;ply++){const whiteTurn=g.turn()==='w',isModel=whiteTurn===modelWhite;const old=Math.random;Math.random=rng;const m=isModel?models[key](g):getStonefishV4Move(g);Math.random=old;if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===modelWhite?'W':'L';}g._applyRaw(m._raw,true);if(cheapDraw(g))return'D';}return'D';}
function test(key,n=1000,start=401000){let Ww=0,Lw=0,Dw=0,Wb=0,Lb=0,Db=0;for(let i=0;i<n;i++){let r=play(start+i,key,true);if(r==='W')Ww++;else if(r==='L')Lw++;else Dw++;r=play(start+i,key,false);if(r==='W')Wb++;else if(r==='L')Lb++;else Db++;}return{white:{W:Ww,L:Lw,D:Dw},black:{W:Wb,L:Lb,D:Db},total:{W:Ww+Wb,L:Lw+Lb,D:Dw+Db},score:(Ww+Wb+0.5*(Dw+Db))/(2*n)};}
for(const k of Object.keys(models))console.log(k,JSON.stringify(test(k)));
`;
new Function(src+'\n'+harness)();
