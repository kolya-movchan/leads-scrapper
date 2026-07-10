import axios from 'axios';
import { RawPost } from '../types/index.js';

// Verified against the Apify Store on 2026-07-10: most-used Threads scraper
// with a Search mode ($0.0025/result on paid tiers). Search takes plain
// keywords (max 20); max_posts is charged PER KEYWORD, so cost ≈ keywords × max_posts.
const ACTOR_ID = 'futurizerush~meta-threads-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

// Hiring-intent phrases — single words like "zapier" pull mostly discussion, not leads.
// 50/50 English + Ukrainian to also cover the Ukrainian market.
// Cost = keywords × MAX_POSTS, so keep the list tight (actor cap: 20 keywords).
const DEFAULT_KEYWORDS = [
  // English
  // 'need automation',
  // 'looking for a developer',
  // 'build me a website',
  // 'need a website',
  // 'need AI automation',
  // 'need an AI agent',
  // Ukrainian
  'потрібна автоматизація',
  'шукаю розробника',
  'потрібен сайт',
  'AI автоматизація',
  'хто робить AI агентів',
  'потрібен чат-бот',
];

// Override in .env: THREADS_KEYWORDS (comma-separated), THREADS_MAX_POSTS (per keyword)
const KEYWORDS = process.env.THREADS_KEYWORDS
  ? process.env.THREADS_KEYWORDS.split(',').map((k) => k.trim()).filter(Boolean)
  : DEFAULT_KEYWORDS;
// Actor rejects max_posts below 10
const MAX_POSTS = Math.max(10, Number(process.env.THREADS_MAX_POSTS) || 10);

const WAIT_FOR_FINISH_SECS = 60;
const MAX_POLL_MINUTES = 20;

interface ApifyThreadsItem {
  record_type?: string;
  post_code?: string;
  post_url?: string;
  text_content?: string;
  username?: string;
  created_at?: string;
  followers_count?: number;
  bio?: string;
}

export async function scrapeThreads(): Promise<RawPost[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not set');

  const input = {
    mode: 'search',
    keywords: KEYWORDS,
    search_filter: 'recent',
    start_date: '1 day', // scheduled every 2h; dedup drops the overlap between runs
    max_posts: MAX_POSTS,
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
    console.warn(`[threads] run ${run.id} exceeded ${MAX_POLL_MINUTES}min, aborted; using partial results`);
  }

  if (run.status !== 'SUCCEEDED' && run.status !== 'ABORTED') {
    throw new Error(`Apify run ${run.id} ended with status ${run.status}`);
  }

  const itemsRes = await axios.get(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json`,
  );
  const items: ApifyThreadsItem[] = itemsRes.data;

  const posts: RawPost[] = [];
  const seen = new Set<string>(); // same post can match several keywords
  for (const item of items) {
    if (item.record_type && item.record_type !== 'post') continue;
    if (!item.post_code || !item.post_url || !item.text_content) continue;
    if (seen.has(item.post_code)) continue;
    seen.add(item.post_code);

    posts.push({
      id: `threads-${item.post_code}`,
      platform: 'threads',
      body: item.text_content,
      author: item.username ?? 'unknown',
      url: item.post_url,
      createdAt: item.created_at ?? new Date().toISOString(),
    });
  }

  return posts;
}
