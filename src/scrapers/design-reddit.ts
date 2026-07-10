import axios from 'axios';
import { RawPost } from '../types/index.js';

// Scraper for web design, UX/UI, and design service needs on Reddit
const ACTOR_ID = 'trudax~reddit-scraper-lite';
const APIFY_BASE = 'https://api.apify.com/v2';

// Web design and UX/UI related keywords
const KEYWORDS = [
  'need web design',
  'looking for designer',
  'need UI design',
  'UX design help',
  'website redesign',
  'need branding',
  'design project',
  'need logo design',
  'looking for UX designer',
  'web design services',
  'need mockup',
  'design consultation',
];

// Design-focused subreddits
const SUBREDDITS = [
  'forhire',
  'slavelabour',
  'Design',
  'webdev',
  'UX_Design',
  'UI_Design',
  'graphic_design',
  'web_design',
  'entrepreneur',
  'startups',
];

// Override with DESIGN_REDDIT_MAX_ITEMS in .env to control Apify cost (~$0.004/result)
const MAX_ITEMS = Number(process.env.DESIGN_REDDIT_MAX_ITEMS) || 15;
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
  communityName?: string;
  parsedCommunityName?: string;
  createdAt?: string;
}

export async function scrapeDesignReddit(): Promise<RawPost[]> {
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

  if (run.status === 'RUNNING') {
    const abortRes = await axios.post(`${APIFY_BASE}/actor-runs/${run.id}/abort?token=${token}`, {});
    run = abortRes.data.data;
    console.warn(`[design-reddit] run ${run.id} exceeded ${MAX_POLL_MINUTES}min, aborted; using partial results`);
  }

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
      id: `design-reddit-${id}`,
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
