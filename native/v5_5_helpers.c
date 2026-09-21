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
