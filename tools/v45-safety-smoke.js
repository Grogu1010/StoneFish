const fs = require('fs');
const files = [
  'StonefishChess.js',
  'Stonefish_v3.js',
  'Stonefish_v4.js',
  'Stonefish_v4_5.js',
  'Stonefish_v4_5_opening_overrides.js',
  'Stonefish_v4_5_safety_patch.js'
];
const src = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');

const harness = String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
function cheapDraw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function play(seed){
  const g=new Chess();
  const v45White=(seed&1)===0;
  const r4=seeded(0x9e3779b9^(seed*0x45d9f3b));
  const r45=seeded(0x85ebca6b^(seed*0x27d4eb2d));
  for(let ply=0;ply<1000;ply++){
    const is45=(g.turn()==='w')===v45White;
    const old=Math.random; Math.random=is45?r45:r4;
    const m=is45?getStonefishV45Move(g):getStonefishV4Move(g);
    Math.random=old;
    if(!m){if(!g.in_check())return'D';const whiteWon=g.turn()==='b';return whiteWon===v45White?'W':'L';}
    g._applyRaw(m._raw,true);
    if(cheapDraw(g))return'D';
  }
  return'D';
}
function test(n,start){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(start+i);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D};}
for(const block of [31000,32000,33000]) console.log('BLOCK',block,test(100,block));
console.log('TOTAL',test(300,41000));
`;
new Function(src + '\n' + harness)();
