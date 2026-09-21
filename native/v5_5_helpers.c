/* Exact native v5.5 evaluation and StonefishChess legal move order.
   Prototype: no imports, no search, no opponent state, no runtime allocation. */
typedef signed char i8;
typedef unsigned int u32;
static i8 board[64];
static int config[903]; /* piece[7], middlegame[7][64], endgame[7][64] */
static u32 output[512];
static const int ndf[8]={1,2,2,1,-1,-2,-2,-1};
static const int ndr[8]={2,1,-1,-2,-2,-1,1,2};
static const int dirs[16]={1,1,1,-1,-1,1,-1,-1,1,0,-1,0,0,1,0,-1};
static int absolute(int x){return x<0?-x:x;}
static int maximum(int a,int b){return a>b?a:b;}
void *memset(void *p,int value,unsigned long count){unsigned char *b=p;for(unsigned long i=0;i<count;i++)b[i]=(unsigned char)value;return p;}
void *memcpy(void *dst,const void *src,unsigned long count){unsigned char *d=dst;const unsigned char *s=src;for(unsigned long i=0;i<count;i++)d[i]=s[i];return dst;}
int board_ptr(void){return (int)(unsigned long)board;}
int config_ptr(void){return (int)(unsigned long)config;}
int moves_ptr(void){return (int)(unsigned long)output;}
typedef struct {int mg,eg;} PawnScore;
static PawnScore pawn_score(const int *pawns,int count,const int *own,const int *enemy,int enemy_count,int side,int own_king,int enemy_king){
  PawnScore score={0,0};
  static const int middle[8]={0,0,8,17,35,65,110,0},ending[8]={0,0,15,32,65,120,210,0};
  for(int i=0;i<count;i++){
    int sq=pawns[i],file=sq&7,rank=side>0?sq>>3:7-(sq>>3);
    if(own[file]>1){score.mg-=12;score.eg-=16;}
    if(!(file>0&&own[file-1])&&!(file<7&&own[file+1])){score.mg-=11;score.eg-=15;}
    int passed=1;
    for(int j=0;j<enemy_count;j++)if(absolute((enemy[j]&7)-file)<=1&&(side>0?enemy[j]>sq:enemy[j]<sq)){passed=0;break;}
    if(passed){
      score.mg+=middle[rank];score.eg+=ending[rank];
      if(rank>=4){
        int promotion_rank=side>0?7:0;
        int ed=maximum(absolute((enemy_king&7)-file),absolute((enemy_king>>3)-promotion_rank));
        int od=maximum(absolute((own_king&7)-file),absolute((own_king>>3)-promotion_rank));
        score.eg+=(ed-od)*rank*3;
      }
    }
  }
  return score;
}
int evaluate(int side,int white_king,int black_king){
  int mg=0,eg=0,phase=0,wb=0,bb=0,wp[8]={0},bp[8]={0},white[64],black[64],wc=0,bc=0;
  const int *pst=config+7,*ending=config+7+448;
  for(int sq=0;sq<64;sq++){
    int p=board[sq];if(!p)continue;
    int s=p>0?1:-1,type=absolute(p),ps=s>0?sq:sq^56;
    mg+=s*(config[type]+pst[type*64+ps]);eg+=s*(config[type]+ending[type*64+ps]);
    phase+=type==2||type==3?1:type==4?2:type==5?4:0;
    if(type==1){if(s>0){wp[sq&7]++;white[wc++]=sq;}else{bp[sq&7]++;black[bc++]=sq;}}
    if(type==3){if(s>0)wb++;else bb++;}
  }
  PawnScore a=pawn_score(white,wc,wp,black,bc,1,white_king,black_king);
  PawnScore c=pawn_score(black,bc,bp,white,wc,-1,black_king,white_king);
  mg+=a.mg-c.mg;eg+=a.eg-c.eg;
  if(wb>=2){mg+=30;eg+=45;}if(bb>=2){mg-=30;eg-=45;}
  for(int sq=0;sq<64;sq++){
    int p=board[sq];if(!p)continue;
    int type=absolute(p),s=p>0?1:-1,file=sq&7;
    if(type==4){const int *own=s>0?wp:bp,*opp=s>0?bp:wp;if(!own[file]){mg+=s*(opp[file]?15:30);eg+=s*15;}}
    if(type==6){int shield=0;for(int df=-1;df<=1;df++){if(file+df<0||file+df>7)continue;int x=sq+s*8+df;if(x>=0&&x<64&&board[x]==s)shield++;}mg+=s*shield*12;}
  }
  if(phase>24)phase=24;
  double score=(mg*phase+eg*(24-phase))/24.0;
  if(phase<=4&&absolute(eg)>400){
    int winner=eg>0?1:-1,loser=winner>0?black_king:white_king,king=winner>0?white_king:black_king;
    int edge=maximum(absolute(2*(loser&7)-7),absolute(2*(loser>>3)-7));
    int proximity=14-absolute((king&7)-(loser&7))-absolute((king>>3)-(loser>>3));
    score+=winner*(edge*10+proximity*6);
  }
  return (int)__builtin_floor(score*side+0.5)+8;
}
static int attacked(int square,int by_side){
  int file=square&7,rank=square>>3,r=rank-by_side;
  if(r>=0&&r<8){if(file>0&&board[r*8+file-1]==by_side)return 1;if(file<7&&board[r*8+file+1]==by_side)return 1;}
  for(int i=0;i<8;i++){int f=file+ndf[i],nr=rank+ndr[i];if(f>=0&&f<8&&nr>=0&&nr<8&&board[nr*8+f]==by_side*2)return 1;}
  for(int i=0;i<16;i+=2){
    int f=file+dirs[i],nr=rank+dirs[i+1];
    while(f>=0&&f<8&&nr>=0&&nr<8){int p=board[nr*8+f];if(p){if(p==by_side*5||p==by_side*(i<8?3:4))return 1;break;}f+=dirs[i];nr+=dirs[i+1];}
  }
  for(int i=0;i<16;i+=2){int f=file+dirs[i],nr=rank+dirs[i+1];if(f>=0&&f<8&&nr>=0&&nr<8&&board[nr*8+f]==by_side*6)return 1;}
  return 0;
}
int in_check(int side,int king){return attacked(king,-side);}
static int gen_side,gen_king,gen_mode,gen_count;
static int emit(int from,int to,int promotion,int flags){
  int moving=board[from],target=board[to],captured=flags&2?1:absolute(target);
  if(gen_mode==1&&!captured&&!promotion)return 0;
  int ep_square=-1,ep_piece=0,rook_from=-1,rook_to=-1,rook_piece=0;
  board[from]=0;board[to]=promotion?gen_side*promotion:moving;
  if(flags&2){ep_square=to-gen_side*8;ep_piece=board[ep_square];board[ep_square]=0;}
  if(flags&12){
    rook_from=gen_side==1?(flags&4?7:0):(flags&4?63:56);
    rook_to=gen_side==1?(flags&4?5:3):(flags&4?61:59);
    rook_piece=board[rook_from];board[rook_to]=rook_piece;board[rook_from]=0;
  }
  int safe=!attacked(absolute(moving)==6?to:gen_king,-gen_side);
  if(rook_from>=0){board[rook_from]=rook_piece;board[rook_to]=0;}
  if(ep_square>=0)board[ep_square]=ep_piece;
  board[from]=moving;board[to]=target;
  if(!safe)return 0;
  if(gen_mode==2)return 1;
  output[gen_count++]=(u32)(from|(to<<6)|(absolute(moving)<<12)|(captured<<15)|(promotion<<18)|(flags<<21));
  return 0;
}
static int pawn_emit(int from,int to,int promotion_rank){
  if((to>>3)!=promotion_rank)return emit(from,to,0,0);
  return emit(from,to,5,0)||emit(from,to,4,0)||emit(from,to,3,0)||emit(from,to,2,0);
}
int generate(int side,int castling,int ep,int king,int mode){
  gen_side=side;gen_king=king;gen_mode=mode;gen_count=0;
  for(int from=0;from<64;from++){
    int p=board[from];if(!p||(p>0?1:-1)!=side)continue;
    int type=absolute(p),file=from&7,rank=from>>3;
    if(type==1){
      int step=side*8,start=side==1?1:6,promotion=side==1?7:0,one=from+step;
      if(one>=0&&one<64&&!board[one]){
        if(pawn_emit(from,one,promotion))return 1;
        if((one>>3)!=promotion&&rank==start&&!board[from+step*2]&&emit(from,from+step*2,0,1))return 1;
      }
      for(int df=-1;df<=1;df+=2){
        int f=file+df,to=from+step+df;if(f<0||f>7||to<0||to>=64)continue;
        if(board[to]&&((board[to]>0?1:-1)==-side)){if(pawn_emit(from,to,promotion))return 1;}
        else if(to==ep&&emit(from,to,0,2))return 1;
      }
      continue;
    }
    if(type==2){
      for(int i=0;i<8;i++){int f=file+ndf[i],r=rank+ndr[i];if(f<0||f>7||r<0||r>7)continue;int to=r*8+f;if((!board[to]||((board[to]>0?1:-1)==-side))&&emit(from,to,0,0))return 1;}
      continue;
    }
    int start=type==4?8:0,end=type==3?8:16;
    for(int i=start;i<end;i+=2){
      int f=file+dirs[i],r=rank+dirs[i+1];
      while(f>=0&&f<8&&r>=0&&r<8){
        int to=r*8+f;
        if(!board[to]){if(emit(from,to,0,0))return 1;}
        else{if(((board[to]>0?1:-1)==-side)&&emit(from,to,0,0))return 1;break;}
        if(type==6)break;f+=dirs[i];r+=dirs[i+1];
      }
    }
    if(type==6&&side==1&&from==4){
      if((castling&1)&&board[7]==4&&!board[5]&&!board[6]&&!attacked(4,-1)&&!attacked(5,-1)&&!attacked(6,-1)&&emit(4,6,0,4))return 1;
      if((castling&2)&&board[0]==4&&!board[1]&&!board[2]&&!board[3]&&!attacked(4,-1)&&!attacked(3,-1)&&!attacked(2,-1)&&emit(4,2,0,8))return 1;
    }else if(type==6&&side==-1&&from==60){
      if((castling&4)&&board[63]==-4&&!board[61]&&!board[62]&&!attacked(60,1)&&!attacked(61,1)&&!attacked(62,1)&&emit(60,62,0,4))return 1;
      if((castling&8)&&board[56]==-4&&!board[57]&&!board[58]&&!board[59]&&!attacked(60,1)&&!attacked(59,1)&&!attacked(58,1)&&emit(60,58,0,8))return 1;
    }
  }
  return gen_mode==2?0:gen_count;
}


/* ARMX compiled search accelerator. Search stays self-contained inside the
   helper module so extra depth does not pay the JavaScript/WASM boundary on
   every node. No persistent opponent state is stored here; JS supplies only
   the frozen per-search quiet-choice weights. */
static int root_scores[512];
static double policy_weights[13];
static int search_history[32768],search_killers[32];
static int search_nodes_count,search_node_limit,search_qdepth,search_abort,search_iter_depth;
static int search_depth_done,search_policy_enabled,search_policy_side;
static const int SEARCH_MATE=20000000;

#define SEARCH_POS_CAP 16384
#define SEARCH_PATH_CAP 32768
#define SEARCH_TT_CAP 32768
typedef struct {
  u32 generation,hash;
  int side,castling,ep,id;
  i8 squares[64];
} SearchPositionEntry;
typedef struct {
  u32 generation;
  int parent,pos,signature;
} SearchPathEntry;
typedef struct {
  u32 generation;
  int pos,halfmove,ply,path,depth,score,move,flag;
} SearchTTEntry;
static SearchPositionEntry search_positions[SEARCH_POS_CAP];
static SearchPathEntry search_paths[SEARCH_PATH_CAP];
static SearchTTEntry search_tt[SEARCH_TT_CAP];
static int search_path_counts[SEARCH_POS_CAP+1];
static int search_path_stack[64],search_path_top,search_path_signature;
static int search_position_count,search_signature_count;
static u32 search_generation;

int scores_ptr(void){return (int)(unsigned long)root_scores;}
int policy_ptr(void){return (int)(unsigned long)policy_weights;}
int search_nodes(void){return search_nodes_count;}
int search_depth(void){return search_depth_done;}

typedef struct {
  int side,castling,ep,wk,bk,halfmove;
} SearchState;
typedef struct {
  SearchState state;
  i8 moving,captured;
} SearchUndo;

static int move_from(u32 m){return m&63;}
static int move_to(u32 m){return (m>>6)&63;}
static int move_piece(u32 m){return (m>>12)&7;}
static int move_captured(u32 m){return (m>>15)&7;}
static int move_promotion(u32 m){return (m>>18)&7;}
static int move_flags(u32 m){return (int)(m>>21);}
static int move_id(u32 m){return move_from(m)|(move_to(m)<<6)|(move_promotion(m)<<12);}

static void search_apply(SearchState *s,u32 m,SearchUndo *u){
  u->state=*s;
  int from=move_from(m),to=move_to(m),flags=move_flags(m);
  int moving=board[from],capture_sq=(flags&2)?to-s->side*8:to;
  u->moving=(i8)moving;u->captured=board[capture_sq];
  board[from]=0;board[to]=move_promotion(m)?(i8)(s->side*move_promotion(m)):(i8)moving;
  if(flags&2)board[capture_sq]=0;
  if(absolute(moving)==6){
    if(s->side>0)s->wk=to;else s->bk=to;
    if(s->side>0)s->castling&=~3;else s->castling&=~12;
    if(flags&4){
      int rf=s->side>0?7:63,rt=s->side>0?5:61;board[rt]=board[rf];board[rf]=0;
    }else if(flags&8){
      int rf=s->side>0?0:56,rt=s->side>0?3:59;board[rt]=board[rf];board[rf]=0;
    }
  }
  if(from==0||to==0)s->castling&=~2;
  if(from==7||to==7)s->castling&=~1;
  if(from==56||to==56)s->castling&=~8;
  if(from==63||to==63)s->castling&=~4;
  s->ep=-1;
  if(absolute(moving)==1&&absolute(to-from)==16)s->ep=(from+to)>>1;
  s->halfmove=(absolute(moving)==1||u->captured)?0:s->halfmove+1;
  s->side=-s->side;
}
static void search_undo(SearchState *s,u32 m,const SearchUndo *u){
  int flags=move_flags(m),from=move_from(m),to=move_to(m),side=u->state.side;
  if(flags&4){
    int rf=side>0?7:63,rt=side>0?5:61;board[rf]=board[rt];board[rt]=0;
  }else if(flags&8){
    int rf=side>0?0:56,rt=side>0?3:59;board[rf]=board[rt];board[rt]=0;
  }
  board[from]=u->moving;
  if(flags&2){board[to]=0;board[to-side*8]=u->captured;}
  else board[to]=u->captured;
  *s=u->state;
}

static int search_insufficient(void){
  int minors=0,knights=0,color=-1,mixed=0;
  for(int sq=0;sq<64;sq++){
    int p=absolute(board[sq]);
    if(p==1||p==4||p==5)return 0;
    if(p==2){minors++;knights++;}
    else if(p==3){
      minors++;int c=((sq&7)+(sq>>3))&1;
      if(color!=-1&&color!=c)mixed=1;color=c;
    }
  }
  return minors<=1||(!knights&&!mixed);
}

static u32 search_position_hash(const SearchState *s){
  u32 h=2166136261u;
  for(int i=0;i<64;i++){h^=(u32)(board[i]+7);h*=16777619u;}
  h^=(u32)(s->side+2);h*=16777619u;
  h^=(u32)s->castling;h*=16777619u;
  h^=(u32)(s->ep+1);h*=16777619u;
  return h;
}
static int search_position_equal(const SearchPositionEntry *e,const SearchState *s){
  if(e->side!=s->side||e->castling!=s->castling||e->ep!=s->ep)return 0;
  for(int i=0;i<64;i++)if(e->squares[i]!=board[i])return 0;
  return 1;
}
static int search_position_id(const SearchState *s){
  u32 hash=search_position_hash(s),slot=hash&(SEARCH_POS_CAP-1);
  for(int probe=0;probe<SEARCH_POS_CAP;probe++,slot=(slot+1)&(SEARCH_POS_CAP-1)){
    SearchPositionEntry *e=&search_positions[slot];
    if(e->generation!=search_generation){
      e->generation=search_generation;e->hash=hash;e->side=s->side;e->castling=s->castling;e->ep=s->ep;
      for(int i=0;i<64;i++)e->squares[i]=board[i];
      e->id=++search_position_count;
      return e->id;
    }
    if(e->hash==hash&&search_position_equal(e,s))return e->id;
  }
  return 0;
}
static int search_path_next(int parent,int pos){
  u32 hash=(u32)parent*2654435761u^(u32)pos*2246822519u;
  u32 slot=hash&(SEARCH_PATH_CAP-1);
  for(int probe=0;probe<SEARCH_PATH_CAP;probe++,slot=(slot+1)&(SEARCH_PATH_CAP-1)){
    SearchPathEntry *e=&search_paths[slot];
    if(e->generation!=search_generation){
      e->generation=search_generation;e->parent=parent;e->pos=pos;e->signature=++search_signature_count;
      return e->signature;
    }
    if(e->parent==parent&&e->pos==pos)return e->signature;
  }
  return parent;
}
static void search_enter_position(int pos){
  if(!pos)return;
  search_path_counts[pos]++;
  search_path_stack[search_path_top++]=search_path_signature;
  search_path_signature=search_path_next(search_path_signature,pos);
}
static void search_exit_position(int pos){
  if(!pos)return;
  search_path_counts[pos]--;
  search_path_signature=search_path_stack[--search_path_top];
}
static SearchTTEntry *search_tt_find(int pos,int halfmove,int ply,int path){
  u32 hash=(u32)pos*2654435761u^(u32)halfmove*2246822519u^(u32)ply*3266489917u^(u32)path*668265263u;
  u32 slot=hash&(SEARCH_TT_CAP-1);
  for(int probe=0;probe<SEARCH_TT_CAP;probe++,slot=(slot+1)&(SEARCH_TT_CAP-1)){
    SearchTTEntry *e=&search_tt[slot];
    if(e->generation!=search_generation)return 0;
    if(e->pos==pos&&e->halfmove==halfmove&&e->ply==ply&&e->path==path)return e;
  }
  return 0;
}
static SearchTTEntry *search_tt_slot(int pos,int halfmove,int ply,int path){
  u32 hash=(u32)pos*2654435761u^(u32)halfmove*2246822519u^(u32)ply*3266489917u^(u32)path*668265263u;
  u32 slot=hash&(SEARCH_TT_CAP-1);
  for(int probe=0;probe<SEARCH_TT_CAP;probe++,slot=(slot+1)&(SEARCH_TT_CAP-1)){
    SearchTTEntry *e=&search_tt[slot];
    if(e->generation!=search_generation){
      e->generation=search_generation;e->pos=pos;e->halfmove=halfmove;e->ply=ply;e->path=path;
      return e;
    }
    if(e->pos==pos&&e->halfmove==halfmove&&e->ply==ply&&e->path==path)return e;
  }
  return 0;
}
static int search_draw(const SearchState *s,int pos){
  if(s->halfmove>=100)return 1;
  if(s->halfmove>=8&&pos&&search_path_counts[pos]+1>=3)return 1;
  return search_insufficient();
}
static int js_round(double x){return (int)__builtin_floor(x+0.5);}

static int quiet_activity(int piece,int sq){
  int f=sq&7,r=sq>>3,center=7-absolute(2*f-7)-absolute(2*r-7),fc=7-absolute(2*f-7);
  if(piece==1)return r*7+fc*3+((r>=3&&f>=2&&f<=5)?14:0);
  if(piece==2)return center*7-(r==0?15:0);
  if(piece==3)return center*4+r*3;
  if(piece==4)return r==6?30:r*2;
  if(piece==5)return center*2-(r>2?8:0);
  return -center*5-r*12+((r==0&&(f==6||f==2))?45:0);
}
static int quiet_ending(int piece,int sq){
  int f=sq&7,r=sq>>3,center=7-absolute(2*f-7)-absolute(2*r-7),fc=7-absolute(2*f-7);
  if(piece==1)return r*r*5+fc;
  if(piece==2)return center*5;
  if(piece==3)return center*3;
  if(piece==4)return center*2;
  if(piece==5)return center*3;
  return center*8;
}
static double policy_logit(u32 m){
  int piece=move_piece(m),from=move_from(m),to=move_to(m);
  if(search_policy_side<0){from^=56;to^=56;}
  double v=policy_weights[piece-1];
  v+=((double)(quiet_activity(piece,to)-quiet_activity(piece,from))/100.0)*policy_weights[6];
  v+=((double)(quiet_ending(piece,to)-quiet_ending(piece,from))/100.0)*policy_weights[7];
  int adv=(to>>3)-(from>>3);if(adv>3)adv=3;if(adv<-3)adv=-3;
  v+=((double)adv/3.0)*policy_weights[8];
  if(move_flags(m)&12)v+=policy_weights[9];
  if((piece==2||piece==3)&&(from>>3)==0)v+=policy_weights[10];
  double center_gain=(double)(absolute(2*(from&7)-7)-absolute(2*(to&7)-7))/8.0;
  v+=center_gain*policy_weights[11];
  if(piece==1&&(to>>3)>=4)v+=policy_weights[12];
  return v;
}
static int search_order(u32 m,int ply,int tt_move){
  int promotion=move_promotion(m),captured=move_captured(m),piece=move_piece(m),id=move_id(m);
  if(id==tt_move)return 10000000;
  if(promotion)return 200000+config[promotion];
  if(captured)return 100000+config[captured]*16-config[piece];
  if(ply<32&&search_killers[ply]==id)return 90000;
  int value=search_history[id];
  if(search_policy_enabled&&(ply&1))value+=js_round(300.0*policy_logit(m));
  return value;
}
static void search_sort(u32 *moves,int n,int ply,int tt_move){
  int priorities[512];
  for(int i=0;i<n;i++){
    u32 m=moves[i];int p=search_order(m,ply,tt_move),j=i-1;
    while(j>=0&&priorities[j]<p){moves[j+1]=moves[j];priorities[j+1]=priorities[j];j--;}
    moves[j+1]=m;priorities[j+1]=p;
  }
}

static int search_q(SearchState *s,int alpha,int beta,int ply,int remaining){
  search_nodes_count++;
  int king=s->side>0?s->wk:s->bk,check=in_check(s->side,king);
  int pos=s->halfmove?search_position_id(s):0;
  u32 moves[512];int n=0;
  if(check){
    n=generate(s->side,s->castling,s->ep,king,0);
    if(!n)return -SEARCH_MATE+ply;
    for(int i=0;i<n;i++)moves[i]=output[i];
  }
  if(search_draw(s,pos))return 0;
  if(search_nodes_count>search_node_limit&&search_iter_depth>2){
    if(!check&&!generate(s->side,s->castling,s->ep,king,2))return 0;
    search_abort=1;return evaluate(s->side,s->wk,s->bk);
  }
  int stand=check?-SEARCH_MATE:evaluate(s->side,s->wk,s->bk);
  if(ply>20)return !check&&!generate(s->side,s->castling,s->ep,king,2)?0:evaluate(s->side,s->wk,s->bk);
  if(!check){
    if(stand>=beta||remaining<=0)return generate(s->side,s->castling,s->ep,king,2)?stand:0;
    if(stand>alpha)alpha=stand;
    n=generate(s->side,s->castling,s->ep,king,1);
    if(!n)return generate(s->side,s->castling,s->ep,king,2)?stand:0;
    for(int i=0;i<n;i++)moves[i]=output[i];
  }
  search_sort(moves,n,ply,0);
  if(pos)search_enter_position(pos);
  for(int i=0;i<n;i++){
    u32 m=moves[i];
    if(!check&&!move_promotion(m)&&stand+config[move_captured(m)]+160<alpha)continue;
    SearchUndo u;search_apply(s,m,&u);
    int score=-search_q(s,-beta,-alpha,ply+1,remaining-1);
    search_undo(s,m,&u);
    if(search_abort)break;
    if(score>stand)stand=score;if(score>alpha)alpha=score;if(alpha>=beta)break;
  }
  if(pos)search_exit_position(pos);
  return stand;
}

static int search_ab(SearchState *s,int depth,int alpha,int beta,int ply){
  if(depth<=0)return search_q(s,alpha,beta,ply,search_qdepth);
  search_nodes_count++;
  int pos=search_position_id(s),original=alpha;
  SearchTTEntry *hit=search_tt_find(pos,s->halfmove,ply,search_path_signature);
  int budget_live=search_nodes_count<=search_node_limit||search_iter_depth<=2;
  if(budget_live&&hit&&hit->depth>=depth){
    if(hit->flag==0)return hit->score;
    if(hit->flag==1&&hit->score>=beta)return hit->score;
    if(hit->flag==-1&&hit->score<=alpha)return hit->score;
  }
  int king=s->side>0?s->wk:s->bk,check=in_check(s->side,king);
  int n=generate(s->side,s->castling,s->ep,king,0);
  if(!n)return check?-SEARCH_MATE+ply:0;
  if(search_draw(s,pos))return 0;
  if(!budget_live){search_abort=1;return evaluate(s->side,s->wk,s->bk);}
  u32 moves[512];for(int i=0;i<n;i++)moves[i]=output[i];
  search_sort(moves,n,ply,hit?hit->move:0);
  int best=-SEARCH_MATE,best_move=0,index=0;
  search_enter_position(pos);
  for(int i=0;i<n;i++){
    u32 m=moves[i];SearchUndo u;search_apply(s,m,&u);
    int quiet=!move_captured(m)&&!move_promotion(m),score;
    if(index==0)score=-search_ab(s,depth-1,-beta,-alpha,ply+1);
    else{
      int childking=s->side>0?s->wk:s->bk;
      int gives_check=in_check(s->side,childking);
      int reduce=depth>=3&&index>=4&&!check&&quiet&&!gives_check?1:0;
      score=-search_ab(s,depth-1-reduce,-alpha-1,-alpha,ply+1);
      if(!search_abort&&score>alpha&&(reduce||score<beta))
        score=-search_ab(s,depth-1,-beta,-alpha,ply+1);
    }
    search_undo(s,m,&u);
    if(search_abort)break;
    if(score>best){best=score;best_move=move_id(m);}
    if(score>alpha)alpha=score;
    if(alpha>=beta){
      if(quiet&&ply<32){search_killers[ply]=best_move;search_history[best_move]+=depth*depth;}
      break;
    }
    index++;
  }
  search_exit_position(pos);
  if(!search_abort){
    SearchTTEntry *slot=search_tt_slot(pos,s->halfmove,ply,search_path_signature);
    if(slot){
      slot->depth=depth;slot->score=best;slot->move=best_move;
      slot->flag=best<=original?-1:best>=beta?1:0;
    }
  }
  return best;
}

static void root_insert(u32 *moves,int *scores,int *count,u32 move,int score){
  int i=*count;
  while(i>0&&scores[i-1]<score){moves[i]=moves[i-1];scores[i]=scores[i-1];i--;}
  moves[i]=move;scores[i]=score;(*count)++;
}

int search_all(int side,int castling,int ep,int wk,int bk,int halfmove,
               int max_depth,int node_limit,int qdepth,int policy_enabled){
  SearchState s={side,castling,ep,wk,bk,halfmove};
  search_nodes_count=0;search_node_limit=node_limit;search_qdepth=qdepth;
  search_abort=0;search_depth_done=0;search_policy_enabled=policy_enabled;
  search_policy_side=-side;
  search_generation++;if(!search_generation)search_generation=1;
  search_position_count=0;search_signature_count=0;search_path_signature=0;search_path_top=0;
  for(int i=0;i<=SEARCH_POS_CAP;i++)search_path_counts[i]=0;
  for(int i=0;i<32768;i++)search_history[i]=0;
  for(int i=0;i<32;i++)search_killers[i]=0;
  int king=side>0?wk:bk,n=generate(side,castling,ep,king,0);
  if(!n)return 0;
  u32 current_moves[512],next_moves[512];int current_scores[512],next_scores[512];
  for(int i=0;i<n;i++){
    current_moves[i]=output[i];SearchUndo u;search_apply(&s,current_moves[i],&u);
    current_scores[i]=-evaluate(s.side,s.wk,s.bk);search_undo(&s,current_moves[i],&u);
  }
  for(int i=1;i<n;i++){
    u32 m=current_moves[i];int sc=current_scores[i],j=i-1;
    while(j>=0&&current_scores[j]<sc){current_moves[j+1]=current_moves[j];current_scores[j+1]=current_scores[j];j--;}
    current_moves[j+1]=m;current_scores[j+1]=sc;
  }
  int current_count=n;
  for(int depth=1;depth<=max_depth;depth++){
    search_iter_depth=depth;search_abort=0;int next_count=0,threshold=-SEARCH_MATE;
    for(int i=0;i<current_count;i++){
      u32 m=current_moves[i];SearchUndo u;search_apply(&s,m,&u);
      int score=-search_ab(&s,depth-1,-SEARCH_MATE,-threshold,1);
      search_undo(&s,m,&u);
      if(search_abort)break;
      root_insert(next_moves,next_scores,&next_count,m,score);
      if(next_count>=3)threshold=next_scores[2];
    }
    if(search_abort)break;
    current_count=next_count;
    for(int i=0;i<current_count;i++){current_moves[i]=next_moves[i];current_scores[i]=next_scores[i];}
    search_depth_done=depth;
    if(current_count&&absolute(current_scores[0])>SEARCH_MATE-100)break;
  }
  for(int i=0;i<current_count;i++){output[i]=current_moves[i];root_scores[i]=current_scores[i];}
  return current_count;
}
