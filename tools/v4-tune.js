const fs=require('fs');
const engine=fs.readFileSync('StonefishChess.js','utf8');
const v3=fs.readFileSync('Stonefish_v3.js','utf8');
const harness=String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const CENTER=[27,28,35,36],V=[0,1,3,3.1,5,9,0];
function npm(g,s){let n=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(p&&(p>0?1:-1)===s)n+=V[Math.abs(p)]||0;}return n;}
function eg(g,s){return npm(g,s)<=10;}
function dev(g,s){const b=g.boardState,n=s===1?[1,6]:[57,62],bb=s===1?[2,5]:[58,61];let z=0;for(let q=0;q<64;q++){if(b[q]===s*2&&q!==n[0]&&q!==n[1])z+=2;if(b[q]===s*3&&q!==bb[0]&&q!==bb[1])z+=2;}return z;}
function kfree(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k];let z=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const t=nr*8+nf,x=b[t];if(x&&(x>0?1:-1)===s)continue;b[k]=0;b[t]=kp;const safe=!g._isAttacked(t,-s);b[k]=kp;b[t]=x;if(safe)z++;}return z;}
function kprot(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k];let z=0;b[k]=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const q=nr*8+nf,p=b[q];if(p&&(p>0?1:-1)===s)z+=Math.abs(p)===1?3:2;if(g._isAttacked(q,s))z++;}b[k]=kp;return z;}
function center(g,s){let z=0;for(const q of CENTER){const p=g.boardState[q];if(p&&(p>0?1:-1)===s)z+=2;if(g._isAttacked(q,s))z++;}return z;}
function minor(g,s){let z=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(p!==s*2&&p!==s*3)continue;const f=q&7,r=q>>3;if(CENTER.includes(q))z+=4;else if(f>=2&&f<=5&&r>=2&&r<=5)z+=2;else if(!(f===0||f===7||r===0||r===7))z++;}return z;}
function pawnStruct(g,s){const b=g.boardState,F=new Array(8).fill(0);for(let q=0;q<64;q++)if(b[q]===s)F[q&7]++;let z=0;for(let f=0;f<8;f++){if(F[f]>1)z-=2*(F[f]-1);if(F[f]&&(f===0||!F[f-1])&&(f===7||!F[f+1]))z--;}return z;}
function rook(g,s){const b=g.boardState;let z=0;for(let q=0;q<64;q++)if(b[q]===s*4){const f=q&7,r=q>>3;let own=false;for(let rr=0;rr<8;rr++)if(b[rr*8+f]===s)own=true;if(!own)z+=2;if((s===1&&r===6)||(s===-1&&r===1))z+=2;}return z;}
function kplace(g,s){const k=g.kingSq[s],f=k&7,r=k>>3;if(eg(g,s))return 7-Math.abs(f-3.5)-Math.abs(r-3.5);const a=s===1?2:58,b=s===1?6:62,h=s===1?4:60;return(k===a||k===b)?3:(k===h?1:0);}
function pprog(g,s){if(!eg(g,s))return 0;let z=0;for(let q=0;q<64;q++)if(g.boardState[q]===s){const r=q>>3;z+=s===1?r-1:6-r;}return z;}
function control(g,s){let z=0;for(let q=0;q<64;q++)if(g._isAttacked(q,s))z++;return z;}
function ownDef(g,s,q){return g._isAttacked(q,s);}
function oppAtk(g,s,q){return g._isAttacked(q,-s);}
function hangingMax(g,s){let m=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(!p||(p>0?1:-1)!==s||Math.abs(p)===6)continue;if(oppAtk(g,s,q)&&!ownDef(g,s,q))m=Math.max(m,V[Math.abs(p)]||0);}return-m;}
function immediateCaptureRisk(g){let worst=0;const replies=g.fastMoves();for(let i=0;i<replies.length;i++){const v=V[replies[i].captured]||0;if(v>worst)worst=v;}return-worst;}
function feature(g,m,c){if(c==='promotion')return m.promotion||0;if(c==='castleNow')return(m.flags&12)?1:0;if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;g.fastApply(m);const s=-g.side;let z=0;if(c==='openingDevelop')z=g.fullmove<=13?dev(g,s):0;else if(c==='hangingMax')z=hangingMax(g,s);else if(c==='captureSafety')z=immediateCaptureRisk(g);else if(c==='queenDiscipline'){if(g.fullmove<=10){const h=s===1?3:59;z=g.boardState[h]===s*5?1:0;}}else if(c==='repetitionAvoid')z=-(g.positionCounts.get(g.fastPositionKey())||0);else if(c==='endgamePawnProgress')z=pprog(g,s);else if(c==='endgameCheck')z=eg(g,s)&&g.in_check()?1:0;else if(c==='mobility')z=g.fastMobility(s);else if(c==='pieceSupport')z=ownDef(g,s,m.to)?1:0;else if(c==='kingFreedom')z=kfree(g,s);else if(c==='center')z=center(g,s);else if(c==='minorCentral')z=minor(g,s);else if(c==='kingProtection')z=kprot(g,s);else if(c==='pawnStructure')z=pawnStruct(g,s);else if(c==='rookActivity')z=rook(g,s);else if(c==='kingPlacement')z=kplace(g,s);else if(c==='boardControl')z=control(g,s);g.fastUndo();return z;}
function choose3(g,r){const a=getStonefishV3BestRawMoves(g);return a.length?a[Math.floor(r()*a.length)]:null;}
function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;for(const c of cfg.order){if(a.length<=1)break;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);}return a[Math.floor(r()*a.length)];}
function draw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function play(cfg,n,max=1000){const g=new Chess(),vw=(n&1)===0,r3=seeded(0x9e3779b9^(n*0x45d9f3b)),r4=seeded(0x85ebca6b^(n*0x27d4eb2d));for(let p=0;p<max;p++){const vt=(g.turn()==='w')===vw,m=vt?choose4(g,r4,cfg):choose3(g,r3);if(!m){if(!g.in_check())return'D';const ww=g.turn()==='b';return ww===vw?'W':'L';}g._applyRaw(m,true);if(draw(g))return'D';}return'D';}
function test(cfg,n,start){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(cfg,start+i);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D,games:n,score:W-8*L+.01*D};}
function rank(a,b){return b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W;}
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];let id=0;function add(o,label){C.push({name:(label||'c')+(id++),order:o});}
add(base.slice(),'base');
for(const pos of[1,2,3,4,5,6,7,8,9,10,11,12,13]){const o=base.slice();o.splice(pos,0,'captureSafety');add(o);}
for(const pos of[1,2,3,4,5,8,9,10]){const o=base.filter(x=>x!=='hangingMax');o.splice(pos,0,'captureSafety');add(o,'replace');}
for(const pos of[2,3,4,5,8,9]){const o=base.filter(x=>x!=='hangingMax');o.splice(pos,0,'captureSafety','hangingMax');add(o,'ch');const p=base.filter(x=>x!=='hangingMax');p.splice(pos,0,'hangingMax','captureSafety');add(p,'hc');}
console.log('CAPTURE SAFETY SCREEN',C.length,'x 16');const s=C.map(cfg=>({cfg,r:test(cfg,16,11000)})).sort(rank);for(const x of s.slice(0,12))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('CONFIRM top 8 x 50');const c=s.slice(0,8).map(x=>({cfg:x.cfg,r:test(x.cfg,50,14000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('FINAL top 4 x 100');const f=c.slice(0,4).map(x=>({cfg:x.cfg,r:test(x.cfg,100,18000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
new Function(engine+'\n'+v3+'\n'+harness)();
