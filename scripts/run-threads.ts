// One-off: run ONLY the Threads scraper through the pipeline
// (scrape -> dedup -> Claude filter -> Telegram). Usage: npx tsx scripts/run-threads.ts
import 'dotenv/config';
const { scrapeThreads } = await import('../src/scrapers/threads.js');
const { claudeFilter } = await import('../src/filters/claudeFilter.js');
const { sendToTelegram } = await import('../src/notifiers/telegram.js');
const { filterDuplicates, markAsSeen } = await import('../src/storage/dedup.js');

const posts = await scrapeThreads();
console.log(`[threads] ${posts.length} posts`);

const fresh = filterDuplicates(posts);
console.log(`${posts.length} posts, ${fresh.length} new`);

let sent = 0;
for (const post of fresh) {
  const lead = await claudeFilter(post);
  if (!lead) continue;
  const { relevanceScore, whatTheyNeed, isWebDesign } = lead.analysis;
  console.log(`[${relevanceScore}/10]${isWebDesign ? ' [DESIGN]' : ''} @${post.author} — ${whatTheyNeed.slice(0, 90)}`);
  if (relevanceScore >= 7) {
    try {
      await sendToTelegram(lead);
      markAsSeen(post.id);
      sent++;
      console.log('  -> sent to Telegram');
      await new Promise((r) => setTimeout(r, 1000));
    } catch (err) {
      console.error(`  [telegram] failed:`, err instanceof Error ? err.message : err);
    }
  } else {
    markAsSeen(post.id);
  }
}
console.log(`done, ${sent} leads sent`);
