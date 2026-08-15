'use strict';
/**
 * POST /api/analyze-batch
 * body: { fens: string[], depth?: number, multiPv?: number }
 * -> { ok, results: [{depth,bestmove,lines}, ...] }  (urutan sama dengan fens[])
 *
 * Dipakai oleh fitur "Ulasan Permainan" (memindai semua langkah dalam partai).
 * Karena Vercel Function punya batas durasi (lihat vercel.json -> maxDuration),
 * jumlah posisi per permintaan DIBATASI di sini (lihat MAX_FENS_PER_REQUEST).
 * Frontend (analyzePool di public/js/index2.js) sudah otomatis memecah
 * permintaan besar menjadi beberapa batch kecil, jadi ini aman dipakai apa adanya.
 */
const { analyzeMany } = require('../lib/stockfishEngine');
const { isValidFen, clampDepth, clampMultiPv, shapeResult, setCors } = require('../lib/shapeResult');

// Batas konservatif per permintaan supaya tidak melebihi maxDuration Vercel Function
// (10 detik, lihat vercel.json). Dengan concurrency 3 dan jatah waktu singkat per posisi,
// ini realistis muat dalam batas waktu. Sesuaikan bersama nilai CHUNK di
// analyzePool() pada public/js/index2.js jika angka ini diubah.
const MAX_FENS_PER_REQUEST = 15;
const CONCURRENCY = 3;
const PER_POSITION_BUDGET_MS = 1800; // jatah waktu per posisi (bukan total)

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Gunakan metode POST' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
    const { fens, depth, multiPv } = body;

    if (!Array.isArray(fens) || !fens.length) {
      return res.status(400).json({ ok: false, error: 'fens harus berupa array tidak kosong' });
    }
    if (fens.length > MAX_FENS_PER_REQUEST) {
      return res.status(400).json({
        ok: false,
        error: `Terlalu banyak posisi dalam satu permintaan (maks ${MAX_FENS_PER_REQUEST} untuk Vercel Function)`
      });
    }
    for (const f of fens) {
      if (!isValidFen(f)) return res.status(400).json({ ok: false, error: 'Ada FEN tidak valid dalam daftar' });
    }

    // Untuk batch, depth dibatasi lebih rendah dari clampDepth() umum karena
    // jatah waktu per posisi sangat singkat (lihat PER_POSITION_BUDGET_MS di atas).
    const d = Math.min(clampDepth(depth), 12);
    const mpv = clampMultiPv(multiPv);

    const raw = await analyzeMany(fens, d, mpv, CONCURRENCY, PER_POSITION_BUDGET_MS);
    res.status(200).json({ ok: true, results: raw.map(shapeResult) });
  } catch (err) {
    console.error('[/api/analyze-batch] error:', err);
    res.status(500).json({ ok: false, error: 'Analisis batch server gagal: ' + (err.message || err) });
  }
};
