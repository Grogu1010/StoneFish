const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`function fivePlyCaptureScore(g,root){
  const M=1000000, immediate=V[root.captured]||0;g.fastApply(root);const replies=g.fastMoves();
  if(!replies.length){const z=g.in_check()?M:immediate;g.fastUndo();return z;}let rootWorst=Infinity;
  for(const reply of replies){const oppGain=V[reply.captured]||0;g.fastApply(reply);const responses=g.fastMoves();
    if(!responses.length&&g.in_check()){g.fastUndo();rootWorst=-M;break;}let replyBest=-Infinity;
    for(const response of responses){const ourGain=V[response.captured]||0;g.fastApply(response);const fourth=g.fastMoves();
      if(!fourth.length&&g.in_check()){g.fastUndo();replyBest=M;break;}
      const base=immediate-oppGain+ourGain;let responseWorst=fourth.length?Infinity:base;
      for(const fm of fourth){const cap=V[fm.captured]||0;let score=base-cap;
        if(fm.captured||g.fastGivesCheck(fm)){
          g.fastApply(fm);const fifth=g.fastMoves();if(!fifth.length&&g.in_check())score=-M;else if(fm.captured){let regain=0;for(const r5 of fifth){const x=V[r5.captured]||0;if(x>regain)regain=x;}score=base-cap+regain;}g.fastUndo();
        }
        if(score<responseWorst)responseWorst=score;if(responseWorst<=replyBest)break;
      }
      g.fastUndo();if(responseWorst>replyBest)replyBest=responseWorst;if(replyBest===M)break;
    }
    g.fastUndo();if(replyBest<rootWorst)rootWorst=replyBest;if(rootWorst===-M)break;
  }
  g.fastUndo();return rootWorst;
}
function feature(g,m,c){if(c==='fivePlyCapture')return fivePlyCaptureScore(g,m);`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];const base=${JSON.stringify(base)};for(const spec of[['afterQueen',5],['beforeMobility',9]]){const o=base.slice();o.splice(spec[1],0,'fivePlyCapture');C.push({name:spec[0],order:o,developUntil:8,queenUntil:14,endgameMaterial:14});}
console.log('FIVEPLY CAPTURE SCREEN',C.length,'x 6');const s=C.map(c=>({cfg:c,r:test(c,6,241000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('FIVEPLY CAPTURE CONFIRM top 2 x 20');const c=s.map(x=>({cfg:x.cfg,r:test(x.cfg,20,243000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('FIVEPLY CAPTURE FINAL best x 100');const f={cfg:c[0].cfg,r:test(c[0].cfg,100,247000)};console.log('FINAL',f.cfg.name,f.r);console.log('WINNER',JSON.stringify(f.cfg),f.r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
