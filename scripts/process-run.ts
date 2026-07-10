// One-off: process an existing Apify run's dataset through the pipeline
// (dedup -> Claude filter -> Telegram). Usage: npx tsx scripts/process-run.ts <datasetId>
import 'dotenv/config';
import axios from 'axios';
const { claudeFilter } = await import('../src/filters/claudeFilter.js');
const { sendToTelegram } = await import('../src/notifiers/telegram.js');
const { filterDuplicates, markAsSeen } = await import('../src/storage/dedup.js');
import type { RawPost } from '../src/types/index.js';

const datasetId = process.argv[2];
const token = process.env.APIFY_API_TOKEN;
const res = await axios.get(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${token}&format=json`);

const posts: RawPost[] = [];
for (const item of res.data) {
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

const fresh = filterDuplicates(posts);
console.log(`${posts.length} posts, ${fresh.length} new`);

for (const post of fresh) {
  const lead = await claudeFilter(post);
  if (!lead) continue;
  const { relevanceScore, whatTheyNeed, isWebDesign } = lead.analysis;
  console.log(`[${relevanceScore}/10]${isWebDesign ? ' [DESIGN]' : ''} ${post.title?.slice(0, 70)} — ${whatTheyNeed.slice(0, 80)}`);
  if (relevanceScore >= 7) {
    await sendToTelegram(lead);
    console.log('  -> sent to Telegram');
    await new Promise((r) => setTimeout(r, 1000));
  }
  markAsSeen(post.id);
}
console.log('done');
