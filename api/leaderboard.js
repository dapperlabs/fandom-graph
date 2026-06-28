// api/leaderboard.js — Vercel serverless function that proxies the atlas-api
// locked-score leaderboard. Server-side calls bypass Cloudflare's browser
// challenge, and Vercel's IPs are not blocked.
//
// GET /api/leaderboard?playerId=2544&limit=1000
// Returns: { entries: [...], totalCount, hasMore }

const ATLAS_URL = 'https://api.production.atlas.dapperlabs.com/public/atlas.v1.LeaderboardService/GetLeaderboardPage';

export default async function handler(req, res) {
  const { playerId, limit, cursor } = req.query;

  if (!playerId) {
    return res.status(400).json({ error: 'playerId required' });
  }

  const boardId = `nba:player:${playerId}`;
  const pageLimit = Math.min(parseInt(limit, 10) || 1000, 1000);
  const pageCursor = cursor || '';

  try {
    const response = await fetch(ATLAS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Connect-Protocol-Version': '1',
      },
      body: JSON.stringify({
        leaderboard_id: boardId,
        cursor: pageCursor,
        limit: 100, // fetch in pages of 100, accumulate
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`Atlas API ${response.status}: ${text.slice(0, 200)}`);
      return res.status(response.status).json({ error: `Atlas API ${response.status}` });
    }

    // Collect all pages up to pageLimit
    let allEntries = [];
    let totalCount = 0;
    let hasMore = true;
    let nextCursor = '';
    let pageResponse = await response.json();

    totalCount = pageResponse.totalCount || 0;
    allEntries = pageResponse.entries || [];
    hasMore = pageResponse.hasMore || false;
    nextCursor = pageResponse.nextCursor || '';

    // Fetch additional pages
    while (hasMore && allEntries.length < pageLimit) {
      const pageRes = await fetch(ATLAS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
        },
        body: JSON.stringify({
          leaderboard_id: boardId,
          cursor: nextCursor,
          limit: 100,
        }),
      });

      if (!pageRes.ok) break;
      const pageData = await pageRes.json();
      allEntries = allEntries.concat(pageData.entries || []);
      hasMore = pageData.hasMore || false;
      nextCursor = pageData.nextCursor || '';
    }

    // Trim to requested limit
    allEntries = allEntries.slice(0, pageLimit);

    // Transform to our format
    const entries = allEntries.map(e => ({
      rank: e.rank,
      lockedScore: e.score,
      displayScore: e.displayScore,
      username: e.user?.username || null,
      flowAddress: e.user?.flowAddress || null,
      profileImageUrl: e.user?.profileImageUrl || null,
      dapperId: e.user?.dapperId || null,
    }));

    // Cache for 5 minutes at the edge, 1 minute in the browser
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('Access-Control-Allow-Origin', '*');

    return res.status(200).json({
      playerId,
      entries,
      totalCount,
      hasMore: allEntries.length < totalCount,
    });
  } catch (err) {
    console.error('Leaderboard proxy error:', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
}
