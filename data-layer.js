// data-layer.js — metadata registry + per-player lazy loader
const PLAYERS = [
  { playerId: '2544', name: "LeBron James", team: "Los Angeles Lakers", teamSlug: "lakers", teamColors: ['#552583','#FDB927'] },
  { playerId: '201939', name: "Stephen Curry", team: "Golden State Warriors", teamSlug: "warriors", teamColors: ['#1D428A','#FFC72C'] },
  { playerId: '1629029', name: "Luka Dončić", team: "Dallas Mavericks", teamSlug: "mavericks", teamColors: ['#00538C','#002B5E'] },
  { playerId: '203507', name: "Giannis Antetokounmpo", team: "Milwaukee Bucks", teamSlug: "bucks", teamColors: ['#00471B','#EEE1C6'] },
  { playerId: '201142', name: "Kevin Durant", team: "Phoenix Suns", teamSlug: "suns", teamColors: ['#1D1160','#E56020'] },
  { playerId: '203999', name: "Nikola Jokić", team: "Denver Nuggets", teamSlug: "nuggets", teamColors: ['#0E2240','#FEC524'] },
  { playerId: '203954', name: "Joel Embiid", team: "Philadelphia 76ers", teamSlug: "sixers", teamColors: ['#006BB6','#ED174C'] },
  { playerId: '1628369', name: "Jayson Tatum", team: "Boston Celtics", teamSlug: "celtics", teamColors: ['#007A33','#BA9653'] },
  { playerId: '1628384', name: "Devin Booker", team: "Phoenix Suns", teamSlug: "suns", teamColors: ['#1D1160','#E56020'] },
  { playerId: '1629630', name: "Ja Morant", team: "Memphis Grizzlies", teamSlug: "grizzlies", teamColors: ['#5D76A9','#12173F'] },
  { playerId: '1630162', name: "Anthony Edwards", team: "Minnesota Timberwolves", teamSlug: "timberwolves", teamColors: ['#0C2340','#236192'] },
  { playerId: '1641705', name: "Victor Wembanyama", team: "San Antonio Spurs", teamSlug: "spurs", teamColors: ['#C4CED4','#000000'] },
  { playerId: '1628983', name: "Shai Gilgeous-Alexander", team: "Oklahoma City Thunder", teamSlug: "thunder", teamColors: ['#007AC1','#EF3B24'] },
  { playerId: '1628973', name: "Jalen Brunson", team: "Dallas Mavericks", teamSlug: "mavericks", teamColors: ['#00538C','#002B5E'] },
  { playerId: '1626157', name: "Karl-Anthony Towns", team: "Minnesota Timberwolves", teamSlug: "timberwolves", teamColors: ['#0C2340','#236192'] }
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
