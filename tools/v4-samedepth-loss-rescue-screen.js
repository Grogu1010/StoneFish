const fs=require('fs');
let src=fs.readFileSync('tools/v4-tune.js','utf8');
src=src.replace("function feature(g,m,c){",String.raw`
function repByLead(g,m,visitLimit,leadMin){g.fastApply(m);const s=-g.side,visits=g.positionCounts.get(g.fastPositionKey())||0,lead=npm(g,s)-npm(g,-s);g.fastUndo();if(visits<visitLimit)return 1;return lead>=leadMin?0:1;}
function cycleProgress(g,m,leadMin){const visits=g.positionCounts.get(g.fastPositionKey())||0;if(visits<2)return 0;const s=g.side,lead=npm(g,s)-npm(g,-s);if(lead<leadMin)return 0;return(m.piece===1||m.captured)?1:0;}
function splitMob(g,m,t,ahead){g.fastApply(m);const s=-g.side,lead=npm(g,s)-npm(g,-s),active=ahead?lead>=t:lead<t,z=active?g.fastMobility(s):0;g.fastUndo();return z;}
function feature(g,m,c){if(c==='rep2Lead2_5')return repByLead(g,m,1,2.5);if(c==='cycleProgress2_5')return cycleProgress(g,m,2.5);if(c.startsWith('mobAhead@'))return splitMob(g,m,Number(c.split('@')[1]),true);if(c.startsWith('mobBehind@'))return splitMob(g,m,Number(c.split('@')[1]),false);`);
const start=src.indexOf('const base=['),end=src.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const tail=String.raw`
const B=['promotion','rep2Lead2_5','castleNow','openingDevelop','hangingMax','cycleProgress2_5','mobility','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const C=[{name:'control',order:B.slice()}];
function split(name,t,afterRule){let o=B.map(x=>x==='mobility'?'mobAhead@'+t:x);const p=o.indexOf(afterRule)+1;o.splice(p,0,'mobBehind@'+t);C.push({name,order:o});}
for(const t of[-2,-1,0,1])for(const r of['pieceSupport','kingFreedom','center','kingProtection','pawnStructure'])split('t'+t+'_after_'+r,t,r);
const lossSeeds=[90004,90006,90029,90030,90099];
function five(cfg){let W=0,L=0,D=0,rows=[];for(const seed of lossSeeds){const r=play(cfg,seed);rows.push(seed+':'+r);if(r==='W')W++;else if(r==='L')L++;else D++;}return{W,L,D,rows};}
console.log('LOSS RESCUE SCREEN',C.length);const screened=C.map(cfg=>({cfg,f:five(cfg),r:test(cfg,100,90000)})).sort((a,b)=>a.f.L-b.f.L||b.r.W-a.r.W||a.r.L-b.r.L);for(const x of screened)console.log('SCREEN',x.cfg.name,'five',x.f,'block',x.r,'order',x.cfg.order.join('>'));console.log('WINNER',JSON.stringify(screened[0].cfg),screened[0].f,screened[0].r);
`;
src=src.slice(0,start)+tail+src.slice(end);eval(src);
