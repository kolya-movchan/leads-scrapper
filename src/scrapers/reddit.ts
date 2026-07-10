import axios from 'axios';
import { RawPost } from '../types/index.js';

// Verified against the Apify Store on 2026-07-10: top-rated Reddit scraper.
// Its input schema has no `subreddits` field, so we build per-subreddit
// search URLs (startUrls) for each keyword × subreddit combination.
const ACTOR_ID = 'trudax~reddit-scraper-lite';
const APIFY_BASE = 'https://api.apify.com/v2';

const KEYWORDS = [
  'need automation',
  'looking for developer',
  'build website',
  'need n8n',
  'zapier help',
  'hire developer',
  'need web app',
];

const SUBREDDITS = [
  'forhire',
  'entrepreneur',
  'automation',
  'nocode',
  'SaaS',
  'slavelabour',
  'webdev',
];

// Override with REDDIT_MAX_ITEMS in .env to control Apify cost (~$0.004/result)
const MAX_ITEMS = Number(process.env.REDDIT_MAX_ITEMS) || 50;
// Apify caps waitForFinish at 60s; after that we poll until the run finishes
const WAIT_FOR_FINISH_SECS = 60;
const MAX_POLL_MINUTES = 20;

function buildStartUrls(): { url: string }[] {
  const urls: { url: string }[] = [];
  for (const sub of SUBREDDITS) {
    for (const kw of KEYWORDS) {
      const q = encodeURIComponent(kw);
      urls.push({
        url: `https://www.reddit.com/r/${sub}/search/?q=${q}&restrict_sr=1&sort=new&t=day`,
      });
    }
  }
  return urls;
}

interface ApifyRedditItem {
  id?: string;
  parsedId?: string;
  dataType?: string;
  title?: string;
  body?: string;
  username?: string;
  url?: string;
  communityName?: string; // e.g. "r/forhire"
  parsedCommunityName?: string;
  createdAt?: string;
}

export async function scrapeReddit(): Promise<RawPost[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not set');

  const input = {
    startUrls: buildStartUrls(),
    skipComments: true,
    skipUserPosts: true,
    skipCommunity: true,
    searchPosts: true,
    searchComments: false,
    searchCommunities: false,
    searchUsers: false,
    includeNSFW: false,
    maxItems: MAX_ITEMS,
    proxy: { useApifyProxy: true },
  };

  // Start the run and wait (server-side) up to RUN_TIMEOUT_SECS for it to finish
  const startRes = await axios.post(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${token}&waitForFinish=${WAIT_FOR_FINISH_SECS}`,
    input,
    { headers: { 'Content-Type': 'application/json' }, timeout: (WAIT_FOR_FINISH_SECS + 30) * 1000 },
  );

  let run = startRes.data.data;

  const terminal = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];
  const maxPolls = (MAX_POLL_MINUTES * 60) / 15;
  let polls = 0;
  while (!terminal.includes(run.status) && polls < maxPolls) {
    await new Promise((r) => setTimeout(r, 15_000));
    const pollRes = await axios.get(`${APIFY_BASE}/actor-runs/${run.id}?token=${token}`);
    run = pollRes.data.data;
    polls++;
  }

  // Timed out on our side but the run is still going — abort it so we don't
  // pay for a zombie run, then use whatever it collected so far.
  if (run.status === 'RUNNING') {
    const abortRes = await axios.post(`${APIFY_BASE}/actor-runs/${run.id}/abort?token=${token}`, {});
    run = abortRes.data.data;
    console.warn(`[reddit] run ${run.id} exceeded ${MAX_POLL_MINUTES}min, aborted; using partial results`);
  }

  // ABORTED (by us, above) still has a usable partial dataset
  if (run.status !== 'SUCCEEDED' && run.status !== 'ABORTED') {
    throw new Error(`Apify run ${run.id} ended with status ${run.status}`);
  }

  const itemsRes = await axios.get(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json`,
  );
  const items: ApifyRedditItem[] = itemsRes.data;

  const posts: RawPost[] = [];
  for (const item of items) {
    if (item.dataType && item.dataType !== 'post') continue;
    const id = item.parsedId || item.id;
    if (!id || !item.url) continue;

    posts.push({
      id: `reddit-${id}`,
      platform: 'reddit',
      title: item.title,
      body: item.body ?? '',
      author: item.username ?? 'unknown',
      url: item.url,
      subreddit: (item.parsedCommunityName || item.communityName || '').replace(/^r\//, ''),
      createdAt: item.createdAt ?? new Date().toISOString(),
    });
  }

  return posts;
}
