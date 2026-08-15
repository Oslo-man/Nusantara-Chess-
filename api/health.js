'use strict';
const { setCors } = require('../lib/shapeResult');

module.exports = (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  res.status(200).json({
    ok: true,
    engine: 'stockfish (server-side, WASM in Node runtime)',
    platform: 'vercel'
  });
};
