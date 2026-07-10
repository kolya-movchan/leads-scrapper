// One-off Threads test: full pipeline (scrape → dedup → Claude → Telegram),
// but Threads only, so a test doesn't trigger a paid Reddit run.
// Usage: THREADS_KEYWORDS="a,b,c" THREADS_MAX_POSTS=5 npx tsx scripts/test-threads.ts
import 'dotenv/config';
import { scrapeThreads } from '../src/scrapers/threads.js';
import { claudeFilter } from '../src/filters/claudeFilter.js';
import { sendToTelegram } from '../src/notifiers/telegram.js';
import { filterDuplicates, markAsSeen } from '../src/storage/dedup.js';

const MIN_SCORE = 7;

const posts = await scrapeThreads();
console.log(`[threads] ${posts.length} posts scraped`);

const newPosts = filterDuplicates(posts);
console.log(`${newPosts.length} new after dedup`);

let sent = 0;
for (const post of newPosts) {
  const lead = await claudeFilter(post);
  if (!lead) continue;

  const { relevanceScore, whatTheyNeed } = lead.analysis;
  console.log(`  [${relevanceScore}/10] @${post.author}: ${whatTheyNeed} — ${post.url}`);

  if (relevanceScore >= MIN_SCORE) {
    await sendToTelegram(lead);
    sent++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  markAsSeen(post.id);
}

console.log(`Done. ${sent} leads sent to Telegram.`);
