import axios from 'axios';
import { RawPost } from '../types/index.js';

// Scraper for web design, UX/UI needs on Meta Threads
// Search takes plain keywords (max 20); max_posts is charged PER KEYWORD
const ACTOR_ID = 'futurizerush~meta-threads-scraper';
const APIFY_BASE = 'https://api.apify.com/v2';

// Web design and UX/UI hiring-intent phrases
// 50/50 English + Ukrainian to cover both markets
const DEFAULT_KEYWORDS = [
  // English
  'need web design',
  'need UI designer',
  'looking for designer',
  'need UX design',
  'website redesign needed',
  // Ukrainian
  'потрібен веб дизайнер',
  'шукаю дизайнера UI/UX',
  'потрібна переробка сайту',
  'лого дизайн потрібен',
  'потрібна брендінг',
];

// Override in .env: DESIGN_THREADS_KEYWORDS (comma-separated)
const KEYWORDS = process.env.DESIGN_THREADS_KEYWORDS
  ? process.env.DESIGN_THREADS_KEYWORDS.split(',').map((k) => k.trim()).filter(Boolean)
  : DEFAULT_KEYWORDS;

// Actor rejects max_posts below 10
const MAX_POSTS = Math.max(10, Number(process.env.DESIGN_THREADS_MAX_POSTS) || 15);

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

export async function scrapeDesignThreads(): Promise<RawPost[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not set');

  const input = {
    mode: 'search',
    keywords: KEYWORDS,
    search_filter: 'recent',
    start_date: '1 day',
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
    console.warn(`[design-threads] run ${run.id} exceeded ${MAX_POLL_MINUTES}min, aborted; using partial results`);
  }

  if (run.status !== 'SUCCEEDED' && run.status !== 'ABORTED') {
    throw new Error(`Apify run ${run.id} ended with status ${run.status}`);
  }

  const itemsRes = await axios.get(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json`,
  );
  const items: ApifyThreadsItem[] = itemsRes.data;

  const posts: RawPost[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.record_type && item.record_type !== 'post') continue;
    if (!item.post_code || !item.post_url || !item.text_content) continue;
    if (seen.has(item.post_code)) continue;
    seen.add(item.post_code);

    posts.push({
      id: `design-threads-${item.post_code}`,
      platform: 'threads',
      body: item.text_content,
      author: item.username ?? 'unknown',
      url: item.post_url,
      createdAt: item.created_at ?? new Date().toISOString(),
    });
  }

  return posts;
}
