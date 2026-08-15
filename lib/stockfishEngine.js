'use strict';
/**
 * stockfishEngine.js
 * ------------------------------------------------------------------
 * Menjalankan Stockfish di dalam proses Node.js server (memakai paket
 * npm "stockfish" — WASM Stockfish, dikompilasi oleh Emscripten).
 *
 * PENTING soal "server-side": kode ini berjalan di lingkungan Vercel
 * Function (Node.js di server Vercel), BUKAN di browser pengguna.
 * Format WASM di sini hanyalah bentuk biner Stockfish yang portable
 * (tidak butuh instalasi OS-level seperti binary native), tapi
 * dieksekusinya tetap di server — file .wasm ini tidak pernah dikirim
 * ke browser klien.
 *
 * Vercel Functions bersifat serverless (setiap invocation adalah
 * container sementara), jadi TIDAK ada pool proses persisten yang
 * hidup di antar-request seperti pada server tradisional. Setiap
 * pemanggilan analyze() membuat instance Stockfish baru, memakainya,
 * lalu menutupnya di akhir request yang sama.
 * ------------------------------------------------------------------
 */
/**
 * PENTING soal pemilihan varian engine:
 * Paket npm "stockfish" menyediakan beberapa varian build. Varian default/
 * multi-threaded membutuhkan SharedArrayBuffer + header CORS khusus yang
 * didesain untuk browser, dan bisa gagal atau sangat besar (>100MB) di
 * lingkungan Node/Vercel serverless. Kita pakai varian SINGLE-THREADED
 * secara eksplisit ("stockfish-18-single" / fallback ke entry default jika
 * nama file berubah di versi mendatang) karena varian ini didesain untuk
 * berjalan tanpa header CORS khusus dan tanpa multi-threading.
 *
 * Jika struktur file paket ini berubah pada versi stockfish yang kamu pasang,
 * cek folder node_modules/stockfish/src/ untuk nama file yang tersedia dan
 * sesuaikan daftar SINGLE_THREAD_CANDIDATES di bawah (lihat juga README).
 */
const SINGLE_THREAD_CANDIDATES = [
  'stockfish/src/stockfish-18-single.js',
  'stockfish/src/stockfish-17-single.js',
  'stockfish/src/stockfish-nnue-16-single.js',
  'stockfish' // fallback terakhir: entry point default paket
];

function loadStockfishModule() {
  let lastErr;
  for (const modPath of SINGLE_THREAD_CANDIDATES) {
    try {
      return require(modPath);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    'Tidak dapat memuat modul Stockfish dari kandidat manapun. Error terakhir: ' +
    (lastErr && lastErr.message)
  );
}

const StockfishModule = loadStockfishModule();

/**
 * Menjalankan satu sesi analisis penuh (boot -> uci -> posisi -> go -> hasil -> quit)
 * dalam satu pemanggilan. Cocok untuk model serverless karena tidak menyisakan
 * proses yang menggantung setelah request selesai.
 *
 * timeBudgetMs: batas waktu KERAS agar function Vercel selalu sempat mengirim
 * response JSON sebelum limit maxDuration membunuh function secara paksa
 * (yang hasilnya 504 tanpa body sama sekali). Default 7 detik -> aman untuk
 * maxDuration=10 di vercel.json, menyisakan ruang untuk overhead cold start.
 */
function analyzeOnce(fen, depth, multiPv, timeBudgetMs) {
  return new Promise((resolve, reject) => {
    let engine;
    try {
      engine = StockfishModule();
    } catch (err) {
      reject(new Error('Gagal memuat Stockfish WASM: ' + err.message));
      return;
    }

    const byPv = {};
    let bestmove = null;
    let lastDepthSeen = 0;
    let settled = false;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      try { engine.postMessage('quit'); } catch (e) {}
      if (err) reject(err); else resolve(result);
    };

    const budget = Math.max(1000, timeBudgetMs || 7000);
    const watchdog = setTimeout(() => {
      finish(null, { depth: lastDepthSeen, byPv, bestmove });
    }, budget);

    engine.onmessage = function (event) {
      const line = (event && event.data !== undefined ? event.data : event) + '';

      if (line === 'uciok') {
        engine.postMessage('setoption name MultiPV value ' + Math.max(1, multiPv | 0));
        engine.postMessage('isready');
        return;
      }
      if (line === 'readyok') {
        engine.postMessage('position fen ' + fen);
        engine.postMessage('go depth ' + Math.max(1, depth | 0));
        return;
      }
      if (line.startsWith('info') && line.includes(' pv ')) {
        const dM = line.match(/ depth (\d+)/);
        if (dM) lastDepthSeen = +dM[1];
        const mpvM = line.match(/ multipv (\d+)/);
        const idx = mpvM ? +mpvM[1] : 1;
        const cpM = line.match(/score cp (-?\d+)/);
        const mateM = line.match(/score mate (-?\d+)/);
        const pvM = line.match(/ pv (.+)$/);
        const entry = {};
        if (mateM) entry.mate = +mateM[1]; else if (cpM) entry.cp = +cpM[1];
        if (pvM) entry.pv = pvM[1].trim().split(/\s+/);
        entry.depth = lastDepthSeen;
        byPv[idx] = entry;
        return;
      }
      if (line.startsWith('bestmove')) {
        const bm = line.split(/\s+/)[1];
        bestmove = (bm && bm !== '(none)') ? bm : null;
        finish(null, { depth: lastDepthSeen, byPv, bestmove });
      }
    };

    try {
      engine.postMessage('uci');
    } catch (err) {
      finish(new Error('Gagal memulai Stockfish: ' + err.message));
    }
  });
}

/**
 * Menganalisis banyak posisi dengan sedikit paralelisme (dalam satu invocation
 * Vercel Function). Dipakai untuk fitur "Ulasan Permainan". `timeBudgetMs` di sini
 * adalah jatah waktu PER POSISI (bukan total) — dibuat lebih kecil dari analyzeOnce
 * tunggal karena banyak posisi harus muat dalam satu maxDuration yang sama.
 */
async function analyzeMany(fens, depth, multiPv, concurrency, timeBudgetMs) {
  const results = new Array(fens.length);
  let next = 0;
  const CONC = Math.max(1, Math.min(concurrency || 2, 4));

  async function lane() {
    while (next < fens.length) {
      const i = next++;
      results[i] = await analyzeOnce(fens[i], depth, multiPv, timeBudgetMs);
    }
  }

  await Promise.all(Array.from({ length: CONC }, lane));
  return results;
}

module.exports = { analyzeOnce, analyzeMany };
