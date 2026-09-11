const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function pawnStruct(g,s){",String.raw`function knightCentral(g,s){let z=0;for(let q=0;q<64;q++){if(g.boardState[q]!==s*2)continue;const f=q&7,r=q>>3;if(CENTER.includes(q))z+=4;else if(f>=2&&f<=5&&r>=2&&r<=5)z+=2;else if(f!==0&&f!==7&&r!==0&&r!==7)z++;}return z;}
function bishopActivity(g,s){const b=g.boardState;let z=0;for(let q=0;q<64;q++){if(b[q]!==s*3)continue;const f=q&7,r=q>>3;for(let i=0;i<SF_DIAG_DIRS.length;i+=2){let nf=f+SF_DIAG_DIRS[i],nr=r+SF_DIAG_DIRS[i+1];while(nf>=0&&nf<8&&nr>=0&&nr<8){const p=b[nr*8+nf];if(!p)z++;else{if((p>0?1:-1)!==s)z++;break;}nf+=SF_DIAG_DIRS[i];nr+=SF_DIAG_DIRS[i+1];}}}return z;}
function bishopPair(g,s){let n=0;for(let q=0;q<64;q++)if(g.boardState[q]===s*3)n++;return n>=2?1:0;}
function rookRich(g,s){const b=g.boardState,R=[];let z=0;for(let q=0;q<64;q++)if(b[q]===s*4)R.push(q);for(const q of R){const f=q&7,r=q>>3;let ownPawn=false;for(let rr=0;rr<8;rr++)if(b[rr*8+f]===s)ownPawn=true;if(!ownPawn)z+=2;if((s===1&&r===6)||(s===-1&&r===1))z+=2;if((s===1&&r>0)||(s===-1&&r<7))z++;}if(R.length===2&&(R[0]>>3)===(R[1]>>3)){let clear=true;for(let q=Math.min(R[0],R[1])+1;q<Math.max(R[0],R[1]);q++)if(b[q])clear=false;if(clear)z+=3;}return z;}
function pawnStruct(g,s){`);
src=src.replace("else if(c==='minorCentral')z=minor(g,s);", "else if(c==='minorCentral')z=minor(g,s);else if(c==='knightCentral')z=knightCentral(g,s);else if(c==='bishopActivity')z=bishopActivity(g,s);else if(c==='bishopPair')z=bishopPair(g,s);else if(c==='rookRich')z=rookRich(g,s);");
const start=src.indexOf("const C=[];let id=0;function add");
const end=src.indexOf("`;\nnew Function",start);
if(start<0||end<0)throw new Error('Could not locate candidate block');
const replacement=String.raw`const C=[];let id=0;function add(o,label){C.push({name:(label||'a')+(id++),order:o});}
function replaceOne(rule,repl){const o=[];for(const x of base){if(x===rule)o.push(...repl);else o.push(x);}return o;}
add(base.slice(),'base');
add(replaceOne('minorCentral',['knightCentral']),'knight_');
add(replaceOne('minorCentral',['bishopActivity']),'bishop_');
add(replaceOne('minorCentral',['knightCentral','bishopActivity']),'nb_');
add(replaceOne('minorCentral',['bishopActivity','knightCentral']),'bn_');
add(replaceOne('rookActivity',['rookRich']),'rook_');
let o=replaceOne('minorCentral',['knightCentral','bishopActivity']);o=(()=>{const a=[];for(const x of o){if(x==='rookActivity')a.push('rookRich');else a.push(x);}return a;})();add(o,'nbr_');
for(const pos of[4,8,10,12,13,14,15]){const a=base.slice();a.splice(pos,0,'bishopPair');add(a,'pair_');}
for(const pos of[10,12,13,14]){const a=replaceOne('minorCentral',['knightCentral','bishopActivity']);a.splice(pos,0,'bishopPair');add(a,'all_');}
console.log('PIECE ACTIVITY',C.length,'x 100');const f=C.map(cfg=>({cfg,r:test(cfg,100,54000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);
`;
src=src.slice(0,start)+replacement+src.slice(end);
eval(src);
