/* Exact native v5.5 evaluation and StonefishChess legal move order.
   Prototype: no imports, no search, no opponent state, no runtime allocation. */
typedef signed char i8;
typedef unsigned char u8;
typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned long long u64;
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
static u64 search_attack_ray_mask[64][8],search_attack_knight_mask[64];
static u8 search_attack_ray_first[64][8];
static int search_attack_tables_ready;
static void search_init_attack_tables(void){
  if(search_attack_tables_ready)return;
  for(int square=0;square<64;square++){
    int file=square&7,rank=square>>3;
    u64 knights=0;
    for(int i=0;i<8;i++){
      int f=file+ndf[i],r=rank+ndr[i];
      if(f>=0&&f<8&&r>=0&&r<8)knights|=(u64)1<<(r*8+f);
    }
    search_attack_knight_mask[square]=knights;
    for(int d=0;d<8;d++){
      int f=file+dirs[d<<1],r=rank+dirs[(d<<1)+1],first=255;
      u64 mask=0;
      while(f>=0&&f<8&&r>=0&&r<8){
        int sq=r*8+f;if(first==255)first=sq;mask|=(u64)1<<sq;
        f+=dirs[d<<1];r+=dirs[(d<<1)+1];
      }
      search_attack_ray_mask[square][d]=mask;
      search_attack_ray_first[square][d]=(u8)first;
    }
  }
  search_attack_tables_ready=1;
}
static int search_attacked_occ(int square,int by_side,u64 occupied){
  int file=square&7,rank=square>>3,r=rank-by_side;
  if(r>=0&&r<8){
    if(file>0&&board[r*8+file-1]==by_side)return 1;
    if(file<7&&board[r*8+file+1]==by_side)return 1;
  }
  u64 knights=search_attack_knight_mask[square];
  int knight=by_side*2;
  while(knights){
    int sq=__builtin_ctzll(knights);knights&=knights-1;
    if(board[sq]==knight)return 1;
  }
  int queen=by_side*5,king=by_side*6;
  static const u8 increasing[8]={1,0,1,0,1,0,1,0};
  for(int d=0;d<8;d++){
    u64 blockers=occupied&search_attack_ray_mask[square][d];
    if(!blockers)continue;
    int sq=increasing[d]?__builtin_ctzll(blockers):63-__builtin_clzll(blockers);
    int p=board[sq],slider=by_side*(d<4?3:4);
    if(p==queen||p==slider||(sq==search_attack_ray_first[square][d]&&p==king))return 1;
  }
  return 0;
}
int in_check(int side,int king){return attacked(king,-side);}
static int gen_side,gen_king,gen_mode,gen_count,gen_search_fast;
static u64 gen_search_occ;
static int gen_attacked(int square,int by_side,u64 occupied){
  return gen_search_fast?search_attacked_occ(square,by_side,occupied):attacked(square,by_side);
}
static int emit(int from,int to,int promotion,int flags){
  int moving=board[from],target=board[to],captured=flags&2?1:absolute(target);
  if(gen_mode==1&&!captured&&!promotion)return 0;
  int ep_square=-1,ep_piece=0,rook_from=-1,rook_to=-1,rook_piece=0;
  u64 occupied=gen_search_occ;
  if(gen_search_fast){
    occupied&=~((u64)1<<from);occupied|=(u64)1<<to;
  }
  board[from]=0;board[to]=promotion?gen_side*promotion:moving;
  if(flags&2){
    ep_square=to-gen_side*8;ep_piece=board[ep_square];board[ep_square]=0;
    if(gen_search_fast)occupied&=~((u64)1<<ep_square);
  }
  if(flags&12){
    rook_from=gen_side==1?(flags&4?7:0):(flags&4?63:56);
    rook_to=gen_side==1?(flags&4?5:3):(flags&4?61:59);
    rook_piece=board[rook_from];board[rook_to]=rook_piece;board[rook_from]=0;
    if(gen_search_fast){occupied&=~((u64)1<<rook_from);occupied|=(u64)1<<rook_to;}
  }
  int safe=!gen_attacked(absolute(moving)==6?to:gen_king,-gen_side,occupied);
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
  gen_search_fast=0;
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
      if((castling&1)&&board[7]==4&&!board[5]&&!board[6]&&!gen_attacked(4,-1,gen_search_occ)&&!gen_attacked(5,-1,gen_search_occ)&&!gen_attacked(6,-1,gen_search_occ)&&emit(4,6,0,4))return 1;
      if((castling&2)&&board[0]==4&&!board[1]&&!board[2]&&!board[3]&&!gen_attacked(4,-1,gen_search_occ)&&!gen_attacked(3,-1,gen_search_occ)&&!gen_attacked(2,-1,gen_search_occ)&&emit(4,2,0,8))return 1;
    }else if(type==6&&side==-1&&from==60){
      if((castling&4)&&board[63]==-4&&!board[61]&&!board[62]&&!gen_attacked(60,1,gen_search_occ)&&!gen_attacked(61,1,gen_search_occ)&&!gen_attacked(62,1,gen_search_occ)&&emit(60,62,0,4))return 1;
      if((castling&8)&&board[56]==-4&&!board[57]&&!board[58]&&!board[59]&&!gen_attacked(60,1,gen_search_occ)&&!gen_attacked(59,1,gen_search_occ)&&!gen_attacked(58,1,gen_search_occ)&&emit(60,58,0,8))return 1;
    }
  }
  return gen_mode==2?0:gen_count;
}


/* ARMX compiled search accelerator. Search stays self-contained inside the
   helper module so extra depth does not pay the JavaScript/WASM boundary on
   every node. No persistent opponent state is stored here; JS supplies only
   the frozen per-search quiet-choice weights. */
static int root_scores[512],root_exact[512];
static double policy_weights[13];
#define SEARCH_PUBLIC_INPUT_CAP 512
#define SEARCH_PUBLIC_CAP 1024
static u16 search_public_keys_input[SEARCH_PUBLIC_INPUT_CAP*17];
static int search_public_counts_input[SEARCH_PUBLIC_INPUT_CAP];
static int search_history[32768],search_killers[32];
static u32 search_history_generation[32768];
static int search_nodes_count,search_node_limit,search_qdepth,search_abort,search_iter_depth;
static int search_depth_done,search_policy_enabled,search_policy_side;
static const int SEARCH_MATE=20000000;
#define SEARCH_POLICY_DIRECT_CAP 65536
typedef struct {u32 generation;short priority;signed char low;unsigned char pad;} SearchPolicyDirectEntry;
static SearchPolicyDirectEntry search_policy_direct[SEARCH_POLICY_DIRECT_CAP];

#define SEARCH_POS_CAP 16384
#define SEARCH_PATH_CAP 32768
#define SEARCH_TT_CAP 32768
typedef struct {
  u32 generation,hash;
  u16 id;
  i8 side,ep;
  unsigned char castling,pad[3];
  u64 packed[4];
} SearchPositionEntry;
typedef struct {
  u32 generation;
  u16 parent,pos,signature,pad;
} SearchPathEntry;
typedef struct {
  u32 generation;
  int score,halfmove;
  u16 pos,path,move,ply,depth;
  i8 flag;
  unsigned char pad;
} SearchTTEntry;
typedef struct {
  u32 generation,hash;
  int count;
  u16 meta,pad;
  u64 packed[4];
} SearchPublicEntry;
static SearchPositionEntry search_positions[SEARCH_POS_CAP];
static SearchPathEntry search_paths[SEARCH_PATH_CAP];
static SearchTTEntry search_tt[SEARCH_TT_CAP];
static SearchPublicEntry search_public[SEARCH_PUBLIC_CAP];
static int search_position_public_counts[SEARCH_POS_CAP+1];
static int search_path_counts[SEARCH_POS_CAP+1];
static int search_path_stack[64],search_path_top,search_path_signature;
static int search_position_count,search_signature_count;
static u32 search_generation,search_public_generation;
static u64 search_packed_board[4];
static u32 search_white_pawn_files,search_black_pawn_files;
static u64 search_white_pawns,search_black_pawns,search_white_rooks,search_black_rooks,search_white_occ,search_black_occ;
static u64 search_white_passed_mask[64],search_black_passed_mask[64];
static u64 search_white_shield_mask[64],search_black_shield_mask[64];
static int search_eval_masks_ready;

int scores_ptr(void){return (int)(unsigned long)root_scores;}
int exact_ptr(void){return (int)(unsigned long)root_exact;}
int policy_ptr(void){return (int)(unsigned long)policy_weights;}
int public_keys_ptr(void){return (int)(unsigned long)search_public_keys_input;}
int public_counts_ptr(void){return (int)(unsigned long)search_public_counts_input;}
int search_nodes(void){return search_nodes_count;}
int search_depth(void){return search_depth_done;}

typedef struct {
  int side,castling,ep,wk,bk,halfmove,material;
  u32 hash;
  int eval_mg,eval_eg,eval_phase,white_bishops,black_bishops;
} SearchState;
typedef struct {
  i8 moving,captured;
} SearchBoardUndo;

static int move_from(u32 m){return m&63;}
static int move_to(u32 m){return (m>>6)&63;}
static int move_piece(u32 m){return (m>>12)&7;}
static int move_captured(u32 m){return (m>>15)&7;}
static int move_promotion(u32 m){return (m>>18)&7;}
static int move_flags(u32 m){return (int)(m>>21);}
static int move_id(u32 m){return move_from(m)|(move_to(m)<<6)|(move_promotion(m)<<12);}

static u32 search_hash_mix(u32 x){
  x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;x^=x>>16;return x;
}
static u32 search_piece_token(int sq,int piece){
  return search_hash_mix((u32)(sq+1)*0x9e3779b9u^(u32)(piece+7)*0x85ebca6bu);
}
static u32 search_meta_token(int side,int castling,int ep){
  return search_hash_mix((u32)(side+2)*0x27d4eb2du^(u32)(castling+1)*0x165667b1u^(u32)(ep+2)*0xd3a2646cu);
}
static u32 search_initial_hash(const SearchState *s){
  u32 h=search_meta_token(s->side,s->castling,s->ep);
  for(int sq=0;sq<64;sq++)if(board[sq])h^=search_piece_token(sq,board[sq]);
  return h;
}
static void search_init_packed_board(void){
  for(int word=0;word<4;word++){
    u64 value=0;
    for(int i=0;i<16;i++)value|=(u64)(board[(word<<4)+i]+6)<<(i<<2);
    search_packed_board[word]=value;
  }
}
static void search_init_eval_masks(void){
  if(search_eval_masks_ready)return;
  for(int sq=0;sq<64;sq++){
    int f=sq&7,r=sq>>3;
    u64 wpass=0,bpass=0,wshield=0,bshield=0;
    u64 files=((u64)0x0101010101010101ULL)<<f;
    if(f>0)files|=((u64)0x0101010101010101ULL)<<(f-1);
    if(f<7)files|=((u64)0x0101010101010101ULL)<<(f+1);
    wpass=files&(sq==63?0:(~(u64)0<<(sq+1)));
    bpass=files&(sq==0?0:(((u64)1<<sq)-1));
    for(int df=-1;df<=1;df++){
      int ff=f+df;
      if(ff<0||ff>7)continue;
      if(r<7)wshield|=(u64)1<<((r+1)*8+ff);
      if(r>0)bshield|=(u64)1<<((r-1)*8+ff);
    }
    search_white_passed_mask[sq]=wpass;
    search_black_passed_mask[sq]=bpass;
    search_white_shield_mask[sq]=wshield;
    search_black_shield_mask[sq]=bshield;
  }
  search_eval_masks_ready=1;
}
static void search_set_packed_square(int sq,int value){
  int word=sq>>4,shift=(sq&15)<<2;
  u64 mask=(u64)15<<shift;
  search_packed_board[word]=(search_packed_board[word]&~mask)|((u64)(value+6)<<shift);
}
static int search_phase_piece(int type){return type==2||type==3?1:type==4?2:type==5?4:0;}
static const u32 search_file_count_masks[8]={
  0x0000000fu,0x000000f0u,0x00000f00u,0x0000f000u,
  0x000f0000u,0x00f00000u,0x0f000000u,0xf0000000u
};
static const u32 search_adjacent_file_count_masks[8]={
  0x000000f0u,0x00000f0fu,0x0000f0f0u,0x000f0f00u,
  0x00f0f000u,0x0f0f0000u,0xf0f00000u,0x0f000000u
};
static int search_file_count(u32 packed,int file){return (int)((packed>>(file<<2))&15u);}
static void search_file_adjust(u32 *packed,int file,int delta){
  u32 unit=1u<<(file<<2);if(delta>0)*packed+=unit;else *packed-=unit;
}
static u64 search_file_mask(int file){return ((u64)0x0101010101010101ULL)<<file;}
static void search_mirror_piece(int sq,int piece,int direction){
  int side=piece>0?1:-1,type=absolute(piece);u64 bit=(u64)1<<sq;
  if(side>0){if(direction>0)search_white_occ|=bit;else search_white_occ&=~bit;}
  else{if(direction>0)search_black_occ|=bit;else search_black_occ&=~bit;}
  if(type==1){
    if(side>0){
      if(direction>0)search_white_pawns|=bit;else search_white_pawns&=~bit;
      search_file_adjust(&search_white_pawn_files,sq&7,direction);
    }else{
      if(direction>0)search_black_pawns|=bit;else search_black_pawns&=~bit;
      search_file_adjust(&search_black_pawn_files,sq&7,direction);
    }
  }else if(type==4){
    if(side>0){if(direction>0)search_white_rooks|=bit;else search_white_rooks&=~bit;}
    else{if(direction>0)search_black_rooks|=bit;else search_black_rooks&=~bit;}
  }
}
static void search_eval_piece(SearchState *s,int sq,int piece,int direction){
  int side=piece>0?1:-1,type=absolute(piece),ps=side>0?sq:sq^56;
  const int *pst=config+7,*ending=config+7+448;
  s->eval_mg+=direction*side*(config[type]+pst[type*64+ps]);
  s->eval_eg+=direction*side*(config[type]+ending[type*64+ps]);
  s->eval_phase+=direction*search_phase_piece(type);
  search_mirror_piece(sq,piece,direction);
  if(type==3){if(side>0)s->white_bishops+=direction;else s->black_bishops+=direction;}
}
static void search_initial_eval(SearchState *s){
  s->eval_mg=s->eval_eg=s->eval_phase=0;
  s->white_bishops=s->black_bishops=0;
  search_white_pawn_files=search_black_pawn_files=0;
  search_white_pawns=search_black_pawns=search_white_rooks=search_black_rooks=0;
  search_white_occ=search_black_occ=0;
  for(int sq=0;sq<64;sq++)if(board[sq])search_eval_piece(s,sq,board[sq],1);
}
static void search_initial_state(SearchState *s){
  s->eval_mg=s->eval_eg=s->eval_phase=0;
  s->white_bishops=s->black_bishops=0;
  search_white_pawn_files=search_black_pawn_files=0;
  search_white_pawns=search_black_pawns=search_white_rooks=search_black_rooks=0;
  search_white_occ=search_black_occ=0;
  for(int word=0;word<4;word++)search_packed_board[word]=0;
  u32 hash=search_meta_token(s->side,s->castling,s->ep);
  int material=0;
  for(int sq=0;sq<64;sq++){
    int piece=board[sq];
    search_packed_board[sq>>4]|=(u64)(piece+6)<<((sq&15)<<2);
    if(!piece)continue;
    hash^=search_piece_token(sq,piece);
    search_eval_piece(s,sq,piece,1);
    int type=absolute(piece);
    if(type==1||type==4||type==5)material++;
  }
  s->hash=hash;s->material=material;
}
static void search_hash_set_square(SearchState *s,int sq,int value){
  int old=board[sq];
  if(old){s->hash^=search_piece_token(sq,old);search_eval_piece(s,sq,old,-1);}
  if(value){s->hash^=search_piece_token(sq,value);search_eval_piece(s,sq,value,1);}
  search_set_packed_square(sq,value);
  board[sq]=(i8)value;
}

static void search_apply_child(const SearchState *parent,SearchState *s,u32 m,SearchBoardUndo *u){
  *s=*parent;
  int from=move_from(m),to=move_to(m),flags=move_flags(m);
  int moving=board[from],capture_sq=(flags&2)?to-s->side*8:to;
  u->moving=(i8)moving;u->captured=board[capture_sq];
  s->hash^=search_meta_token(s->side,s->castling,s->ep);
  search_hash_set_square(s,from,0);
  if(flags&2)search_hash_set_square(s,capture_sq,0);
  search_hash_set_square(s,to,move_promotion(m)?s->side*move_promotion(m):moving);
  if(absolute(moving)==6){
    if(s->side>0)s->wk=to;else s->bk=to;
    if(s->side>0)s->castling&=~3;else s->castling&=~12;
    if(flags&4){
      int rf=s->side>0?7:63,rt=s->side>0?5:61;
      int rook=board[rf];search_hash_set_square(s,rf,0);search_hash_set_square(s,rt,rook);
    }else if(flags&8){
      int rf=s->side>0?0:56,rt=s->side>0?3:59;
      int rook=board[rf];search_hash_set_square(s,rf,0);search_hash_set_square(s,rt,rook);
    }
  }
  if(from==0||to==0)s->castling&=~2;
  if(from==7||to==7)s->castling&=~1;
  if(from==56||to==56)s->castling&=~8;
  if(from==63||to==63)s->castling&=~4;
  s->ep=-1;
  if(absolute(moving)==1&&absolute(to-from)==16)s->ep=(from+to)>>1;
  s->halfmove=(absolute(moving)==1||u->captured)?0:s->halfmove+1;
  int captured_type=move_captured(m),promotion=move_promotion(m),piece=move_piece(m);
  if(captured_type==1||captured_type==4||captured_type==5)s->material--;
  if(piece==1&&promotion&&(promotion==2||promotion==3))s->material--;
  s->side=-s->side;
  s->hash^=search_meta_token(s->side,s->castling,s->ep);
}
static void search_restore_square(int sq,int value){
  int old=board[sq];
  if(old)search_mirror_piece(sq,old,-1);
  if(value)search_mirror_piece(sq,value,1);
  search_set_packed_square(sq,value);board[sq]=(i8)value;
}
static void search_undo_board(int side,u32 m,const SearchBoardUndo *u){
  int flags=move_flags(m),from=move_from(m),to=move_to(m);
  if(flags&4){
    int rf=side>0?7:63,rt=side>0?5:61,rook=board[rt];
    search_restore_square(rf,rook);search_restore_square(rt,0);
  }else if(flags&8){
    int rf=side>0?0:56,rt=side>0?3:59,rook=board[rt];
    search_restore_square(rf,rook);search_restore_square(rt,0);
  }
  search_restore_square(from,u->moving);
  if(flags&2){search_restore_square(to,0);search_restore_square(to-side*8,u->captured);}
  else search_restore_square(to,u->captured);
}

static int search_generate(const SearchState *s,int mode){
  int side=s->side,castling=s->castling,ep=s->ep,king=side>0?s->wk:s->bk;
  gen_search_fast=1;gen_search_occ=search_white_occ|search_black_occ;
  gen_side=side;gen_king=king;gen_mode=mode;gen_count=0;
  u64 occupied=side>0?search_white_occ:search_black_occ;
  while(occupied){
    int from=__builtin_ctzll(occupied);occupied&=occupied-1;
    int p=board[from],type=absolute(p),file=from&7,rank=from>>3;
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
      for(int i=0;i<8;i++){int ff=file+ndf[i],r=rank+ndr[i];if(ff<0||ff>7||r<0||r>7)continue;int to=r*8+ff;if((!board[to]||((board[to]>0?1:-1)==-side))&&emit(from,to,0,0))return 1;}
      continue;
    }
    int start=type==4?8:0,end=type==3?8:16;
    for(int i=start;i<end;i+=2){
      int ff=file+dirs[i],r=rank+dirs[i+1];
      while(ff>=0&&ff<8&&r>=0&&r<8){
        int to=r*8+ff;
        if(!board[to]){if(emit(from,to,0,0))return 1;}
        else{if(((board[to]>0?1:-1)==-side)&&emit(from,to,0,0))return 1;break;}
        if(type==6)break;ff+=dirs[i];r+=dirs[i+1];
      }
    }
    if(type==6&&side==1&&from==4){
      if((castling&1)&&board[7]==4&&!board[5]&&!board[6]&&!gen_attacked(4,-1,gen_search_occ)&&!gen_attacked(5,-1,gen_search_occ)&&!gen_attacked(6,-1,gen_search_occ)&&emit(4,6,0,4))return 1;
      if((castling&2)&&board[0]==4&&!board[1]&&!board[2]&&!board[3]&&!gen_attacked(4,-1,gen_search_occ)&&!gen_attacked(3,-1,gen_search_occ)&&!gen_attacked(2,-1,gen_search_occ)&&emit(4,2,0,8))return 1;
    }else if(type==6&&side==-1&&from==60){
      if((castling&4)&&board[63]==-4&&!board[61]&&!board[62]&&!gen_attacked(60,1,gen_search_occ)&&!gen_attacked(61,1,gen_search_occ)&&!gen_attacked(62,1,gen_search_occ)&&emit(60,62,0,4))return 1;
      if((castling&8)&&board[56]==-4&&!board[57]&&!board[58]&&!board[59]&&!gen_attacked(60,1,gen_search_occ)&&!gen_attacked(59,1,gen_search_occ)&&!gen_attacked(58,1,gen_search_occ)&&emit(60,58,0,8))return 1;
    }
  }
  return mode==2?0:gen_count;
}

int search_evaluate_fast(int side,int white_king,int black_king){
  int mg=0,eg=0,phase=0,wb=0,bb=0,wp[8]={0},bp[8]={0};
  int white[16],black[16],wc=0,bc=0,wrooks[10],brooks[10],wrc=0,brc=0;
  int wmin[8]={99,99,99,99,99,99,99,99},bmax[8]={-1,-1,-1,-1,-1,-1,-1,-1};
  const int *pst=config+7,*ending=config+7+448;
  for(int sq=0;sq<64;sq++){
    int p=board[sq];if(!p)continue;
    int s=p>0?1:-1,type=absolute(p),ps=s>0?sq:sq^56,file=sq&7;
    mg+=s*(config[type]+pst[type*64+ps]);eg+=s*(config[type]+ending[type*64+ps]);
    phase+=type==2||type==3?1:type==4?2:type==5?4:0;
    if(type==1){
      if(s>0){wp[file]++;white[wc++]=sq;if(sq<wmin[file])wmin[file]=sq;}
      else{bp[file]++;black[bc++]=sq;if(sq>bmax[file])bmax[file]=sq;}
    }else if(type==3){if(s>0)wb++;else bb++;}
    else if(type==4){if(s>0)wrooks[wrc++]=sq;else brooks[brc++]=sq;}
  }
  static const int middle[8]={0,0,8,17,35,65,110,0},endingPawn[8]={0,0,15,32,65,120,210,0};
  for(int i=0;i<wc;i++){
    int sq=white[i],f=sq&7,r=sq>>3;
    if(wp[f]>1){mg-=12;eg-=16;}
    if(!(f>0&&wp[f-1])&&!(f<7&&wp[f+1])){mg-=11;eg-=15;}
    int passed=1;
    for(int ff=f>0?f-1:f;ff<=(f<7?f+1:f);ff++)if(bmax[ff]>sq){passed=0;break;}
    if(passed){
      mg+=middle[r];eg+=endingPawn[r];
      if(r>=4){
        int ed=maximum(absolute((black_king&7)-f),absolute((black_king>>3)-7));
        int od=maximum(absolute((white_king&7)-f),absolute((white_king>>3)-7));
        eg+=(ed-od)*r*3;
      }
    }
  }
  for(int i=0;i<bc;i++){
    int sq=black[i],f=sq&7,r=7-(sq>>3);
    if(bp[f]>1){mg+=12;eg+=16;}
    if(!(f>0&&bp[f-1])&&!(f<7&&bp[f+1])){mg+=11;eg+=15;}
    int passed=1;
    for(int ff=f>0?f-1:f;ff<=(f<7?f+1:f);ff++)if(wmin[ff]<sq){passed=0;break;}
    if(passed){
      mg-=middle[r];eg-=endingPawn[r];
      if(r>=4){
        int ed=maximum(absolute((white_king&7)-f),absolute((white_king>>3)-0));
        int od=maximum(absolute((black_king&7)-f),absolute((black_king>>3)-0));
        eg-=(ed-od)*r*3;
      }
    }
  }
  if(wb>=2){mg+=30;eg+=45;}if(bb>=2){mg-=30;eg-=45;}
  for(int i=0;i<wrc;i++){int f=wrooks[i]&7;if(!wp[f]){mg+=bp[f]?15:30;eg+=15;}}
  for(int i=0;i<brc;i++){int f=brooks[i]&7;if(!bp[f]){mg-=wp[f]?15:30;eg-=15;}}
  int shield=0,wf=white_king&7;
  for(int df=-1;df<=1;df++){if(wf+df<0||wf+df>7)continue;int x=white_king+8+df;if(x>=0&&x<64&&board[x]==1)shield++;}
  mg+=shield*12;shield=0;
  int bf=black_king&7;
  for(int df=-1;df<=1;df++){if(bf+df<0||bf+df>7)continue;int x=black_king-8+df;if(x>=0&&x<64&&board[x]==-1)shield++;}
  mg-=shield*12;
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


static int search_evaluate_state(const SearchState *s){
  int mg=s->eval_mg,eg=s->eval_eg,phase=s->eval_phase;
  static const int middle[8]={0,0,8,17,35,65,110,0},endingPawn[8]={0,0,15,32,65,120,210,0};
  u64 pawns=search_white_pawns;
  while(pawns){
    int sq=__builtin_ctzll(pawns);pawns&=pawns-1;
    int f=sq&7,r=sq>>3,own=search_file_count(search_white_pawn_files,f);
    if(own>1){mg-=12;eg-=16;}
    if(!(search_white_pawn_files&search_adjacent_file_count_masks[f])){mg-=11;eg-=15;}
    if(!(search_black_pawns&search_white_passed_mask[sq])){
      mg+=middle[r];eg+=endingPawn[r];
      if(r>=4){
        int ed=maximum(absolute((s->bk&7)-f),absolute((s->bk>>3)-7));
        int od=maximum(absolute((s->wk&7)-f),absolute((s->wk>>3)-7));
        eg+=(ed-od)*r*3;
      }
    }
  }
  pawns=search_black_pawns;
  while(pawns){
    int sq=__builtin_ctzll(pawns);pawns&=pawns-1;
    int f=sq&7,r=7-(sq>>3),own=search_file_count(search_black_pawn_files,f);
    if(own>1){mg+=12;eg+=16;}
    if(!(search_black_pawn_files&search_adjacent_file_count_masks[f])){mg+=11;eg+=15;}
    if(!(search_white_pawns&search_black_passed_mask[sq])){
      mg-=middle[r];eg-=endingPawn[r];
      if(r>=4){
        int ed=maximum(absolute((s->wk&7)-f),absolute((s->wk>>3)-0));
        int od=maximum(absolute((s->bk&7)-f),absolute((s->bk>>3)-0));
        eg-=(ed-od)*r*3;
      }
    }
  }
  if(s->white_bishops>=2){mg+=30;eg+=45;}if(s->black_bishops>=2){mg-=30;eg-=45;}
  u64 rooks=search_white_rooks;
  while(rooks){
    int sq=__builtin_ctzll(rooks);rooks&=rooks-1;int f=sq&7;
    if(!(search_white_pawn_files&search_file_count_masks[f])){mg+=(search_black_pawn_files&search_file_count_masks[f])?15:30;eg+=15;}
  }
  rooks=search_black_rooks;
  while(rooks){
    int sq=__builtin_ctzll(rooks);rooks&=rooks-1;int f=sq&7;
    if(!(search_black_pawn_files&search_file_count_masks[f])){mg-=(search_white_pawn_files&search_file_count_masks[f])?15:30;eg-=15;}
  }
  mg+=__builtin_popcountll(search_white_pawns&search_white_shield_mask[s->wk])*12;
  mg-=__builtin_popcountll(search_black_pawns&search_black_shield_mask[s->bk])*12;
  if(phase>24)phase=24;
  double score=(mg*phase+eg*(24-phase))/24.0;
  if(phase<=4&&absolute(eg)>400){
    int winner=eg>0?1:-1,loser=winner>0?s->bk:s->wk,king=winner>0?s->wk:s->bk;
    int edge=maximum(absolute(2*(loser&7)-7),absolute(2*(loser>>3)-7));
    int proximity=14-absolute((king&7)-(loser&7))-absolute((king>>3)-(loser>>3));
    score+=winner*(edge*10+proximity*6);
  }
  return (int)__builtin_floor(score*s->side+0.5)+8;
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

static u32 search_public_key_hash(const u16 *key){
  u32 h=2166136261u;
  for(int i=0;i<17;i++){h^=(u32)key[i];h*=16777619u;}
  return h;
}
static void search_public_store_key(SearchPublicEntry *e,const u16 *key){
  for(int word=0;word<4;word++){
    int i=word<<2;
    e->packed[word]=(u64)key[i]|((u64)key[i+1]<<16)|((u64)key[i+2]<<32)|((u64)key[i+3]<<48);
  }
  e->meta=key[16];
}
static int search_public_input_equal(const SearchPublicEntry *e,const u16 *key){
  if(e->meta!=key[16])return 0;
  for(int word=0;word<4;word++){
    int i=word<<2;
    u64 packed=(u64)key[i]|((u64)key[i+1]<<16)|((u64)key[i+2]<<32)|((u64)key[i+3]<<48);
    if(e->packed[word]!=packed)return 0;
  }
  return 1;
}
static u32 search_public_state_hash(const SearchState *s){
  u32 h=2166136261u;
  for(int i=0;i<16;i++){h^=(u16)(search_packed_board[i>>2]>>((i&3)<<4));h*=16777619u;}
  h^=(u16)((s->side==1?1:0)|(s->castling<<1)|((s->ep+1)<<5));h*=16777619u;
  return h;
}
static int search_public_state_equal(const SearchPublicEntry *e,const SearchState *s){
  if(e->meta!=(u16)((s->side==1?1:0)|(s->castling<<1)|((s->ep+1)<<5)))return 0;
  for(int i=0;i<4;i++)if(e->packed[i]!=search_packed_board[i])return 0;
  return 1;
}
static void search_public_build(int count,int reset,int changed_from){
  if(count<0)count=0;if(count>SEARCH_PUBLIC_INPUT_CAP)count=SEARCH_PUBLIC_INPUT_CAP;
  if(reset||!search_public_generation){
    search_public_generation++;if(!search_public_generation)search_public_generation=1;
    changed_from=0;
  }
  if(changed_from<0)changed_from=0;if(changed_from>count)changed_from=count;
  for(int i=changed_from;i<count;i++){
    const u16 *key=search_public_keys_input+i*17;
    u32 hash=search_public_key_hash(key),slot=hash&(SEARCH_PUBLIC_CAP-1);
    for(int probe=0;probe<SEARCH_PUBLIC_CAP;probe++,slot=(slot+1)&(SEARCH_PUBLIC_CAP-1)){
      SearchPublicEntry *e=&search_public[slot];
      if(e->generation!=search_public_generation){
        e->generation=search_public_generation;e->hash=hash;e->count=search_public_counts_input[i];
        search_public_store_key(e,key);break;
      }
      if(e->hash==hash&&search_public_input_equal(e,key)){e->count=search_public_counts_input[i];break;}
    }
  }
}
static int search_public_lookup(const SearchState *s){
  u32 hash=search_public_state_hash(s),slot=hash&(SEARCH_PUBLIC_CAP-1);
  for(int probe=0;probe<SEARCH_PUBLIC_CAP;probe++,slot=(slot+1)&(SEARCH_PUBLIC_CAP-1)){
    SearchPublicEntry *e=&search_public[slot];
    if(e->generation!=search_public_generation)return 0;
    if(e->hash==hash&&search_public_state_equal(e,s))return e->count;
  }
  return 0;
}
static u32 search_position_hash(const SearchState *s){return s->hash;}
static int search_position_equal(const SearchPositionEntry *e,const SearchState *s){
  if(e->side!=s->side||e->castling!=s->castling||e->ep!=s->ep)return 0;
  for(int i=0;i<4;i++)if(e->packed[i]!=search_packed_board[i])return 0;
  return 1;
}
static int search_position_id(const SearchState *s){
  u32 hash=search_position_hash(s),slot=hash&(SEARCH_POS_CAP-1);
  for(int probe=0;probe<SEARCH_POS_CAP;probe++,slot=(slot+1)&(SEARCH_POS_CAP-1)){
    SearchPositionEntry *e=&search_positions[slot];
    if(e->generation!=search_generation){
      e->generation=search_generation;e->hash=hash;e->side=s->side;e->castling=s->castling;e->ep=s->ep;
      for(int i=0;i<4;i++)e->packed[i]=search_packed_board[i];
      e->id=++search_position_count;
      search_path_counts[e->id]=0;
      search_position_public_counts[e->id]=s->halfmove>=8?search_public_lookup(s):0;
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
  if(s->halfmove>=8&&pos&&search_position_public_counts[pos]+search_path_counts[pos]+1>=3)return 1;
  return s->material==0&&search_insufficient();
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
static double policy_logit_uncached(u32 m){
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
static SearchPolicyDirectEntry *policy_direct_entry(u32 m){
  u32 key=(u32)move_from(m)|((u32)move_to(m)<<6)|((u32)(move_piece(m)-1)<<12)
    |((move_flags(m)&12)?32768u:0u);
  SearchPolicyDirectEntry *e=&search_policy_direct[key];
  if(e->generation!=search_generation){
    double value=policy_logit_uncached(m);
    e->generation=search_generation;
    e->priority=js_round(300.0*value);
    e->low=value<0.0;
  }
  return e;
}
static int search_order(u32 m,int ply,int tt_move){
  int promotion=move_promotion(m),captured=move_captured(m),piece=move_piece(m),id=move_id(m);
  if(id==tt_move)return 10000000;
  if(promotion)return 200000+config[promotion];
  if(captured)return 100000+config[captured]*16-config[piece];
  if(ply<32&&search_killers[ply]==id)return 90000;
  int value=search_history_generation[id]==search_generation?search_history[id]:0;
  if(search_policy_enabled&&(ply&1))value+=policy_direct_entry(m)->priority;
  return value;
}
static int search_order_priorities[32][512];
static int *search_prepare_order(u32 *moves,int n,int ply,int tt_move){
  int *priorities=search_order_priorities[ply<32?ply:31];
  for(int i=0;i<n;i++)priorities[i]=search_order(moves[i],ply,tt_move);
  return priorities;
}
static u32 search_pick_ordered(u32 *moves,int *priorities,int n,int index){
  int best=index;
  for(int i=index+1;i<n;i++)if(priorities[i]>priorities[best])best=i;
  if(best!=index){
    u32 move=moves[best];int priority=priorities[best];
    for(int i=best;i>index;i--){moves[i]=moves[i-1];priorities[i]=priorities[i-1];}
    moves[index]=move;priorities[index]=priority;
  }
  return moves[index];
}

static int search_q(SearchState *s,int alpha,int beta,int ply,int remaining){
  search_nodes_count++;
  int king=s->side>0?s->wk:s->bk,check=search_attacked_occ(king,-s->side,search_white_occ|search_black_occ);
  int pos=s->halfmove?search_position_id(s):0;
  u32 moves[512];int n=0;
  if(check){
    n=search_generate(s,0);
    if(!n)return -SEARCH_MATE+ply;
    for(int i=0;i<n;i++)moves[i]=output[i];
  }
  if(search_draw(s,pos))return 0;
  if(search_nodes_count>search_node_limit&&search_iter_depth>2){
    if(!check&&!search_generate(s,2))return 0;
    search_abort=1;return search_evaluate_state(s);
  }
  int stand=check?-SEARCH_MATE:search_evaluate_state(s);
  if(ply>20)return !check&&!search_generate(s,2)?0:search_evaluate_state(s);
  if(!check){
    if(stand>=beta||remaining<=0)return search_generate(s,2)?stand:0;
    if(stand>alpha)alpha=stand;
    n=search_generate(s,1);
    if(!n)return search_generate(s,2)?stand:0;
    for(int i=0;i<n;i++)moves[i]=output[i];
  }
  int *priorities=search_prepare_order(moves,n,ply,0);
  if(pos)search_enter_position(pos);
  for(int i=0;i<n;i++){
    u32 m=search_pick_ordered(moves,priorities,n,i);
    if(!check&&!move_promotion(m)&&stand+config[move_captured(m)]+160<alpha)continue;
    SearchState child;SearchBoardUndo u;search_apply_child(s,&child,m,&u);
    int score=-search_q(&child,-beta,-alpha,ply+1,remaining-1);
    search_undo_board(s->side,m,&u);
    if(search_abort)break;
    if(score>stand)stand=score;if(score>alpha)alpha=score;if(alpha>=beta)break;
  }
  if(pos)search_exit_position(pos);
  return stand;
}

static int search_ab(SearchState *s,int depth,int alpha,int beta,int ply,u32 last_move){
  if(depth<=0)return search_q(s,alpha,beta,ply,search_qdepth);
  if(search_policy_enabled&&depth==1&&ply>=2&&!(ply&1)&&beta-alpha<=1&&last_move
    &&!move_captured(last_move)&&!move_promotion(last_move)&&move_piece(last_move)!=6){
    int king=s->side>0?s->wk:s->bk;
    if(!search_attacked_occ(king,-s->side,search_white_occ|search_black_occ)&&policy_direct_entry(last_move)->low){
      int probe=search_q(s,alpha,beta,ply,search_qdepth);
      if(search_abort||probe>=beta)return probe;
    }
  }
  search_nodes_count++;
  int pos=search_position_id(s),original=alpha;
  SearchTTEntry *hit=search_tt_find(pos,s->halfmove,ply,search_path_signature);
  int budget_live=search_nodes_count<=search_node_limit||search_iter_depth<=2;
  if(budget_live&&hit&&hit->depth>=depth){
    if(hit->flag==0)return hit->score;
    if(hit->flag==1&&hit->score>=beta)return hit->score;
    if(hit->flag==-1&&hit->score<=alpha)return hit->score;
  }
  int king=s->side>0?s->wk:s->bk,check=search_attacked_occ(king,-s->side,search_white_occ|search_black_occ);
  int n=search_generate(s,0);
  if(!n)return check?-SEARCH_MATE+ply:0;
  if(search_draw(s,pos))return 0;
  if(!budget_live){search_abort=1;return search_evaluate_state(s);}
  u32 moves[512];for(int i=0;i<n;i++)moves[i]=output[i];
  int *priorities=search_prepare_order(moves,n,ply,hit?hit->move:0);
  int best=-SEARCH_MATE,best_move=0,index=0;
  search_enter_position(pos);
  for(int i=0;i<n;i++){
    u32 m=search_pick_ordered(moves,priorities,n,i);SearchState child;SearchBoardUndo u;
    search_apply_child(s,&child,m,&u);
    int quiet=!move_captured(m)&&!move_promotion(m),score;
    if(index==0)score=-search_ab(&child,depth-1,-beta,-alpha,ply+1,m);
    else{
      int childking=child.side>0?child.wk:child.bk;
      int gives_check=search_attacked_occ(childking,-child.side,search_white_occ|search_black_occ);
      int reduce=depth>=3&&index>=4&&!check&&quiet&&!gives_check?1:0;
      score=-search_ab(&child,depth-1-reduce,-alpha-1,-alpha,ply+1,m);
      if(!search_abort&&score>alpha&&(reduce||score<beta))
        score=-search_ab(&child,depth-1,-beta,-alpha,ply+1,m);
    }
    search_undo_board(s->side,m,&u);
    if(search_abort)break;
    if(score>best){best=score;best_move=move_id(m);}
    if(score>alpha)alpha=score;
    if(alpha>=beta){
      if(quiet&&ply<32){
        search_killers[ply]=best_move;
        if(search_history_generation[best_move]!=search_generation){
          search_history_generation[best_move]=search_generation;search_history[best_move]=0;
        }
        search_history[best_move]+=depth*depth;
      }
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

static int promotion_uci_code(int promotion){
  if(promotion==3)return 'b';
  if(promotion==2)return 'n';
  if(promotion==5)return 'q';
  if(promotion==4)return 'r';
  return 0;
}
static int root_uci_compare(u32 a,u32 b){
  int af=move_from(a),bf=move_from(b),at=move_to(a),bt=move_to(b);
  int av[5]={af&7,af>>3,at&7,at>>3,promotion_uci_code(move_promotion(a))};
  int bv[5]={bf&7,bf>>3,bt&7,bt>>3,promotion_uci_code(move_promotion(b))};
  for(int i=0;i<5;i++){if(av[i]<bv[i])return -1;if(av[i]>bv[i])return 1;}
  return 0;
}
static void root_insert(u32 *moves,int *scores,int *exact,int *count,u32 move,int score,int is_exact){
  int i=*count;
  while(i>0&&(scores[i-1]<score||(scores[i-1]==score&&root_uci_compare(moves[i-1],move)>0))){
    moves[i]=moves[i-1];scores[i]=scores[i-1];exact[i]=exact[i-1];i--;
  }
  moves[i]=move;scores[i]=score;exact[i]=is_exact;(*count)++;
}

int search_all(int side,int castling,int ep,int wk,int bk,int halfmove,
               int max_depth,int node_limit,int qdepth,int policy_enabled,int public_history_count,
               int public_history_reset,int public_history_changed_from){
  SearchState s={0};
  s.side=side;s.castling=castling;s.ep=ep;s.wk=wk;s.bk=bk;s.halfmove=halfmove;
  search_initial_state(&s);search_init_eval_masks();search_init_attack_tables();
  search_nodes_count=0;search_node_limit=node_limit;search_qdepth=qdepth;
  search_abort=0;search_depth_done=0;search_policy_enabled=policy_enabled;
  search_policy_side=-side;
  search_generation++;if(!search_generation)search_generation=1;
  search_public_build(public_history_count,public_history_reset,public_history_changed_from);
  search_position_count=0;search_signature_count=0;search_path_signature=0;search_path_top=0;
  for(int i=0;i<32;i++)search_killers[i]=0;
  int king=side>0?wk:bk,n=search_generate(&s,0);
  if(!n)return 0;
  u32 current_moves[512],next_moves[512];int current_scores[512],next_scores[512],current_exact[512],next_exact[512];
  for(int i=0;i<n;i++){
    current_moves[i]=output[i];current_exact[i]=0;SearchState child;SearchBoardUndo u;
    search_apply_child(&s,&child,current_moves[i],&u);
    current_scores[i]=-search_evaluate_state(&child);search_undo_board(s.side,current_moves[i],&u);
  }
  for(int i=1;i<n;i++){
    u32 m=current_moves[i];int sc=current_scores[i],j=i-1;
    while(j>=0&&(current_scores[j]<sc||(current_scores[j]==sc&&root_uci_compare(current_moves[j],m)>0))){
      current_moves[j+1]=current_moves[j];current_scores[j+1]=current_scores[j];current_exact[j+1]=current_exact[j];j--;
    }
    current_moves[j+1]=m;current_scores[j+1]=sc;current_exact[j+1]=0;
  }
  int current_count=n;
  for(int depth=1;depth<=max_depth;depth++){
    search_iter_depth=depth;search_abort=0;int next_count=0,threshold=-SEARCH_MATE;
    for(int i=0;i<current_count;i++){
      u32 m=current_moves[i];SearchState child;SearchBoardUndo u;search_apply_child(&s,&child,m,&u);
      int score=-search_ab(&child,depth-1,-SEARCH_MATE,-threshold,1,m);
      search_undo_board(s.side,m,&u);
      if(search_abort)break;
      int is_exact=threshold==-SEARCH_MATE||score>threshold;
      root_insert(next_moves,next_scores,next_exact,&next_count,m,score,is_exact);
      if(next_count>=3)threshold=next_scores[2];
    }
    if(search_abort)break;
    current_count=next_count;
    for(int i=0;i<current_count;i++){current_moves[i]=next_moves[i];current_scores[i]=next_scores[i];current_exact[i]=next_exact[i];}
    search_depth_done=depth;
    if(current_count&&absolute(current_scores[0])>SEARCH_MATE-100)break;
  }
  for(int i=0;i<current_count;i++){output[i]=current_moves[i];root_scores[i]=current_scores[i];root_exact[i]=current_exact[i];}
  return current_count;
}
