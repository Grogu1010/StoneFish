const fs=require('fs');
let source=fs.readFileSync('tools/v4-tune.js','utf8');
source=source.replace(/function eg\(g,s\)\{return npm\(g,s\)<=10;\}/,"function eg(g,s){return npm(g,s)<=ACTIVE.endgameMaterial;}");
source=source.replace(/g\.fullmove<=13\?dev\(g,s\):0/g,"g.fullmove<=ACTIVE.developUntil?dev(g,s):0");
source=source.replace(/g\.fullmove<=10/g,"g.fullmove<=ACTIVE.queenUntil");
source=source.replace("function feature(g,m,c){",String.raw`function fifthBestGain(g){
  const M=1000000, moves=g.fastMoves();
  if(!moves.length)return g.in_check()?-M:0;
  let best=0;
  for(const m of moves){
    const gain=V[m.captured]||0;if(gain>best)best=gain;
    if(g.fastGivesCheck(m)){
      g.fastApply(m);const mate=g.fastMoves().length===0&&g.in_check();g.fastUndo();if(mate)return M;
    }
  }
  return best;
}
function fivePlyTradeScore(g,root){
  const M=1000000, immediate=V[root.captured]||0;
  g.fastApply(root);const replies=g.fastMoves();
  if(!replies.length){const z=g.in_check()?M:immediate;g.fastUndo();return z;}
  let worst=Infinity;
  for(const reply of replies){
    const oppGain=V[reply.captured]||0;g.fastApply(reply);const responses=g.fastMoves();
    if(!responses.length&&g.in_check()){g.fastUndo();g.fastUndo();return-M;}
    let bestResponse=-Infinity;
    for(const response of responses){
      const ourGain=V[response.captured]||0,tradeBase=immediate-oppGain+ourGain;g.fastApply(response);const fourths=g.fastMoves();
      if(!fourths.length&&g.in_check()){g.fastUndo();bestResponse=M;break;}
      let worstFourth=tradeBase;
      for(const fourth of fourths){
        const fourthGain=V[fourth.captured]||0;
        if(!fourthGain&&!g.fastGivesCheck(fourth)){if(tradeBase<worstFourth)worstFourth=tradeBase;continue;}
        g.fastApply(fourth);const fifthGain=fifthBestGain(g);g.fastUndo();
        const score=fifthGain<=-M?-M:(fifthGain>=M?M:tradeBase-fourthGain+fifthGain);
        if(score<worstFourth)worstFourth=score;
        if(worstFourth===-M)break;
      }
      g.fastUndo();if(worstFourth>bestResponse)bestResponse=worstFourth;if(bestResponse===M)break;
    }
    g.fastUndo();if(bestResponse<worst)worst=bestResponse;if(worst===-M)break;
  }
  g.fastUndo();return worst;
}
function feature(g,m,c){if(c==='fivePlyTrade')return fivePlyTradeScore(g,m);`);
source=source.replace("function choose4(g,r,cfg){let a=getStonefishV3BestRawMoves(g).slice();","function choose4(g,r,cfg){ACTIVE=cfg;let a=getStonefishV3BestRawMoves(g).slice();");
const start=source.indexOf('const base=['),end=source.indexOf('\n`;\nnew Function',start);if(start<0||end<0)throw new Error('tail not found');
const base=['promotion','castleNow','openingDevelop','hangingMax','queenDiscipline','repetitionAvoid','fiftyReset','endgamePawnProgress','endgameCheck','mobility','pieceSupport','kingFreedom','center','minorCentral','kingProtection','pawnStructure','rookActivity','kingPlacement','boardControl'];
const tail=String.raw`const C=[];const base=${JSON.stringify(base)};function add(name,pos,e){const o=base.slice();o.splice(pos,0,'fivePlyTrade');C.push({name,order:o,developUntil:8,queenUntil:14,endgameMaterial:e});}
for(const e of[10,14]){add('hang_e'+e,4,e);add('queen_e'+e,5,e);}
console.log('FIVEPLY TRADE SCREEN',C.length,'x 6');const s=C.map(c=>({cfg:c,r:test(c,6,301000)})).sort(rank);for(const x of s)console.log(x.cfg.name,x.r);
console.log('FIVEPLY TRADE CONFIRM top 3 x 20');const c=s.slice(0,3).map(x=>({cfg:x.cfg,r:test(x.cfg,20,303000)})).sort(rank);for(const x of c)console.log(x.cfg.name,x.r);
console.log('FIVEPLY TRADE FINAL top 2 x 100');const f=c.slice(0,2).map(x=>({cfg:x.cfg,r:test(x.cfg,100,307000)})).sort(rank);for(const x of f)console.log('FINAL',x.cfg.name,x.r);console.log('WINNER',JSON.stringify(f[0].cfg),f[0].r);`;
source=source.slice(0,start)+tail+source.slice(end);
source=source.replace("new Function(engine+'\\n'+v3+'\\n'+harness)();","new Function(engine+'\\n'+v3+'\\nlet ACTIVE={developUntil:8,queenUntil:14,endgameMaterial:14};\\n'+harness)();");
eval(source);
