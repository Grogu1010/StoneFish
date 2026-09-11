const fs = require('fs');
const engine = fs.readFileSync('StonefishChess.js','utf8');
const v3 = fs.readFileSync('Stonefish_v3.js','utf8');
const harness = String.raw`
function seeded(seed){let x=seed>>>0;return()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return(x>>>0)/4294967296;};}
const CENTER=[27,28,35,36], V=[0,1,3,3.1,5,9,0];
function nonPawnMaterial(g,s){let n=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(p&&(p>0?1:-1)===s)n+=V[Math.abs(p)]||0;}return n;}
function endgame(g,s){return nonPawnMaterial(g,s)<=10;}
function kingFreedom(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k];let z=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const t=nr*8+nf,x=b[t];if(x&&(x>0?1:-1)===s)continue;b[k]=0;b[t]=kp;const safe=!g._isAttacked(t,-s);b[k]=kp;b[t]=x;if(safe)z++;}return z;}
function kingProtection(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k];let z=0;b[k]=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const q=nr*8+nf,p=b[q];if(p&&(p>0?1:-1)===s)z+=Math.abs(p)===1?3:2;if(g._isAttacked(q,s))z++;}b[k]=kp;return z;}
function center(g,s){let z=0;for(const q of CENTER){const p=g.boardState[q];if(p&&(p>0?1:-1)===s)z+=2;if(g._isAttacked(q,s))z++;}return z;}
function development(g,s){const b=g.boardState,n0=s===1?[1,6]:[57,62],b0=s===1?[2,5]:[58,61],dp=s===1?11:51,ep=s===1?12:52;let z=0,dm=false,em=false;for(let q=0;q<64;q++){const p=b[q];if(p===s*2&&q!==n0[0]&&q!==n0[1])z+=2;if(p===s*3&&q!==b0[0]&&q!==b0[1])z+=2;if(p===s){const f=q&7;if(f===3&&q!==dp)dm=true;if(f===4&&q!==ep)em=true;}}if(dm)z++;if(em)z++;return z;}
function minorCentral(g,s){let z=0,b=g.boardState;for(let q=0;q<64;q++){const p=b[q];if(p!==s*2&&p!==s*3)continue;const f=q&7,r=q>>3;if(CENTER.includes(q))z+=4;else if(f>=2&&f<=5&&r>=2&&r<=5)z+=2;else if(!(f===0||f===7||r===0||r===7))z++;}return z;}
function pawnStructure(g,s){const b=g.boardState,F=new Array(8).fill(0),P=[];for(let q=0;q<64;q++)if(b[q]===s){F[q&7]++;P.push(q);}let z=0;for(let f=0;f<8;f++){if(F[f]>1)z-=2*(F[f]-1);if(F[f]&&(f===0||!F[f-1])&&(f===7||!F[f+1]))z--;}for(const q of P){const f=q&7,r=q>>3;for(const df of[-1,1])for(const dr of[-1,1]){const nf=f+df,nr=r+dr;if(nf>=0&&nf<8&&nr>=0&&nr<8&&b[nr*8+nf]===s)z++;}}return z;}
function rookActivity(g,s){const b=g.boardState,R=[];let z=0;for(let q=0;q<64;q++)if(b[q]===s*4)R.push(q);for(const q of R){const f=q&7,r=q>>3;let own=false;for(let rr=0;rr<8;rr++)if(b[rr*8+f]===s)own=true;if(!own)z+=2;if((s===1&&r===6)||(s===-1&&r===1))z+=2;if((s===1&&r>0)||(s===-1&&r<7))z++;}if(R.length===2&&(R[0]>>3)===(R[1]>>3)){let clear=true;for(let q=Math.min(...R)+1;q<Math.max(...R);q++)if(b[q])clear=false;if(clear)z+=3;}return z;}
function kingPlacement(g,s){const k=g.kingSq[s],f=k&7,r=k>>3;if(endgame(g,s))return 7-Math.abs(f-3.5)-Math.abs(r-3.5);const c1=s===1?2:58,c2=s===1?6:62,h=s===1?4:60;return(k===c1||k===c2)?3:(k===h?1:0);}
function pawnProgress(g,s){if(!endgame(g,s))return 0;let z=0;for(let q=0;q<64;q++)if(g.boardState[q]===s){const r=q>>3;z+=s===1?r-1:6-r;}return z;}
function boardControl(g,s){let z=0;for(let q=0;q<64;q++)if(g._isAttacked(q,s))z++;return z;}
function looseValue(g,s){let z=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(!p||(p>0?1:-1)!==s||Math.abs(p)===6)continue;if(!g._isAttacked(q,s))z+=V[Math.abs(p)]||0;}return -z;}
function defendedValue(g,s){let z=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(!p||(p>0?1:-1)!==s||Math.abs(p)===6)continue;if(g._isAttacked(q,s))z+=V[Math.abs(p)]||0;}return z;}
function kingPawnShield(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3;let z=0;for(const df of[-1,0,1]){const nf=f+df;if(nf<0||nf>7)continue;for(const d of[1,2]){const nr=r+s*d;if(nr<0||nr>7)continue;if(b[nr*8+nf]===s)z+=d===1?2:1;}}return z;}
function castlingStatus(g,s){const k=g.kingSq[s],c1=s===1?2:58,c2=s===1?6:62;if(k===c1||k===c2)return 3;const rights=s===1?(g.castling&3):(g.castling&12);return rights?1:0;}
function queenSupport(g,s){let q=-1;for(let i=0;i<64;i++)if(g.boardState[i]===s*5){q=i;break;}return q>=0&&g._isAttacked(q,s)?1:0;}
function feature(g,m,c){if(c==='promotion')return m.promotion||0;if(c==='castleNow')return(m.flags&12)?1:0;if(c==='check')return g.fastGivesCheck(m)?1:0;if(c==='endgameCheck')return endgame(g,g.side)&&g.fastGivesCheck(m)?1:0;if(c==='fiftyReset')return g.halfmove>=60&&(m.piece===1||m.captured)?1:0;g.fastApply(m);const s=-g.side;let z=0;if(c==='repetitionAvoid')z=-(g.positionCounts.get(g.fastPositionKey())||0);else if(c==='openingDevelop')z=g.fullmove<=13?development(g,s):0;else if(c==='queenDiscipline'){if(g.fullmove<=10){const h=s===1?3:59;z=g.boardState[h]===s*5?1:0;}}else if(c==='mobility')z=g.fastMobility(s);else if(c==='pieceSupport')z=g._isAttacked(m.to,s)?1:0;else if(c==='kingFreedom')z=kingFreedom(g,s);else if(c==='kingProtection')z=kingProtection(g,s);else if(c==='center')z=center(g,s);else if(c==='minorCentral')z=minorCentral(g,s);else if(c==='pawnStructure')z=pawnStructure(g,s);else if(c==='rookActivity')z=rookActivity(g,s);else if(c==='kingPlacement')z=kingPlacement(g,s);else if(c==='endgamePawnProgress')z=pawnProgress(g,s);else if(c==='boardControl')z=boardControl(g,s);else if(c==='loosePieces')z=looseValue(g,s);else if(c==='defendedMaterial')z=defendedValue(g,s);else if(c==='kingPawnShield')z=kingPawnShield(g,s);else if(c==='castlingStatus')z=castlingStatus(g,s);else if(c==='queenSupport')z=queenSupport(g,s);g.fastUndo();return z;}
function chooseV3(g,r){const m=getStonefishV3BestRawMoves(g);return m.length?m[Math.floor(r()*m.length)]:null;}
function chooseV4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;for(const c of cfg.order){if(a.length<=1)break;let best=-Infinity,S=[];for(let i=0;i<a.length;i++){const s=feature(g,a[i],c);S[i]=s;if(s>best)best=s;}a=a.filter((_,i)=>S[i]===best);}return a[Math.floor(r()*a.length)];}
function draw(g){return g.halfmove>=100||g._insufficientMaterial()||(g.positionCounts.get(g.fastPositionKey())||0)>=3;}
function play(cfg,n,max=500){const g=new Chess(),vw=(n&1)===0,r3=seeded(0x9e3779b9^(n*0x45d9f3b)),r4=seeded(0x85ebca6b^(n*0x27d4eb2d));for(let p=0;p<max;p++){const vt=(g.turn()==='w')===vw,m=vt?chooseV4(g,r4,cfg):chooseV3(g,r3);if(!m){if(!g.in_check())return'D';const ww=g.turn()==='b';return ww===vw?'W':'L';}g._applyRaw(m,true);if(draw(g))return'D';}return'D';}
function test(cfg,n,start){let W=0,L=0,D=0;for(let i=0;i<n;i++){const r=play(cfg,start+i);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D,games:n,score:W-6*L+0.01*D};}
function rank(a,b){return b.r.score-a.r.score||a.r.L-b.r.L||b.r.W-a.r.W;}
const base=['promotion','castleNow','openingDevelop','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const safety=['loosePieces','defendedMaterial','kingPawnShield','castlingStatus','queenSupport'];
const configs=[];let id=0;
function add(order){configs.push({name:'s'+id++,order});}
add(base);
for(const s of safety){for(const pos of[1,2,3,4,5,8,9,10,12]){const o=base.slice();o.splice(pos,0,s);add(o);}}
const combos=[['loosePieces','kingPawnShield'],['loosePieces','castlingStatus'],['loosePieces','defendedMaterial'],['kingPawnShield','castlingStatus'],['loosePieces','queenSupport'],['defendedMaterial','kingPawnShield'],['loosePieces','kingPawnShield','castlingStatus'],['loosePieces','defendedMaterial','kingPawnShield']];
for(const combo of combos){for(const pos of[1,2,3,5,8,9]){const o=base.slice();o.splice(pos,0,...combo);add(o);}}
console.log('SAFETY SCREEN',configs.length,'x 12');
const s=configs.map(cfg=>({cfg,r:test(cfg,12,0)})).sort(rank);for(const x of s.slice(0,15))console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('CONFIRM top 12 x 40');
const c=s.slice(0,12).map(x=>({cfg:x.cfg,r:test(x.cfg,40,1500)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.cfg.order.join('>'),x.r);
console.log('FINAL top 5 x 100');
const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,6000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
new Function(engine+'\n'+v3+'\n'+harness)();
