"use strict";
/* =====================================================================
   Ilham (aggressor) — Elo 1650
   Diadaptasi dari mesin catur TXT (gaya "Aggressor / Penyerang"), dibungkus
   sebagai Web Worker dengan protokol yang SAMA dengan fahriengine.js
   (Fahri / GarboChess), supaya index4.js bisa memakainya tanpa perubahan:
     postMessage("position <fen>")  -> muat posisi
     postMessage("go")              -> reset/inisialisasi worker
     postMessage("search <ms>")     -> minta Ilham mencari & membalas 1 langkah
     postMessage("analyze")         -> pencarian terus-menerus, kirim "pv ..."
   Balasan:
     - satu langkah dikirim sebagai string UCI, mis. "e2e4" / "e7e8q"
     - info kedalaman dikirim sebagai "pv Ply:.. Score:.. ..."
     - error FEN dikirim sebagai "message <pesan>"

   Gaya bermain, evaluasi, PST, opening book, dan personality bias di
   bawah ini PERSIS dipertahankan dari mesin TXT asli — tidak diubah.
   Yang dihapus dari TXT (sesuai instruksi): kode UI (eval bar, DOM,
   dropdown personality, quotes toast, animasi, status "AI THINKING",
   dan g_timeout ala TXT) — semua itu digantikan oleh protokol Worker
   yang identik dengan fahriengine.js.
   ===================================================================== */

// ── Piece constants (representasi papan 0-63, dari mesin TXT) ──────────
const EMPTY=0;
const WP=1,WN=2,WB=3,WR=4,WQ=5,WK=6;
const BP=7,BN=8,BB=9,BR=10,BQ=11,BK=12;
const WHITE=1,BLACK=2;

const MAT   =[0,100,320,330,500,900,20000,100,320,330,500,900,20000];
const FILES ='abcdefgh';
const PNAME =['','','N','B','R','Q','K','','N','B','R','Q','K'];

function pcol(p){ return p>=1&&p<=6?WHITE:p>=7?BLACK:0; }
function isW(p){ return p>=1&&p<=6; }
function isB(p){ return p>=7&&p<=12; }
function opp(c){ return c===WHITE?BLACK:WHITE; }
function R(i){ return i>>3; }
function F(i){ return i&7; }
function SQ(r,f){ return (r<<3)|f; }
function ok(r,f){ return r>=0&&r<8&&f>=0&&f<8; }
function sqn(s){ return FILES[F(s)]+(8-R(s)); }

// ── Piece-square tables (white's POV, row 0 = rank 8) ──────────────────
const PST_RAW = {
  P:[  0,  0,  0,  0,  0,  0,  0,  0,
      50, 50, 50, 50, 50, 50, 50, 50,
      10, 10, 20, 30, 30, 20, 10, 10,
       5,  5, 10, 25, 25, 10,  5,  5,
       0,  0,  0, 20, 20,  0,  0,  0,
       5, -5,-10,  0,  0,-10, -5,  5,
       5, 10, 10,-20,-20, 10, 10,  5,
       0,  0,  0,  0,  0,  0,  0,  0],
  N:[-50,-40,-30,-30,-30,-30,-40,-50,
     -40,-20,  0,  0,  0,  0,-20,-40,
     -30,  0, 10, 15, 15, 10,  0,-30,
     -30,  5, 15, 20, 20, 15,  5,-30,
     -30,  0, 15, 20, 20, 15,  0,-30,
     -30,  5, 10, 15, 15, 10,  5,-30,
     -40,-20,  0,  5,  5,  0,-20,-40,
     -50,-40,-30,-30,-30,-30,-40,-50],
  B:[-20,-10,-10,-10,-10,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5, 10, 10,  5,  0,-10,
     -10,  5,  5, 10, 10,  5,  5,-10,
     -10,  0, 10, 10, 10, 10,  0,-10,
     -10, 10, 10, 10, 10, 10, 10,-10,
     -10,  5,  0,  0,  0,  0,  5,-10,
     -20,-10,-10,-10,-10,-10,-10,-20],
  R:[  0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0],
  Q:[-20,-10,-10, -5, -5,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5,  5,  5,  5,  0,-10,
      -5,  0,  5,  5,  5,  5,  0, -5,
       0,  0,  5,  5,  5,  5,  0, -5,
     -10,  5,  5,  5,  5,  5,  0,-10,
     -10,  0,  5,  0,  0,  0,  0,-10,
     -20,-10,-10, -5, -5,-10,-10,-20],
  K:[-30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -20,-30,-30,-40,-40,-30,-30,-20,
     -10,-20,-20,-20,-20,-20,-20,-10,
      20, 20,  0,  0,  0,  0, 20, 20,
      20, 30, 10,  0,  0, 10, 30, 20]
};

function mir(i){ return ((7-(i>>3))<<3)|(i&7); }

const PST = new Array(13).fill(null);
PST[WP]=PST_RAW.P; PST[WN]=PST_RAW.N; PST[WB]=PST_RAW.B;
PST[WR]=PST_RAW.R; PST[WQ]=PST_RAW.Q; PST[WK]=PST_RAW.K;
PST[BP]=PST_RAW.P.map((_,i)=>PST_RAW.P[mir(i)]);
PST[BN]=PST_RAW.N.map((_,i)=>PST_RAW.N[mir(i)]);
PST[BB]=PST_RAW.B.map((_,i)=>PST_RAW.B[mir(i)]);
PST[BR]=PST_RAW.R.map((_,i)=>PST_RAW.R[mir(i)]);
PST[BQ]=PST_RAW.Q.map((_,i)=>PST_RAW.Q[mir(i)]);
PST[BK]=PST_RAW.K.map((_,i)=>PST_RAW.K[mir(i)]);

// ── AI search depth — tetap seperti TXT asli ────────────────────────────
const AI_DEPTH = 4;

/* =====================================================================
   TRANSPOSITION TABLE — Zobrist Hashing (persis dari TXT)
   ===================================================================== */
function makeSeededRNG(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0);
  };
}

let ZOBRIST_PIECE, ZOBRIST_CASTLE, ZOBRIST_EP, ZOBRIST_TURN;

function initZobrist(){
  const rng = makeSeededRNG(0x9E3779B9);
  ZOBRIST_PIECE = new Array(13);
  for(let p=1;p<=12;p++){
    ZOBRIST_PIECE[p] = new Array(64);
    for(let s=0;s<64;s++) ZOBRIST_PIECE[p][s] = rng();
  }
  ZOBRIST_CASTLE = [rng(), rng(), rng(), rng()];
  ZOBRIST_EP = new Array(8);
  for(let f=0;f<8;f++) ZOBRIST_EP[f] = rng();
  ZOBRIST_TURN = rng();
}
initZobrist();

function hxor(a,b){ return (a ^ b) >>> 0; }

function computeHash(b, turn, cr, ep){
  let h = 0;
  for(let s=0;s<64;s++){
    const p = b[s];
    if(p) h = hxor(h, ZOBRIST_PIECE[p][s]);
  }
  if(cr.wK) h = hxor(h, ZOBRIST_CASTLE[0]);
  if(cr.wQ) h = hxor(h, ZOBRIST_CASTLE[1]);
  if(cr.bK) h = hxor(h, ZOBRIST_CASTLE[2]);
  if(cr.bQ) h = hxor(h, ZOBRIST_CASTLE[3]);
  if(ep>=0) h = hxor(h, ZOBRIST_EP[F(ep)]);
  if(turn===BLACK) h = hxor(h, ZOBRIST_TURN);
  return h;
}

function updateHash(h, b, m, crBefore, crAfter, epBefore, epAfter){
  const piece = b[m.fr];
  h = hxor(h, ZOBRIST_PIECE[piece][m.fr]);
  const destPiece = b[m.to];
  if(destPiece !== EMPTY && !m.ep){
    h = hxor(h, ZOBRIST_PIECE[destPiece][m.to]);
  }
  if(m.ep){
    const capSq = isW(piece) ? m.to + 8 : m.to - 8;
    const capPiece = isW(piece) ? BP : WP;
    h = hxor(h, ZOBRIST_PIECE[capPiece][capSq]);
  }
  const placedPiece = m.promo || piece;
  h = hxor(h, ZOBRIST_PIECE[placedPiece][m.to]);
  if(m.castle===1){ h = hxor(h, ZOBRIST_PIECE[WR][SQ(7,7)]); h = hxor(h, ZOBRIST_PIECE[WR][SQ(7,5)]); }
  if(m.castle===2){ h = hxor(h, ZOBRIST_PIECE[WR][SQ(7,0)]); h = hxor(h, ZOBRIST_PIECE[WR][SQ(7,3)]); }
  if(m.castle===3){ h = hxor(h, ZOBRIST_PIECE[BR][SQ(0,7)]); h = hxor(h, ZOBRIST_PIECE[BR][SQ(0,5)]); }
  if(m.castle===4){ h = hxor(h, ZOBRIST_PIECE[BR][SQ(0,0)]); h = hxor(h, ZOBRIST_PIECE[BR][SQ(0,3)]); }
  if(crBefore.wK && !crAfter.wK) h = hxor(h, ZOBRIST_CASTLE[0]);
  if(crBefore.wQ && !crAfter.wQ) h = hxor(h, ZOBRIST_CASTLE[1]);
  if(crBefore.bK && !crAfter.bK) h = hxor(h, ZOBRIST_CASTLE[2]);
  if(crBefore.bQ && !crAfter.bQ) h = hxor(h, ZOBRIST_CASTLE[3]);
  if(epBefore>=0) h = hxor(h, ZOBRIST_EP[F(epBefore)]);
  if(epAfter>=0)  h = hxor(h, ZOBRIST_EP[F(epAfter)]);
  h = hxor(h, ZOBRIST_TURN);
  return h;
}

const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;
let TT = new Map();
function probeTT(hash){ return TT.get(hash); }
function storeTT(hash, depth, score, flag, bestMove){
  TT.set(hash, {hash, depth, score, flag, bestMove});
}

// ── Opening book (persis dari TXT, hanya untuk personality aggressor) ──
const OPENING_LINES = [
  ['e2e4','e7e5','g1f3','b8c6','f1c4'],  // Italia
  ['e2e4','c7c5','g1f3','d7d6','d2d4'],  // Sisilia Terbuka
  ['e2e4','e7e6','d2d4','d7d5','e4e5'],  // Prancis Advance
];

let currentOpeningLine = null;
let openingMoveIndex = 0;
function randomChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

function uciToMove(uci, b, ep, cr, color) {
  const FILES_MAP = {a:0,b:1,c:2,d:3,e:4,f:5,g:6,h:7};
  const fr = SQ(8 - parseInt(uci[1]), FILES_MAP[uci[0]]);
  const to = SQ(8 - parseInt(uci[3]), FILES_MAP[uci[2]]);
  return legalOf(b, color, ep, cr).find(m => m.fr===fr && m.to===to) || null;
}

// ── Personality bias (persis dari TXT, dari sudut pandang pihak AI == BLACK
//    di mesin TXT asal; dipertahankan sebagai bias untuk sisi yang sedang
//    dicari worker ini, lihat evaluate() di bawah) ─────────────────────────
function personalityBias(b){
  // Ilham (Aggressor): bonus untuk bidak Hitam yang dekat raja Putih —
  // persis rumus aggressor pada mesin TXT.
  let score = 0;
  const ek = kingOf(b, WHITE);
  if(ek < 0) return 0;
  const ekr = R(ek), ekf = F(ek);
  for(let i=0;i<64;i++){
    if(isB(b[i]) && b[i]!==BK){
      const dist = Math.max(Math.abs(R(i)-ekr), Math.abs(F(i)-ekf));
      score += Math.max(0, (4-dist)) * 8;
    }
  }
  return score;
}

// ── Deteksi serangan (persis dari TXT) ──────────────────────────────────
function attacked(b,s,byC){
  const r=R(s),f=F(s);
  const pw=byC===WHITE?WP:BP,kn=byC===WHITE?WN:BN,bi=byC===WHITE?WB:BB;
  const ro=byC===WHITE?WR:BR,qu=byC===WHITE?WQ:BQ,ki=byC===WHITE?WK:BK;

  if(byC===WHITE){
    if(ok(r+1,f-1)&&b[SQ(r+1,f-1)]===pw) return true;
    if(ok(r+1,f+1)&&b[SQ(r+1,f+1)]===pw) return true;
  } else {
    if(ok(r-1,f-1)&&b[SQ(r-1,f-1)]===pw) return true;
    if(ok(r-1,f+1)&&b[SQ(r-1,f+1)]===pw) return true;
  }
  for(const[dr,df]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){
    const nr=r+dr,nf=f+df;
    if(ok(nr,nf)&&b[SQ(nr,nf)]===kn) return true;
  }
  for(const[dr,df]of[[-1,-1],[-1,1],[1,-1],[1,1]]){
    let nr=r+dr,nf=f+df;
    while(ok(nr,nf)){
      const p=b[SQ(nr,nf)];
      if(p===bi||p===qu) return true;
      if(p!==EMPTY) break;
      nr+=dr;nf+=df;
    }
  }
  for(const[dr,df]of[[-1,0],[1,0],[0,-1],[0,1]]){
    let nr=r+dr,nf=f+df;
    while(ok(nr,nf)){
      const p=b[SQ(nr,nf)];
      if(p===ro||p===qu) return true;
      if(p!==EMPTY) break;
      nr+=dr;nf+=df;
    }
  }
  for(const[dr,df]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]){
    const nr=r+dr,nf=f+df;
    if(ok(nr,nf)&&b[SQ(nr,nf)]===ki) return true;
  }
  return false;
}

function kingOf(b,c){
  const k=c===WHITE?WK:BK;
  for(let i=0;i<64;i++) if(b[i]===k) return i;
  return -1;
}

// ── Generasi langkah (persis dari TXT) ──────────────────────────────────
function pseudoLegal(b,color,ep,cr){
  const moves=[];
  function add(fr,to,promo,castle,epF){
    moves.push({fr,to,promo:promo||0,castle:castle||0,ep:epF||false});
  }

  for(let s=0;s<64;s++){
    const p=b[s];
    if(pcol(p)!==color) continue;
    const r=R(s),f=F(s);

    if(p===WP){
      if(r>0&&b[SQ(r-1,f)]===EMPTY){
        if(r===1){add(s,SQ(0,f),WQ);}
        else{
          add(s,SQ(r-1,f));
          if(r===6&&b[SQ(4,f)]===EMPTY) add(s,SQ(4,f));
        }
      }
      for(const df of[-1,1]){
        if(!ok(r-1,f+df)) continue;
        const ts=SQ(r-1,f+df);
        if(isB(b[ts])){ r===1?add(s,ts,WQ):add(s,ts); }
        if(ts===ep) add(s,ts,0,0,true);
      }
    } else if(p===BP){
      if(r<7&&b[SQ(r+1,f)]===EMPTY){
        if(r===6){add(s,SQ(7,f),BQ);}
        else{
          add(s,SQ(r+1,f));
          if(r===1&&b[SQ(3,f)]===EMPTY) add(s,SQ(3,f));
        }
      }
      for(const df of[-1,1]){
        if(!ok(r+1,f+df)) continue;
        const ts=SQ(r+1,f+df);
        if(isW(b[ts])){ r===6?add(s,ts,BQ):add(s,ts); }
        if(ts===ep) add(s,ts,0,0,true);
      }
    } else if(p===WN||p===BN){
      for(const[dr,df]of[[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]){
        const nr=r+dr,nf=f+df;
        if(ok(nr,nf)&&pcol(b[SQ(nr,nf)])!==color) add(s,SQ(nr,nf));
      }
    } else if(p===WB||p===BB){
      for(const[dr,df]of[[-1,-1],[-1,1],[1,-1],[1,1]]){
        let nr=r+dr,nf=f+df;
        while(ok(nr,nf)){
          const ts=SQ(nr,nf);
          if(pcol(b[ts])===color) break;
          add(s,ts);
          if(b[ts]!==EMPTY) break;
          nr+=dr;nf+=df;
        }
      }
    } else if(p===WR||p===BR){
      for(const[dr,df]of[[-1,0],[1,0],[0,-1],[0,1]]){
        let nr=r+dr,nf=f+df;
        while(ok(nr,nf)){
          const ts=SQ(nr,nf);
          if(pcol(b[ts])===color) break;
          add(s,ts);
          if(b[ts]!==EMPTY) break;
          nr+=dr;nf+=df;
        }
      }
    } else if(p===WQ||p===BQ){
      for(const[dr,df]of[[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]){
        let nr=r+dr,nf=f+df;
        while(ok(nr,nf)){
          const ts=SQ(nr,nf);
          if(pcol(b[ts])===color) break;
          add(s,ts);
          if(b[ts]!==EMPTY) break;
          nr+=dr;nf+=df;
        }
      }
    } else if(p===WK||p===BK){
      for(const[dr,df]of[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]){
        const nr=r+dr,nf=f+df;
        if(ok(nr,nf)&&pcol(b[SQ(nr,nf)])!==color) add(s,SQ(nr,nf));
      }
      if(color===WHITE&&s===SQ(7,4)){
        if(cr.wK&&b[SQ(7,5)]===EMPTY&&b[SQ(7,6)]===EMPTY&&b[SQ(7,7)]===WR
           &&!attacked(b,SQ(7,4),BLACK)&&!attacked(b,SQ(7,5),BLACK)&&!attacked(b,SQ(7,6),BLACK))
          add(s,SQ(7,6),0,1);
        if(cr.wQ&&b[SQ(7,3)]===EMPTY&&b[SQ(7,2)]===EMPTY&&b[SQ(7,1)]===EMPTY&&b[SQ(7,0)]===WR
           &&!attacked(b,SQ(7,4),BLACK)&&!attacked(b,SQ(7,3),BLACK)&&!attacked(b,SQ(7,2),BLACK))
          add(s,SQ(7,2),0,2);
      }
      if(color===BLACK&&s===SQ(0,4)){
        if(cr.bK&&b[SQ(0,5)]===EMPTY&&b[SQ(0,6)]===EMPTY&&b[SQ(0,7)]===BR
           &&!attacked(b,SQ(0,4),WHITE)&&!attacked(b,SQ(0,5),WHITE)&&!attacked(b,SQ(0,6),WHITE))
          add(s,SQ(0,6),0,3);
        if(cr.bQ&&b[SQ(0,3)]===EMPTY&&b[SQ(0,2)]===EMPTY&&b[SQ(0,1)]===EMPTY&&b[SQ(0,0)]===BR
           &&!attacked(b,SQ(0,4),WHITE)&&!attacked(b,SQ(0,3),WHITE)&&!attacked(b,SQ(0,2),WHITE))
          add(s,SQ(0,2),0,4);
      }
    }
  }
  return moves;
}

function applyMove(b,m){
  const nb=b.slice();
  const p=nb[m.fr];
  nb[m.to]=m.promo||p;
  nb[m.fr]=EMPTY;
  if(m.ep) nb[isW(p)?m.to+8:m.to-8]=EMPTY;
  if(m.castle===1){ nb[SQ(7,5)]=WR; nb[SQ(7,7)]=EMPTY; }
  if(m.castle===2){ nb[SQ(7,3)]=WR; nb[SQ(7,0)]=EMPTY; }
  if(m.castle===3){ nb[SQ(0,5)]=BR; nb[SQ(0,7)]=EMPTY; }
  if(m.castle===4){ nb[SQ(0,3)]=BR; nb[SQ(0,0)]=EMPTY; }
  return nb;
}

function legalOf(b,color,ep,cr){
  return pseudoLegal(b,color,ep,cr).filter(m=>{
    const nb=applyMove(b,m);
    return !attacked(nb,kingOf(nb,color),opp(color));
  });
}

function calcEP(piece,m){
  if(piece===WP&&R(m.fr)===6&&R(m.to)===4) return SQ(5,F(m.fr));
  if(piece===BP&&R(m.fr)===1&&R(m.to)===3) return SQ(2,F(m.fr));
  return -1;
}

function updCR(cr,m,piece){
  const n={...cr};
  if(piece===WK){n.wK=false;n.wQ=false;}
  if(piece===BK){n.bK=false;n.bQ=false;}
  if(m.fr===SQ(7,0)||m.to===SQ(7,0)) n.wQ=false;
  if(m.fr===SQ(7,7)||m.to===SQ(7,7)) n.wK=false;
  if(m.fr===SQ(0,0)||m.to===SQ(0,0)) n.bQ=false;
  if(m.fr===SQ(0,7)||m.to===SQ(0,7)) n.bK=false;
  return n;
}

// ── Evaluasi (persis dari TXT, personality bias diterapkan sebagai bias
//    untuk sisi BLACK di formula asli — dipertahankan apa adanya) ────────
function evaluate(b,color){
  let sc=0;
  for(let i=0;i<64;i++){
    const p=b[i];
    if(!p) continue;
    const v=MAT[p]+(PST[p]?PST[p][i]:0);
    sc+=isW(p)?v:-v;
  }
  const bias = personalityBias(b);
  return color===WHITE ? sc - bias : -sc + bias;
}

function quiesce(b,c,ep,cr,alpha,beta,d){
  const sp=evaluate(b,c);
  if(sp>=beta) return beta;
  if(sp>alpha) alpha=sp;
  if(d<=0) return alpha;
  for(const m of legalOf(b,c,ep,cr)){
    if(b[m.to]===EMPTY&&!m.ep) continue;
    const piece=b[m.fr];
    const sc=-quiesce(applyMove(b,m),opp(c),calcEP(piece,m),updCR(cr,m,piece),-beta,-alpha,d-1);
    if(sc>=beta) return beta;
    if(sc>alpha) alpha=sc;
  }
  return alpha;
}

function minimax(b,c,ep,cr,depth,alpha,beta,hash){
  if(hash===undefined) hash=computeHash(b,c,cr,ep);
  const alphaOrig=alpha;

  const ttEntry = probeTT(hash);
  let ttMove = null;
  if(ttEntry){
    ttMove = ttEntry.bestMove;
    if(ttEntry.depth >= depth){
      if(ttEntry.flag === TT_EXACT) return ttEntry.score;
      if(ttEntry.flag === TT_LOWER && ttEntry.score > alpha) alpha = ttEntry.score;
      else if(ttEntry.flag === TT_UPPER && ttEntry.score < beta) beta = ttEntry.score;
      if(alpha >= beta) return ttEntry.score;
    }
  }

  if(depth===0){
    return quiesce(b,c,ep,cr,alpha,beta,2);
  }
  const moves=legalOf(b,c,ep,cr);
  if(!moves.length){
    return attacked(b,kingOf(b,c),opp(c))?-99999+depth:0;
  }

  moves.sort((a,bb)=>{
    const aIsTT = ttMove && a.fr===ttMove.fr && a.to===ttMove.to && a.promo===ttMove.promo && a.castle===ttMove.castle;
    const bIsTT = ttMove && bb.fr===ttMove.fr && bb.to===ttMove.to && bb.promo===ttMove.promo && bb.castle===ttMove.castle;
    if(aIsTT && !bIsTT) return -1;
    if(bIsTT && !aIsTT) return 1;
    return (MAT[b[bb.to]]||0)-(MAT[b[a.to]]||0);
  });

  let best=null;
  for(const m of moves){
    const piece=b[m.fr];
    const newCR=updCR(cr,m,piece);
    const newEP=calcEP(piece,m);
    const childHash=updateHash(hash,b,m,cr,newCR,ep,newEP);
    const sc=-minimax(applyMove(b,m),opp(c),newEP,newCR,depth-1,-beta,-alpha,childHash);
    if(sc>=beta){
      storeTT(hash, depth, beta, TT_LOWER, m);
      return beta;
    }
    if(sc>alpha){ alpha=sc; best=m; }
  }

  const flag = (alpha<=alphaOrig) ? TT_UPPER : TT_EXACT;
  storeTT(hash, depth, alpha, flag, best);

  return alpha;
}

function bestAI(b,c,ep,cr,depth){
  TT = new Map();

  const moves=legalOf(b,c,ep,cr);
  if(!moves.length) return null;

  const rootHash = computeHash(b,c,cr,ep);

  const rootEntry = probeTT(rootHash);
  const rootTTMove = rootEntry ? rootEntry.bestMove : null;
  moves.sort((a,bb)=>{
    const aIsTT = rootTTMove && a.fr===rootTTMove.fr && a.to===rootTTMove.to && a.promo===rootTTMove.promo && a.castle===rootTTMove.castle;
    const bIsTT = rootTTMove && bb.fr===rootTTMove.fr && bb.to===rootTTMove.to && bb.promo===rootTTMove.promo && bb.castle===rootTTMove.castle;
    if(aIsTT && !bIsTT) return -1;
    if(bIsTT && !aIsTT) return 1;
    return (MAT[b[bb.to]]||0)-(MAT[b[a.to]]||0);
  });

  let best=null,bestSc=-Infinity;
  for(const m of moves){
    const piece=b[m.fr];
    const newCR=updCR(cr,m,piece);
    const newEP=calcEP(piece,m);
    const childHash=updateHash(rootHash,b,m,cr,newCR,ep,newEP);
    const sc=-minimax(applyMove(b,m),opp(c),newEP,newCR,depth-1,-Infinity,Infinity,childHash);
    if(sc>bestSc){bestSc=sc;best=m;}
  }
  storeTT(rootHash, depth, bestSc, TT_EXACT, best);
  return best;
}

/* =====================================================================
   ADAPTER FEN <-> PAPAN 0-63
   Menerjemahkan antara notasi FEN standar (dipakai index4.js/fahriengine.js
   lewat GetFen()) dan representasi papan 0-63 milik mesin TXT ini.
   ===================================================================== */
const FEN_PIECE_MAP = {
  'P':WP,'N':WN,'B':WB,'R':WR,'Q':WQ,'K':WK,
  'p':BP,'n':BN,'b':BB,'r':BR,'q':BQ,'k':BK
};
const PIECE_FEN_MAP = {};
for(const k in FEN_PIECE_MAP) PIECE_FEN_MAP[FEN_PIECE_MAP[k]] = k;

let gBoard, gTurn, gCR, gEP;

function loadFen(fen){
  const parts = fen.trim().split(/\s+/);
  const rows = parts[0].split('/');
  gBoard = new Array(64).fill(EMPTY);
  for(let r=0;r<8;r++){
    let f=0;
    for(const ch of rows[r]){
      if(ch>='1'&&ch<='8'){ f += parseInt(ch,10); }
      else { gBoard[SQ(r,f)] = FEN_PIECE_MAP[ch] || EMPTY; f++; }
    }
  }
  gTurn = (parts[1]==='w') ? WHITE : BLACK;

  const cr = parts[2] || '-';
  gCR = { wK: cr.indexOf('K')!==-1, wQ: cr.indexOf('Q')!==-1,
          bK: cr.indexOf('k')!==-1, bQ: cr.indexOf('q')!==-1 };

  gEP = -1;
  if(parts[3] && parts[3] !== '-'){
    const file = FILES.indexOf(parts[3][0]);
    const rank = parseInt(parts[3][1],10);
    gEP = SQ(8-rank, file);
  }
}

function moveToUci(m){
  let s = sqn(m.fr) + sqn(m.to);
  if(m.promo){
    const pt = m.promo===WQ||m.promo===BQ ? 'q' : m.promo===WR||m.promo===BR ? 'r'
             : m.promo===WB||m.promo===BB ? 'b' : 'n';
    s += pt;
  }
  return s;
}

// Menerapkan satu langkah (string UCI, mis. "e2e4" / "e7e8q") ke posisi
// internal (gBoard/gTurn/gEP/gCR). Dipakai saat index4.js mengirim langkah
// PEMAIN ke worker ini secara langsung, TANPA prefix "position " (persis
// perilaku yang sudah ada di fahriengine.js lewat
// MakeMove(GetMoveFromString(e.data)) pada cabang else-nya) — supaya papan
// internal worker ini tetap sinkron dengan papan sebenarnya di index4.js.
// Tanpa ini, worker akan mencari langkah dari posisi yang sudah usang
// (masih posisi sebelumnya) dan balasannya menjadi ilegal di papan nyata,
// yang memicu pesan "busted!" dari GetMoveFromString() milik index4.js.
function applyUciToBoard(uci){
  if(!uci || typeof uci !== 'string') return false;
  const match = uci.match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if(!match) return false;

  const fr = SQ(8-parseInt(match[1][1],10), FILES.indexOf(match[1][0]));
  const to = SQ(8-parseInt(match[2][1],10), FILES.indexOf(match[2][0]));

  const legals = legalOf(gBoard, gTurn, gEP, gCR);
  let mv = legals.find(m => m.fr===fr && m.to===to && !m.promo);
  if(!mv && match[3]){
    const promoMap = { q: gTurn===WHITE?WQ:BQ, r: gTurn===WHITE?WR:BR,
                        b: gTurn===WHITE?WB:BB, n: gTurn===WHITE?WN:BN };
    mv = legals.find(m => m.fr===fr && m.to===to && m.promo===promoMap[match[3]]);
  }
  if(!mv) return false;

  const piece = gBoard[mv.fr];
  const newCR = updCR(gCR, mv, piece);
  const newEP = calcEP(piece, mv);
  gBoard = applyMove(gBoard, mv);
  gCR = newCR;
  gEP = newEP;
  gTurn = opp(gTurn);
  return true;
}

/* =====================================================================
   PROTOKOL WORKER — identik dengan fahriengine.js supaya index4.js bisa
   memakai Ilham sebagai pengganti Fahri tanpa perubahan pada
   pemanggilnya.
   ===================================================================== */
function pickMove(){
  // Coba buku pembukaan dulu (persis perilaku TXT asli)
  let m = null;
  if(currentOpeningLine && openingMoveIndex < currentOpeningLine.length){
    const bookMove = uciToMove(currentOpeningLine[openingMoveIndex], gBoard, gEP, gCR, gTurn);
    if(bookMove){ m = bookMove; openingMoveIndex++; }
    else { currentOpeningLine = null; }
  }
  if(!m) m = bestAI(gBoard, gTurn, gEP, gCR, AI_DEPTH);

  // PENTING: langkah yang dipilih WAJIB diterapkan ke papan internal
  // (gBoard/gTurn/gEP/gCR) sebelum dibalas ke index4.js. index4.js tidak
  // pernah mengirim ulang "position <fen>" setelah menerima balasan AI --
  // ia hanya mengandalkan worker untuk tetap sinkron sendiri (persis
  // perilaku fahriengine.js, yang memanggil MakeMove(bestMove) di
  // FinishMoveLocalTesting sebelum postMessage). Tanpa ini, giliran/EP di
  // worker tidak pernah berpindah balik ke pemain, dan langkah pemain
  // berikutnya akan dicari dari posisi yang salah.
  if(m){
    const piece = gBoard[m.fr];
    const newCR = updCR(gCR, m, piece);
    const newEP = calcEP(piece, m);
    gBoard = applyMove(gBoard, m);
    gCR = newCR;
    gEP = newEP;
    gTurn = opp(gTurn);
  }

  return m;
}

function buildPvMessage(m, depth){
  // Format ringkas selaras dengan BuildPVMessage() milik fahriengine.js,
  // supaya UpdatePVDisplay() di index4.js tetap bisa menampilkannya.
  // Dibulatkan ke integer terdekat (skor internal Dimas mengandung sedikit
  // keacakan dari personalityBias -- pembulatan ini murni kosmetik untuk
  // tampilan, tidak mengubah keputusan pemilihan langkah).
  const sc = Math.round(evaluate(gBoard, gTurn));
  return "pv Ply:" + depth + " Score:" + sc + " " + (m ? moveToUci(m) : "(tidak ada langkah)");
}

let needsReset = true;

self.onmessage = function (e) {
  const data = e.data;

  if (data === "go" || needsReset) {
    // Reset state internal (tabel transposisi, buku pembukaan) — setara
    // dengan ResetGame() di fahriengine.js.
    TT = new Map();
    currentOpeningLine = randomChoice(OPENING_LINES);
    openingMoveIndex = 0;
    needsReset = false;
    if (data === "go") return;
  }

  if (typeof data === "string" && data.match("^position") == "position") {
    const fenStr = data.substr(9, data.length - 9);
    try {
      loadFen(fenStr);
      TT = new Map();
      currentOpeningLine = randomChoice(OPENING_LINES);
      openingMoveIndex = 0;
    } catch (err) {
      postMessage("message FEN tidak valid");
    }
  } else if (typeof data === "string" && data.match("^search") == "search") {
    // Parameter waktu (ms) diterima demi kompatibilitas protokol, namun
    // Ilham mencari dengan kedalaman tetap (AI_DEPTH) — persis
    // seperti perilaku aslinya di mesin TXT (bukan pencarian iteratif
    // berbasis waktu seperti Fahri).
    const m = pickMove();
    if (m) {
      postMessage(buildPvMessage(m, AI_DEPTH));
      postMessage(moveToUci(m));
    } else {
      postMessage("message Tidak ada langkah legal");
    }
  } else if (data === "analyze") {
    const m = pickMove();
    postMessage(buildPvMessage(m, AI_DEPTH));
  } else if (typeof data === "string") {
    // index4.js mengirim langkah PEMAIN langsung sebagai string UCI polos
    // (mis. "e2e4"), tanpa prefix "position " atau "search " — sama seperti
    // yang diterima fahriengine.js pada cabang else-nya. Langkah ini WAJIB
    // diterapkan ke papan internal agar tetap sinkron; jika diabaikan,
    // pencarian berikutnya akan memakai posisi usang dan menghasilkan
    // langkah ilegal (memicu pesan "busted!" di index4.js).
    applyUciToBoard(data);
  }
}
