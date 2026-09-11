const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`let CURRENT_POOL=0;
function matDiff(g,s){let z=0;for(let q=0;q<64;q++){const p=g.boardState[q];if(!p)continue;const v=V[Math.abs(p)]||0;z+=(p>0?1:-1)===s?v:-v;}return z;}
function fourPlyScore(g,root){
  const M=1000000, immediate=V[root.captured]||0;
  g.fastApply(root);
  const replies=g.fastMoves();
  if(!replies.length){const z=g.in_check()?M:immediate;g.fastUndo();return z;}
  let worst=Infinity;
  for(const reply of replies){
    const oppGain=V[reply.captured]||0;
    g.fastApply(reply);
    const responses=g.fastMoves();
    if(!responses.length&&g.in_check()){g.fastUndo();if(-M<worst)worst=-M;continue;}
    let best=-Infinity;
    for(const response of responses){
      const ourGain=V[response.captured]||0;
      g.fastApply(response);
      const fourth=g.fastMoves();
      let score;
      if(!fourth.length&&g.in_check())score=M;
      else{
        let fourthGain=0,fourthMate=false;
        for(const fm of fourth){
          const cap=V[fm.captured]||0;if(cap>fourthGain)fourthGain=cap;
          if(!fourthMate&&g.fastGivesCheck(fm)){g.fastApply(fm);if(g.fastMoves().length===0&&g.in_check())fourthMate=true;g.fastUndo();}
        }
        score=fourthMate?-M:(immediate-oppGain+ourGain-fourthGain);
      }
      g.fastUndo();if(score>best)best=score;if(best===M)break;
    }
    g.fastUndo();if(best<worst)worst=best;if(worst===-M)break;
  }
  g.fastUndo();return worst;
}
function fourPlyGate(g,m,c){const p=c.split(':');const mode=p[1];if(mode==='lead'&&matDiff(g,g.side)>+p[2])return 0;if(mode==='pool'&&CURRENT_POOL<+p[2])return 0;if(mode==='early'&&g.fullmove>+p[2])return 0;if(mode==='leadpool'&&(matDiff(g,g.side)>+p[2]||CURRENT_POOL<+p[3]))return 0;return fourPlyScore(g,m);}
function feature(g,m,c){if(c.startsWith('fourPlyGate:'))return fourPlyGate(g,m,c);`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;for(const c of cfg.order){if(a.length<=1)break;let best=-Infinity,S=[];","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();if(!a.length)return null;for(const c of cfg.order){if(a.length<=1)break;CURRENT_POOL=a.length;let best=-Infinity,S=[];");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const base=${JSON.stringify(base)};const specs=[['always','lead',999],['lead0','lead',0],['lead1','lead',1],['lead2','lead',2],['lead3','lead',3],['lead5','lead',5],['pool4','pool',4],['pool8','pool',8],['early16','early',16],['early24','early',24],['lp2x4','leadpool',2,4],['lp3x6','leadpool',3,6]];const C=specs.map(s=>{const o=base.slice(),tag='fourPlyGate:'+s.slice(1).join(':');o.splice(5,0,tag);return{name:s[0],order:o,developUntil:8,queenUntil:14,endgameMaterial:14};});
console.log('FOURPLY GATED SCREEN',C.length,'x 8');const s=C.map(c=>({cfg:c,r:test(c,8,151000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('FOURPLY GATED CONFIRM top 5 x 24');const c=s.slice(0,5).map(x=>({cfg:x.cfg,r:test(x.cfg,24,153000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('FOURPLY GATED FINAL top 2 x 100');const f=c.slice(0,2).map(x=>({cfg:x.cfg,r:test(x.cfg,100,157000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
