const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(
"function kprot(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k];let z=0;b[k]=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const q=nr*8+nf,p=b[q];if(p&&(p>0?1:-1)===s)z+=Math.abs(p)===1?3:2;if(g._isAttacked(q,s))z++;}b[k]=kp;return z;}",
"function kprot(g,s,cfg){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3,kp=b[k],pw=cfg.pawnCover??3,ow=cfg.pieceCover??2,dw=cfg.ringDefense??1;let z=0;b[k]=0;for(let i=0;i<SF_ALL_DIRS.length;i+=2){const nf=f+SF_ALL_DIRS[i],nr=r+SF_ALL_DIRS[i+1];if(nf<0||nf>7||nr<0||nr>7)continue;const q=nr*8+nf,p=b[q];if(p&&(p>0?1:-1)===s)z+=Math.abs(p)===1?pw:ow;if(g._isAttacked(q,s))z+=dw;}b[k]=kp;return z;}"
);
source=source.replace(
"function feature(g,m,c){",
`function nonKingMob(g,s){const old=g.side,ep=g.ep;g.side=s;g.ep=-1;const ms=g.fastMoves();g.side=old;g.ep=ep;let n=0;for(const x of ms)if(x.piece!==6)n++;return n;}
function kingPawnShield(g,s){const b=g.boardState,k=g.kingSq[s],f=k&7,r=k>>3;let z=0;for(const df of[-1,0,1]){const nf=f+df;if(nf<0||nf>7)continue;for(const d of[1,2]){const nr=r+s*d;if(nr<0||nr>7)continue;if(b[nr*8+nf]===s)z+=d===1?2:1;}}return z;}
function feature(g,m,c,cfg){`
);
source=source.replace("const s=feature(g,a[i],c);","const s=feature(g,a[i],c,cfg);");
source=source.replace("else if(c==='mobility')z=g.fastMobility(s);","else if(c==='mobilityNoKing')z=nonKingMob(g,s);else if(c==='mobility')z=g.fastMobility(s);");
source=source.replace("else if(c==='kingProtection')z=kprot(g,s);","else if(c==='kingProtection')z=kprot(g,s,cfg);");
source=source.replace("else if(c==='hangingMax')z=hangingMax(g,s);","else if(c==='kingPawnShield')z=kingPawnShield(g,s);else if(c==='hangingMax')z=hangingMax(g,s);");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);
if(start<0||end<0)throw new Error('Could not locate harness tail');
const tail=String.raw`const h3=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobilityNoKing','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[];function add(name,order,w={}){C.push({name,order,...w});}
const weights=[
 {pawnCover:3,pieceCover:2,ringDefense:1},
 {pawnCover:3,pieceCover:1,ringDefense:2},
 {pawnCover:3,pieceCover:1,ringDefense:1},
 {pawnCover:4,pieceCover:1,ringDefense:2},
 {pawnCover:5,pieceCover:1,ringDefense:2},
 {pawnCover:2,pieceCover:1,ringDefense:2}
];
add('mob_base',h3.slice());
for(const w of weights)add('weights_'+w.pawnCover+'_'+w.pieceCover+'_'+w.ringDefense,h3.slice(),w);
for(const pos of[9,10,11,12,13,14]){
 const o=h3.filter(x=>x!=='kingProtection');o.splice(pos,0,'kingProtection');
 for(const w of weights)add('kp'+pos+'_w'+w.pawnCover+'_'+w.pieceCover+'_'+w.ringDefense,o,w);
}
for(const pos of[10,11,12,13,14,15]){
 const o=h3.slice();o.splice(pos,0,'kingPawnShield');
 add('shield_'+pos,o,{pawnCover:3,pieceCover:1,ringDefense:2});
}
for(const seq of[
 ['kingProtection','kingPawnShield','pieceSupport'],
 ['kingProtection','pieceSupport','kingPawnShield'],
 ['pieceSupport','kingProtection','kingPawnShield'],
 ['pieceSupport','kingPawnShield','kingProtection']
]){
 const o=h3.filter(x=>!seq.includes(x));const idx=o.indexOf('kingFreedom');o.splice(idx,0,...seq);add('seq_'+seq.join('_'),o,{pawnCover:3,pieceCover:1,ringDefense:2});
}
add('drop_kingPlacement',h3.filter(x=>x!=='kingPlacement'),{pawnCover:3,pieceCover:1,ringDefense:2});
add('drop_endgameCheck',h3.filter(x=>x!=='endgameCheck'),{pawnCover:3,pieceCover:1,ringDefense:2});
add('drop_both',h3.filter(x=>x!=='kingPlacement'&&x!=='endgameCheck'),{pawnCover:3,pieceCover:1,ringDefense:2});
console.log('MOBILITY SAFETY SCREEN',C.length,'x 24');const s=C.map(cfg=>({cfg,r:test(cfg,24,122000)})).sort(rank);for(const x of s.slice(0,15))console.log(x.cfg.name,x.r);
console.log('MOBILITY SAFETY CONFIRM top 10 x 60');const c=s.slice(0,10).map(x=>({cfg:x.cfg,r:test(x.cfg,60,124000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('MOBILITY SAFETY FINAL top 5 x 100');const f=c.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,100,128000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.cfg.order.join('>'),x.r,JSON.stringify({pawnCover:x.cfg.pawnCover,pieceCover:x.cfg.pieceCover,ringDefense:x.cfg.ringDefense}));console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
eval(source.slice(0,start)+tail+source.slice(end));
