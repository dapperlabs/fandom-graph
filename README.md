# Fandom Graph

**A 3D pride engine for NBA Top Shot collectors. Pick a player, see their universe of fans.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Live Demo](https://img.shields.io/badge/demo-topshot.world%2Ffandom-success)](https://topshot.world/fandom)
[![Vercel](https://img.shields.io/badge/deploy-Vercel-black)](https://vercel.com)

![Fandom Graph](docs/screenshot.png)

Fandom Graph renders every minted NBA Top Shot Moment for a given player, plus every Flow wallet that owns one, as a living 3D constellation. The player sits at the center; their Moments orbit them; the collectors who hold those Moments orbit the Moments. Every node is a real Moment. Every edge is a real Flow wallet. The data is drawn from public Flow Network data — no login, no proprietary backend, no mock.

## What it is

Fandom Graph is a static, client-side visualization built to make the Top Shot collection graph legible at a glance. For any given player, it pulls a single JSON file that contains every edition of that player's Moments and every owner of every edition, then lays them out as a force-directed 3D graph: the player node at the center, edition nodes in a ring around them, and collector nodes clustered around the editions they hold. Bloom post-processing and a film-grain pass give the scene a cinematic feel; click any collector to spotlight the exact slice of that player's collection they own.

The headline number ("LeBron James · 288,890 Moments") is the sum of every edition's `circulationCount` — the canonical on-chain supply. Heuristic filters remove Top Shot's pack-distribution wallet and any unnamed wallet holding more than 1,500 Moments of a single player (exchange/treasury accounts, not fans). See [`methodology.html`](./methodology.html) for the full data-flow and filtering write-up.

This is a Dapper Labs prototype, open-sourced as a reference for building rich, data-driven 3D visualizations on top of public Flow Network data.

## Live demo

**<https://topshot.world/fandom>**

## Quick start

No build step. Serve the directory with any static server:

```bash
git clone https://github.com/dapperlabs/fandom-graph.git
cd fandom-graph
python3 -m http.server 8000
```

Then open **<http://localhost:8000/fandom?player=LeBron+James>** (omit `?player=` to land on the picker).

## Data format

Each player is described by a single JSON file at `/data/{playerId}.json`, where `{playerId}` is the NBA player ID. The file shape:

```jsonc
{
  "playerId": "2544",
  "name": "LeBron James",
  "team": "Los Angeles Lakers",
  "teamSlug": "lakers",
  "teamColors": ["#552583", "#FDB927"],
  "totalMintedMomentCount": 288890,        // sum of edition.circulationCount
  "editions": [
    {
      "editionKey": "245-c8fb4597-...-0",  // {setFlowId}-{playId}-{parallelID}
      "set": { "flowId": 245, "flowName": "Top Shot This: Playoffs Edition", ... },
      "play": { "id": "...", "flowID": "8426", "description": "...", "stats": { ... } },
      "edition": { "id": "...", "circulationCount": 3148, "tier": "MOMENT_TIER_FANDOM", "parallelID": 0 },
      "tier": "MOMENT_TIER_FANDOM",
      "serialsSampled": [                   // sample of minted serials in this edition
        { "flowId": "51740308", "serial": 1961, "ownerFlowAddress": "ac9b7b3363bba175" }
      ],
      "totalSerialsFetched": 3148
    }
  ],
  "owners": [                              // every collector who holds at least one Moment
    {
      "type": "user",                      // "user" | "nc" (non-custodial / unnamed)
      "flowAddress": "214fdf1a68530b98",   // Flow Network account address
      "dapperID": "auth0|5f4917c3...",     // Dapper auth subject (null for nc wallets)
      "username": "MasterCollector",       // display name (null for nc wallets)
      "profileImageUrl": "https://...",
      "topshotScore": null,                // Top Shot collector score, when available
      "holdings": 374                       // count of this player's Moments owned
    }
  ],
  "systemSerialsDropped": 1700,            // serials removed by the system-wallet filter
  "partial": true                          // true when serials were sampled, not exhaustively fetched
}
```

The `owners[]` array is the collector graph; the `editions[]` array is the edition graph. `serialsSampled[]` links the two: each sampled serial carries an `ownerFlowAddress` that joins back to `owners[].flowAddress`.

The data pipeline that produces these files is specified in **[SPEC-002 — Fandom Ownership Backend](https://github.com/dapperlabs/nbats-data-auth-portal/blob/main/specs/002-fandom-ownership-backend/spec.md)**.

### For external users

The included `/data/sample/` directory contains 3 sample player files (**LeBron James**, **Stephen Curry**, **Karl-Anthony Towns**) so the site runs out-of-the-box with no extra setup. To use production data, supply your own `/data/{playerId}.json` files matching the shape documented above.

## Tech stack

- **Static HTML + JavaScript** — no framework, no build step, no bundler.
- **Three.js r149** + **3d-force-graph 1.70.19** + **GSAP 3.12.5**, loaded via [unpkg](https://unpkg.com) UMD tags in `fandom.html`.
- **Vercel static deploy** — `vercel.json` sets clean URLs, the `/` → `/fandom` rewrite, and cache headers for `/data/*` and hashed assets.

## Project structure

```
fandom-graph/
├── fandom.html          # Entry point — picker + 3D graph
├── fandom.js            # Graph engine (~3,500 lines, no build step)
├── data-layer.js        # Player roster + per-player data loader
├── router.js            # URL ↔ state router (?player=&spotlight=)
├── styles.css           # All styles
├── methodology.html     # Data methodology page
├── vercel.json          # Vercel config (cache headers, clean URLs)
├── data/                # Per-player JSON (15 curated players)
│   ├── 2544.json        # LeBron James
│   ├── index.json       # Roster metadata
│   └── sample/          # 3 sample files for OSS consumers
├── scripts/             # CI + smoke tests
│   ├── smoke.mjs        # Playwright smoke (G3, G5, G9)
│   └── privacy-smoke.mjs # Analytics privacy assertions
├── docs/                # Documentation
│   ├── perf-spike.md    # THREE.Points integration spike report
│   └── screenshot.png   # Screenshot for README
└── .github/             # GitHub config
    └── workflows/ci.yml # CI: node --check + privacy smoke + Playwright smoke
```

## Curated roster

The picker ships with 15 players. `playerId` is the NBA player ID and the filename of the data file. The picker's `data/index.json` is the canonical curated list.

| Player | playerId | Team |
|---|---|---|
| LeBron James | `2544` | Los Angeles Lakers |
| Stephen Curry | `201939` | Golden State Warriors |
| Jayson Tatum | `1628369` | Boston Celtics |
| Giannis Antetokounmpo | `203507` | Milwaukee Bucks |
| Karl-Anthony Towns | `1626157` | Minnesota Timberwolves |
| Nikola Jokić | `203999` | Denver Nuggets |
| Anthony Edwards | `1630162` | Minnesota Timberwolves |
| Luka Dončić | `1629029` | Dallas Mavericks |
| Kevin Durant | `201142` | Phoenix Suns |
| Joel Embiid | `203954` | Philadelphia 76ers |
| Ja Morant | `1629630` | Memphis Grizzlies |
| Jalen Brunson | `1628973` | Dallas Mavericks |
| Shai Gilgeous-Alexander | `1628983` | Oklahoma City Thunder |
| Devin Booker | `1628384` | Phoenix Suns |
| Victor Wembanyama | `1641705` | San Antonio Spurs |

## What's filtered

- Top Shot's pack-distribution wallet (`b6f2481eba4df97b`) is excluded — it holds tens of thousands of Moments waiting for sale, not as a fan.
- Heuristic: any unnamed wallet holding more than 1,500 Moments of a single player is treated as a system account (exchange, treasury) and filtered out.

## Testing

Smoke tests use [Playwright](https://playwright.dev). Install dev deps first:

```bash
npm install
npx playwright install --with-deps chromium
```

Run the privacy smoke (no browser needed):

```bash
node scripts/privacy-smoke.mjs
```

Run the Playwright smoke (needs a static server on `:8000`):

```bash
python3 -m http.server 8000 &
node scripts/smoke.mjs
```

CI (`.github/workflows/ci.yml`) runs `node --check` on every JS file, the privacy smoke, and the Playwright smoke on every push and PR.

## Contributing

PRs welcome for bug fixes and visualization improvements. See [**CONTRIBUTING.md**](./CONTRIBUTING.md) for local setup, code style, and submission guidelines.

## License

MIT — see [LICENSE](./LICENSE). Use it, fork it, change the players, swap the data source, do whatever.

## Acknowledgments

- [NBA Top Shot](https://nbatopshot.com) for shipping a public GraphQL API and not gating it.
- The [Flow Network](https://flow.com) — every wallet here is a real Flow account.
- [3d-force-graph](https://github.com/vasturiano/3d-force-graph) by Vasco Asturiano.
- [Three.js](https://threejs.org) and [GSAP](https://greensock.com/gsap/) for tweening.
- [Dapper Labs](https://dapperlabs.com) for open-sourcing this prototype.
