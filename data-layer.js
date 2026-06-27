// data-layer.js — player catalog + per-player lazy loader
//
// The picker uses index.json (100 entries, 19KB) as the single source of truth
// for player metadata. Per-player {id}.json files (~2-5MB each) are fetched
// on-demand from the SPEC-002 CDN.
//
// In production, DATA_ORIGIN points to the CDN (fandom-v3.vercel.app) where
// the full 100-player dataset lives. In local dev, it falls back to /data/
// where sample files exist for 3 players.

const DATA_ORIGIN = 'https://fandom-v3.vercel.app';

let PLAYERS_META = [];
let indexLoaded = false;
const _cache = new Map();

const DataLayer = {
  get PLAYERS() { return PLAYERS_META; },
  set PLAYERS(v) { PLAYERS_META = v; },

  getMeta() { return PLAYERS_META; },

  // Load and cache per-player full data.
  // Tries the CDN first; falls back to /data/ for local dev (sample files).
  async loadPlayer(playerId) {
    const id = String(playerId);
    if (_cache.has(id)) return _cache.get(id);

    // Try CDN first (production data for all 100 players)
    try {
      const res = await fetch(`${DATA_ORIGIN}/data/${id}.json`);
      if (res.ok) {
        const data = await res.json();
        _cache.set(id, data);
        return data;
      }
    } catch (e) {
      // CDN fetch failed (network/CORS) — fall through to local
    }

    // Fallback: local /data/ (sample files in OSS, production files if present)
    const localRes = await fetch(`/data/${id}.json`);
    if (!localRes.ok) {
      const err = new Error(`Player ${id} not found (HTTP ${localRes.status})`);
      err.name = localRes.status === 404 ? 'NotFoundError' : 'NetworkError';
      throw err;
    }
    const data = await localRes.json();
    _cache.set(id, data);
    return data;
  },

  // Load index.json as the single source of player metadata.
  // Called once at startup. The picker renders from this.
  async initIndex() {
    if (indexLoaded) return;
    try {
      const res = await fetch('/data/index.json');
      if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
      const index = await res.json();
      PLAYERS_META = index;
      indexLoaded = true;
    } catch(e) {
      console.warn('DataLayer: index.json not available', e);
      throw e;
    }
  }
};

window.DataLayer = DataLayer;
