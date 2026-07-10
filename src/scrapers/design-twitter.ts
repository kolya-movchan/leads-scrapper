import axios from 'axios';
import { RawPost } from '../types/index.js';

// Scraper for web design, UX/UI needs on Twitter/X
// Uses kaitoeasyapi's pay-per-result scraper ($0.18 per 1000 tweets)
// searchTerms accepts Twitter advanced-search syntax
const ACTOR_ID = 'kaitoeasyapi~twitter-x-data-tweet-scraper-pay-per-result-cheapest';
const APIFY_BASE = 'https://api.apify.com/v2';

// Web design and UX/UI hiring-intent phrases
// English + Ukrainian (50/50 split for market coverage)
const DEFAULT_KEYWORDS = [
  // English
  'need web design',
  'looking for designer',
  'need UI designer',
  'UX design help',
  // Ukrainian
  'потрібен веб дизайнер',
  'шукаю дизайнера',
  'UI/UX дизайнер',
  'потрібна переробка сайту',
];

// Override in .env: DESIGN_TWITTER_KEYWORDS (comma-separated), DESIGN_TWITTER_MAX_ITEMS (total)
const KEYWORDS = process.env.DESIGN_TWITTER_KEYWORDS
  ? process.env.DESIGN_TWITTER_KEYWORDS.split(',').map((k) => k.trim()).filter(Boolean)
  : DEFAULT_KEYWORDS;
const MAX_ITEMS = Number(process.env.DESIGN_TWITTER_MAX_ITEMS) || 50;

const WAIT_FOR_FINISH_SECS = 60;
const MAX_POLL_MINUTES = 20;

interface ApifyTweetItem {
  type?: string;
  id?: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  fullText?: string;
  createdAt?: string;
  isRetweet?: boolean;
  author?: { userName?: string };
}

export async function scrapeDesignTwitter(): Promise<RawPost[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not set');

  const input = {
    searchTerms: KEYWORDS.map((kw) => `"${kw}" within_time:1d`),
    queryType: 'Latest',
    maxItems: MAX_ITEMS,
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
    console.warn(`[design-twitter] run ${run.id} exceeded ${MAX_POLL_MINUTES}min, aborted; using partial results`);
  }

  if (run.status !== 'SUCCEEDED' && run.status !== 'ABORTED') {
    throw new Error(`Apify run ${run.id} ended with status ${run.status}`);
  }

  const itemsRes = await axios.get(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json`,
  );
  const items: ApifyTweetItem[] = itemsRes.data;

  const posts: RawPost[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.type !== 'tweet') continue;
    if (item.isRetweet) continue;
    const text = item.fullText || item.text;
    const url = item.url || item.twitterUrl;
    if (!item.id || !url || !text) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    posts.push({
      id: `design-twitter-${item.id}`,
      platform: 'twitter',
      body: text,
      author: item.author?.userName ?? 'unknown',
      url,
      createdAt: item.createdAt ?? new Date().toISOString(),
    });
  }

  return posts;
}
