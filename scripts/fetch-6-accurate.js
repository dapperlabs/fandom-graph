#!/usr/bin/env node
// fetch-6-accurate.js — accurate per-player ingest using 3-stage fanout:
//   plays → editions → moments (per edition, no 15K cap)
// Replaces the broken byPlayers cap. Reads roster from fandom-v3/data/index.json.
// Writes to fandom-v3/data/{playerId}.json (overwrites; preserves existing if --skip).

const fs = require('fs');
const path = require('path');

const API = 'https://public-api.nbatopshot.com/graphql';
const UA = 'fandom-v3-ingestor/1.0 (r@dapperlabs.com)';
const MAX_SERIALS_PER_EDITION = parseInt(process.env.MAX_SERIALS_PER_EDITION || '1000', 10);

const argv = process.argv.slice(2);
const SKIP = argv.includes('--skip');
const CONCURRENCY = parseInt((argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1] || '2', 10);
const ONLY = (argv.find(a => a.startsWith('--only=')) || '').split('=')[1] || '';

const ROOT = path.join(__dirname, '..');
const ROSTER = path.join(ROOT, 'fandom-v3', 'data', 'index.json');
const OUT_DIR = path.join(ROOT, 'fandom-v3', 'data');

// =============================================================================
// QUERIES
// =============================================================================

const QUERY_PLAYS = `query ($playerId: ID!, $cursor: Cursor!) {
  searchPlays(input:{
    filters:{byPlayers:[$playerId]}
    searchInput:{pagination:{cursor:$cursor,direction:RIGHT,limit:100}}
  }) {
    searchSummary {
      pagination { rightCursor }
      data { ... on Plays { data { id flowID } } }
    }
  }
}`;

const QUERY_EDITIONS = `query ($playIds: [ID!]!, $cursor: Cursor!) {
  searchEditions(input:{
    filters:{byPlayIDs:$playIds}
    searchInput:{pagination:{cursor:$cursor,direction:RIGHT,limit:200}}
  }) {
    searchSummary {
      pagination { rightCursor }
      data { ... on Editions { data {
        id circulationCount tier parallelID
        set { id flowId flowName flowSeriesNumber }
        play { id flowID description
          stats { playerName playCategory playType teamAtMoment dateOfMoment jerseyNumber }
        }
      } } }
    }
  }
}`;

const QUERY_MOMENTS_BY_EDITION = `query ($setID: ID!, $playID: ID!, $cursor: Cursor!, $limit: Int!) {
  searchMintedMoments(input:{
    filters:{byEditions:{setID:$setID, playID:$playID}}
    searchInput:{pagination:{cursor:$cursor,direction:RIGHT,limit:$limit}}
  }) {
    data {
      searchSummary {
        totalCount
        pagination { rightCursor }
        data { ... on MintedMoments { data {
          flowId flowSerialNumber tier
          ownerV2 {
            __typename
            ... on User { dapperID username profileImageUrl userFlow: flowAddress topshotScore }
            ... on NonCustodialUser { ncFlow: flowAddress }
          }
        } } }
      }
    }
  }
}`;

// =============================================================================
// HTTP + helpers
// =============================================================================

async function gql(query, variables, attempt = 0) {
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ query, variables })
    });
    if (res.status === 429 || res.status >= 500) throw new Error('transient_' + res.status);
    const json = await res.json();
    if (json.errors) throw new Error('GraphQL errors: ' + JSON.stringify(json.errors).slice(0, 200));
    return json.data;
  } catch (e) {
    if (attempt >= 3) throw e;
    const wait = [500, 1500, 4500][attempt];
    await new Promise(r => setTimeout(r, wait));
    return gql(query, variables, attempt + 1);
  }
}

async function fetchAllPlaysForPlayer(playerId) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 50; page++) {
    const data = await gql(QUERY_PLAYS, { playerId, cursor });
    const ss = data?.searchPlays?.searchSummary;
    if (!ss) break;
    const batch = ss.data?.data || [];
    out.push(...batch);
    if (batch.length < 100) break;
    cursor = ss.pagination?.rightCursor || '';
    if (!cursor) break;
  }
  return out;
}

async function fetchEditionsForPlays(playIds) {
  const out = [];
  const CHUNK = 50;
  for (let i = 0; i < playIds.length; i += CHUNK) {
    const chunk = playIds.slice(i, i + CHUNK);
    let cursor = '';
    for (let page = 0; page < 20; page++) {
      const data = await gql(QUERY_EDITIONS, { playIds: chunk, cursor });
      const ss = data?.searchEditions?.searchSummary;
      if (!ss) break;
      const batch = ss.data?.data || [];
      out.push(...batch);
      if (batch.length < 200) break;
      cursor = ss.pagination?.rightCursor || '';
      if (!cursor) break;
    }
  }
  return out;
}

async function fetchMomentsForEdition(setID, playID, maxSerials = MAX_SERIALS_PER_EDITION) {
  const out = [];
  let cursor = '';
  let totalCount = 0;
  let partial = false;
  while (true) {
    let data;
    try {
      data = await gql(QUERY_MOMENTS_BY_EDITION, { setID, playID, cursor, limit: 200 });
    } catch (e) {
      console.error(`    edition err: ${e.message.slice(0,160)}`);
      partial = true;
      break;
    }
    const ss = data?.searchMintedMoments?.data?.searchSummary;
    if (!ss) break;
    if (!totalCount) totalCount = ss.totalCount || 0;
    const batch = ss.data?.data || [];
    out.push(...batch);
    if (batch.length < 200) break;
    if (out.length >= maxSerials) { partial = (out.length < totalCount); break; }
    cursor = ss.pagination?.rightCursor || '';
    if (!cursor) break;
  }
  return { moments: out, totalCount, partial };
}

async function fetchMomentsForPlayer(playerId) {
  const out = [];
  let totalCount = 0;
  let partial = false;

  const plays = await fetchAllPlaysForPlayer(playerId);
  if (plays.length === 0) return { moments: [], totalCount: 0, partial: false, playCount: 0, editionCount: 0 };

  const editions = await fetchEditionsForPlays(plays.map(p => p.id));

  for (const ed of editions) {
    const setID = ed.set?.id;
    const playID = ed.play?.id;
    if (!setID || !playID) continue;
    const { moments, totalCount: edTotal, partial: edPartial } = await fetchMomentsForEdition(setID, playID);
    if (edPartial) partial = true;
    for (const m of moments) {
      out.push({
        flowId: m.flowId,
        flowSerialNumber: m.flowSerialNumber,
        tier: m.tier || ed.tier,
        set: ed.set,
        edition: { id: ed.id, circulationCount: ed.circulationCount, tier: ed.tier, parallelID: ed.parallelID },
        play: ed.play,
        ownerV2: m.ownerV2
      });
    }
    totalCount += ed.circulationCount || edTotal || 0;
  }

  return { moments: out, totalCount, partial, playCount: plays.length, editionCount: editions.length };
}

// =============================================================================
// Aggregation (matches old shape)
// =============================================================================

// Pack/minter/system wallets to exclude from data. Verified 2026-04-26 by analyzing
// cross-player presence: b6f2481eba4df97b appears in all 6 players with 6,601 total
// holdings (next-highest individual: 679) and no username — clear pack distributor.
const SYSTEM_ADDRESSES = new Set([
  'b6f2481eba4df97b',
  '0xb6f2481eba4df97b'
]);

function isSystemAddress(addr) {
  if (!addr) return false;
  return SYSTEM_ADDRESSES.has(String(addr).toLowerCase());
}

function normalizeOwner(o) {
  if (!o) return null;
  if (o.__typename === 'User') {
    return { type: 'user', flowAddress: o.userFlow || null, dapperID: o.dapperID || null, username: o.username || null, profileImageUrl: o.profileImageUrl || null, topshotScore: o.topshotScore || null };
  }
  if (o.__typename === 'NonCustodialUser') {
    return { type: 'nc', flowAddress: o.ncFlow || null, dapperID: null, username: null, profileImageUrl: null, topshotScore: null };
  }
  return null;
}

function editionKey(m) {
  const setId = m.set?.flowId ?? 'unknown';
  const playId = m.play?.id ?? m.edition?.id ?? 'unknown';
  const parallelID = m.edition?.parallelID ?? 0;
  return `${setId}-${playId}-${parallelID}`;
}

function aggregate(meta, moments, totalCount, partial) {
  const editionMap = new Map();
  const ownerMap = new Map();
  let systemSerialsDropped = 0;
  for (const m of moments) {
    const owner = normalizeOwner(m.ownerV2);
    // Server-side pack-account filter — drop serials owned by known system wallets so
    // they never enter the graph data. Heuristic fallback: anonymous wallet caught by
    // address denylist. Client-side filter is removed once data is regenerated.
    if (owner?.flowAddress && isSystemAddress(owner.flowAddress)) {
      systemSerialsDropped++;
      continue;
    }
    const ek = editionKey(m);
    if (!editionMap.has(ek)) {
      editionMap.set(ek, { editionKey: ek, set: m.set, play: m.play, edition: m.edition, tier: m.tier, serials: [] });
    }
    editionMap.get(ek).serials.push({ flowId: m.flowId, serial: parseInt(m.flowSerialNumber, 10), ownerFlowAddress: owner?.flowAddress || null });
    if (owner?.flowAddress) {
      const existing = ownerMap.get(owner.flowAddress);
      if (!existing) ownerMap.set(owner.flowAddress, { ...owner, holdings: 1 });
      else {
        existing.holdings += 1;
        if (owner.username && !existing.username) {
          existing.username = owner.username;
          existing.profileImageUrl = owner.profileImageUrl;
          existing.dapperID = owner.dapperID;
          existing.topshotScore = owner.topshotScore;
        }
      }
    }
  }
  // Heuristic second-pass: anonymous wallet (no username) holding >1500 serials of one
  // player is almost certainly a system wallet missed by the denylist.
  for (const [addr, owner] of ownerMap.entries()) {
    const noUsername = !owner.username || owner.username === '?' || owner.username === '';
    if (noUsername && owner.holdings > 1500) {
      ownerMap.delete(addr);
      systemSerialsDropped += owner.holdings;
      // Also strip from edition serial samples
      for (const ed of editionMap.values()) {
        ed.serials = ed.serials.filter(s => s.ownerFlowAddress !== addr);
      }
    }
  }
  if (systemSerialsDropped > 0) {
    console.log(`    [pack-filter] dropped ${systemSerialsDropped} system-wallet serials from ${meta.name}`);
  }
  const editions = Array.from(editionMap.values()).map(e => {
    e.serials.sort((a, b) => a.serial - b.serial);
    return { ...e, serialsSampled: e.serials.slice(0, MAX_SERIALS_PER_EDITION), totalSerialsFetched: e.serials.length };
  });
  for (const e of editions) delete e.serials;
  return {
    playerId: meta.playerId,
    name: meta.name,
    team: meta.team,
    teamSlug: meta.teamSlug || null,
    teamColors: meta.teamColors,
    totalMintedMomentCount: totalCount,
    editions,
    owners: Array.from(ownerMap.values()).sort((a, b) => b.holdings - a.holdings),
    systemSerialsDropped,
    ...(partial ? { partial: true } : {})
  };
}

// =============================================================================
// Runner
// =============================================================================

async function ingestOne(meta) {
  const start = Date.now();
  const outPath = path.join(OUT_DIR, `${meta.playerId}.json`);

  if (SKIP && fs.existsSync(outPath)) {
    try {
      const ex = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (ex.editions && ex.editions.length > 30 && !ex.partial) {
        console.log(`⤷ skip ${meta.name} (already accurate, ${ex.editions.length} editions)`);
        return { playerId: meta.playerId, status: 'skip' };
      }
    } catch (_) {}
  }

  console.log(`→ ${meta.name} (${meta.playerId}) starting…`);
  const { moments, totalCount, partial, playCount, editionCount } = await fetchMomentsForPlayer(meta.playerId);
  const body = aggregate(meta, moments, totalCount, partial);
  fs.writeFileSync(outPath, JSON.stringify(body));
  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  const size = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✓ ${meta.name} plays=${playCount} editions=${editionCount} (kept=${body.editions.length}) owners=${body.owners.length} total=${totalCount.toLocaleString()} ${size}KB ${seconds}s${partial ? ' (PARTIAL)' : ''}`);
  return { playerId: meta.playerId, status: partial ? 'partial' : 'ok', totalCount, editionCount, owners: body.owners.length, seconds: parseFloat(seconds) };
}

async function runPool(items, limit, worker) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (idx < items.length) {
      const my = idx++;
      try { results[my] = await worker(items[my]); }
      catch (e) {
        console.error(`✗ ${items[my].name} failed: ${e.message}`);
        results[my] = { playerId: items[my].playerId, status: 'fail', error: e.message };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  let players = JSON.parse(fs.readFileSync(ROSTER, 'utf8'));
  if (ONLY) {
    const ids = ONLY.split(',');
    players = players.filter(p => ids.includes(p.playerId));
  }
  console.log(`Fetching ${players.length} players · concurrency=${CONCURRENCY} · MAX_SERIALS_PER_EDITION=${MAX_SERIALS_PER_EDITION} · skip=${SKIP}\n`);
  const t0 = Date.now();
  const results = await runPool(players, CONCURRENCY, ingestOne);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n===== SUMMARY (${elapsed}s) =====`);
  const ok = results.filter(r => r.status === 'ok').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const skip = results.filter(r => r.status === 'skip').length;
  const fail = results.filter(r => r.status === 'fail').length;
  console.log(`ok: ${ok} · partial: ${partial} · skip: ${skip} · fail: ${fail}`);
  results.filter(r => r.status === 'fail').forEach(r => console.log(`  FAIL ${r.playerId}: ${r.error}`));
}

main().catch(e => { console.error(e); process.exit(1); });
