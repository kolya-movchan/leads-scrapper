import 'dotenv/config';
import cron from 'node-cron';
import { scrapeReddit } from './scrapers/reddit.js';
import { scrapeTwitter } from './scrapers/twitter.js';
import { scrapeThreads } from './scrapers/threads.js';
import { scrapeDesignReddit } from './scrapers/design-reddit.js';
import { scrapeDesignThreads } from './scrapers/design-threads.js';
import { claudeFilter } from './filters/claudeFilter.js';
import { sendToTelegram } from './notifiers/telegram.js';
import { filterDuplicates, markAsSeen, cleanupSeen } from './storage/dedup.js';
import { RawPost } from './types/index.js';

const MIN_SCORE = 7;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runPipeline(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting lead scan...`);

  try {
    cleanupSeen();

    const scrapers: [string, () => Promise<RawPost[]>][] = [
      ['design-threads', scrapeDesignThreads],
      ['design-reddit', scrapeDesignReddit],
      ['threads', scrapeThreads],
      ['twitter', scrapeTwitter],
      ['reddit', scrapeReddit],
    ];

    const rawPosts: RawPost[] = [];
    for (const [name, scrape] of scrapers) {
      try {
        const posts = await scrape();
        console.log(`[${name}] ${posts.length} posts`);
        rawPosts.push(...posts);
      } catch (err) {
        console.error(`[${name}] scraper failed:`, err instanceof Error ? err.message : err);
      }
    }

    const newPosts = filterDuplicates(rawPosts);
    console.log(`Found ${rawPosts.length} posts, ${newPosts.length} new`);

    let sent = 0;
    for (const post of newPosts) {
      const lead = await claudeFilter(post);
      if (!lead) continue; // Claude API error — don't mark seen, retry next cycle

      if (lead.analysis.relevanceScore >= MIN_SCORE) {
        try {
          await sendToTelegram(lead);
          markAsSeen(post.id);
          sent++;
          await sleep(1000); // avoid Telegram rate limits
        } catch (err) {
          // Telegram failed — do NOT mark as seen, so it retries next cycle
          console.error(`[telegram] failed to send ${post.id}:`, err instanceof Error ? err.message : err);
        }
      } else {
        markAsSeen(post.id); // scored below threshold — discard silently
      }
    }

    console.log(`[${new Date().toISOString()}] Scan done. ${sent} leads sent to Telegram.`);
  } catch (err) {
    console.error('Pipeline failed:', err instanceof Error ? err.message : err);
  }
}

const runOnce = process.argv.includes('--once');

if (runOnce) {
  runPipeline().then(() => process.exit(0));
} else {
  console.log('Lead finder started. Running now, then every 2 hours.');
  runPipeline();
  cron.schedule('0 */2 * * *', runPipeline);
}
