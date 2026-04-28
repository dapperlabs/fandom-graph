// data-layer.js — metadata registry + per-player lazy loader
const PLAYERS = [
  { playerId: '2544', name: "LeBron James", team: "Los Angeles Lakers", teamSlug: "lakers", teamColors: ['#552583','#FDB927'], totalMintedMomentCount: 288890 },
  { playerId: '1641705', name: "Victor Wembanyama", team: "San Antonio Spurs", teamSlug: "spurs", teamColors: ['#C4CED4','#000000'], totalMintedMomentCount: 20362 },
  { playerId: '201939', name: "Stephen Curry", team: "Golden State Warriors", teamSlug: "warriors", teamColors: ['#1D428A','#FFC72C'], totalMintedMomentCount: 305622 },
  { playerId: '203999', name: "Nikola Jokic", team: "Denver Nuggets", teamSlug: "nuggets", teamColors: ['#0E2240','#FEC524'], totalMintedMomentCount: 269102 },
  { playerId: '1629029', name: "Luka Dončić", team: "Dallas Mavericks", teamSlug: "mavericks", teamColors: ['#00538C','#002B5E'], totalMintedMomentCount: 243375 },
  { playerId: '201142', name: "Kevin Durant", team: "Phoenix Suns", teamSlug: "suns", teamColors: ['#1D1160','#E56020'], totalMintedMomentCount: 215203 }
];

// Live metadata (enriched from index.json async)
let PLAYERS_META = [...PLAYERS];
let indexLoaded = false;

// Cache of loaded per-player data
const _cache = new Map();

const DataLayer = {
  // PLAYERS exposed as getter so window.DataLayer.PLAYERS works (fandom.js reads this)
  get PLAYERS() { return PLAYERS_META; },
  set PLAYERS(v) { PLAYERS_META = v; },

  getMeta() { return PLAYERS_META; },

  // Load and cache per-player full data from /data/{playerId}.json
  async loadPlayer(playerId) {
    const id = String(playerId);
    if (_cache.has(id)) return _cache.get(id);
    const res = await fetch(`/data/${id}.json`);
    if (!res.ok) throw new Error(`Player ${id} not found (HTTP ${res.status})`);
    const data = await res.json();
    _cache.set(id, data);
    return data;
  },

  // Enrich PLAYERS_META from /data/index.json (called once at startup)
  async initIndex() {
    if (indexLoaded) return;
    try {
      const res = await fetch('/data/index.json');
      if (!res.ok) return;
      const index = await res.json();
      const byId = new Map(index.map(p => [String(p.playerId), p]));
      PLAYERS_META = PLAYERS_META.map(p => {
        const live = byId.get(String(p.playerId));
        return live ? { ...p, ...live } : p;
      });
      indexLoaded = true;
    } catch(e) {
      console.warn('DataLayer: index.json not available, using bundled metadata', e);
    }
  }
};

// CRITICAL: expose to window so fandom.js (classic <script defer>) can reach it.
// Module scope keeps `DataLayer` private otherwise, and fandom.js fails silently.
window.DataLayer = DataLayer;
DataLayer.initIndex().catch(() => {});
