'use strict';
/** shapeResult.js — helper bersama dipakai oleh api/analyze.js dan api/analyze-batch.js */

function isValidFen(fen) {
  return typeof fen === 'string' && fen.trim().split(/\s+/).length >= 4;
}

function clampDepth(d) {
  const n = parseInt(d, 10);
  if (!Number.isFinite(n)) return 14;
  // Vercel Function punya batas durasi; depth dibatasi lebih konservatif
  // dibanding versi server tradisional agar tidak timeout.
  return Math.max(1, Math.min(n, 20));
}

function clampMultiPv(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v)) return 3;
  return Math.max(1, Math.min(v, 5));
}

/** Bentuk ulang hasil mentah engine -> payload JSON stabil untuk frontend. */
function shapeResult(r) {
  const lines = Object.keys(r.byPv || {})
    .map((k) => +k)
    .sort((a, b) => a - b)
    .map((idx) => {
      const e = r.byPv[idx] || {};
      return {
        multipv: idx,
        depth: e.depth || r.depth || null,
        cp: e.cp !== undefined ? e.cp : null,
        mate: e.mate !== undefined ? e.mate : null,
        pv: e.pv || []
      };
    });
  return {
    depth: r.depth || null,
    bestmove: r.bestmove || null,
    lines
  };
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = { isValidFen, clampDepth, clampMultiPv, shapeResult, setCors };
