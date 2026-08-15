'use strict';
/**
 * POST /api/analyze
 * body: { fen: string, depth?: number, multiPv?: number }
 * -> { ok, depth, bestmove, lines:[{multipv,depth,cp,mate,pv}] }
 *
 * Berjalan sebagai Vercel Function (Node.js serverless). Stockfish dijalankan
 * di dalam function ini lewat lib/stockfishEngine.js (paket npm "stockfish",
 * WASM yang dieksekusi di server) — tidak ada file Stockfish yang dikirim
 * ke browser pengguna.
 */
const { analyzeOnce } = require('../lib/stockfishEngine');
const { isValidFen, clampDepth, clampMultiPv, shapeResult, setCors } = require('../lib/shapeResult');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Gunakan metode POST' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const { fen, depth, multiPv } = body;

    if (!isValidFen(fen)) {
      return res.status(400).json({ ok: false, error: 'FEN tidak valid' });
    }

    const d = clampDepth(depth);
    const mpv = clampMultiPv(multiPv);

    // maxDuration function ini = 10 detik (lihat vercel.json); sisakan jatah
    // untuk cold start & serialisasi response, watchdog engine dibatasi 7.5 detik.
    const r = await analyzeOnce(fen, d, mpv, 7500);
    res.status(200).json({ ok: true, ...shapeResult(r) });
  } catch (err) {
    console.error('[/api/analyze] error:', err);
    res.status(500).json({ ok: false, error: 'Analisis server gagal: ' + (err.message || err) });
  }
};
