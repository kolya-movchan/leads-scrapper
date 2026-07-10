import axios from 'axios';
import { RawPost } from '../types/index.js';

// Verified against the Apify Store on 2026-07-10: apidojo's Tweet Scraper V2
// ($0.40 per 1000 tweets). searchTerms accepts Twitter advanced-search syntax,
// so each term is a quoted phrase + within_time:1d to only pull fresh posts
// (the pipeline runs every 2h; dedup drops the overlap between runs).
const ACTOR_ID = 'apidojo~tweet-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

// Hiring-intent phrases, English + Ukrainian (same 50/50 approach as Threads)
const DEFAULT_KEYWORDS = [
  // English
  'need automation',
  'looking for a developer',
  'need a website',
  'need an AI agent',
  // Ukrainian
  'шукаю розробника',
  'потрібен сайт',
  'ШІ агент',
  'потрібна автоматизація',
];

// Override in .env: TWITTER_KEYWORDS (comma-separated), TWITTER_MAX_ITEMS (total)
const KEYWORDS = process.env.TWITTER_KEYWORDS
  ? process.env.TWITTER_KEYWORDS.split(',').map((k) => k.trim()).filter(Boolean)
  : DEFAULT_KEYWORDS;
const MAX_ITEMS = Number(process.env.TWITTER_MAX_ITEMS) || 50;

const WAIT_FOR_FINISH_SECS = 60;
const MAX_POLL_MINUTES = 20;

interface ApifyTweetItem {
  type?: string; // "tweet" | "mock_tweet" (returned when nothing matches)
  id?: string;
  url?: string;
  twitterUrl?: string;
  text?: string;
  fullText?: string;
  createdAt?: string;
  isRetweet?: boolean;
  author?: { userName?: string };
}

export async function scrapeTwitter(): Promise<RawPost[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not set');

  const input = {
    searchTerms: KEYWORDS.map((kw) => `"${kw}" within_time:1d`),
    sort: 'Latest',
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
    console.warn(`[twitter] run ${run.id} exceeded ${MAX_POLL_MINUTES}min, aborted; using partial results`);
  }

  if (run.status !== 'SUCCEEDED' && run.status !== 'ABORTED') {
    throw new Error(`Apify run ${run.id} ended with status ${run.status}`);
  }

  const itemsRes = await axios.get(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json`,
  );
  const items: ApifyTweetItem[] = itemsRes.data;

  const posts: RawPost[] = [];
  const seen = new Set<string>(); // same tweet can match several search terms
  for (const item of items) {
    if (item.type !== 'tweet') continue; // skips the actor's "mock_tweet" no-results placeholder
    if (item.isRetweet) continue;
    const text = item.fullText || item.text;
    const url = item.url || item.twitterUrl;
    if (!item.id || !url || !text) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    posts.push({
      id: `twitter-${item.id}`,
      platform: 'twitter',
      body: text,
      author: item.author?.userName ?? 'unknown',
      url,
      createdAt: item.createdAt ?? new Date().toISOString(),
    });
  }

  return posts;
}
