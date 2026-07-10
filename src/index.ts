import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { scrapeReddit } from './scrapers/reddit.js';
import { scrapeTwitter } from './scrapers/twitter.js';
import { scrapeThreads } from './scrapers/threads.js';
import { scrapeDesignReddit } from './scrapers/design-reddit.js';
import { scrapeDesignThreads } from './scrapers/design-threads.js';
import { scrapeDesignTwitter } from './scrapers/design-twitter.js';
import { claudeFilter } from './filters/claudeFilter.js';
import { sendToTelegram } from './notifiers/telegram.js';
import { filterDuplicates, markAsSeen, cleanupSeen } from './storage/dedup.js';
import { RawPost, FilteredLead } from './types/index.js';

const RUNS_DIR = path.resolve('runs');

const MIN_SCORE = 7;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function saveRunSnapshot(allPosts: RawPost[], leads: FilteredLead[], sent: number): void {
  try {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(RUNS_DIR, `${ts}.json`);
    const snapshot = {
      timestamp: new Date().toISOString(),
      totalScraped: allPosts.length,
      newPosts: leads.length,
      sentToTelegram: sent,
      posts: leads.map((l) => ({
        id: l.post.id,
        platform: l.post.platform,
        subreddit: l.post.subreddit ?? null,
        title: l.post.title ?? null,
        body: l.post.body,
        author: l.post.author,
        url: l.post.url,
        createdAt: l.post.createdAt,
        score: l.analysis.relevanceScore,
        reason: l.analysis.reason,
        whatTheyNeed: l.analysis.whatTheyNeed,
        budget: l.analysis.budget,
        urgency: l.analysis.urgency,
        isHiringPost: l.analysis.isHiringPost,
        isWebDesign: l.analysis.isWebDesign,
        sentToTelegram: l.analysis.relevanceScore >= MIN_SCORE,
      })),
    };
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
    console.log(`[runs] snapshot saved → runs/${ts}.json`);
  } catch (err) {
    console.error('[runs] failed to save snapshot:', err instanceof Error ? err.message : err);
  }
}

async function runPipeline(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting lead scan...`);

  try {
    cleanupSeen();

    const scrapers: [string, () => Promise<RawPost[]>][] = [
      ['design-threads', scrapeDesignThreads],
      // ['design-twitter', scrapeDesignTwitter],
      ['design-reddit', scrapeDesignReddit],
      ['threads', scrapeThreads],
      // ['twitter', scrapeTwitter],
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
    const scoredLeads: FilteredLead[] = [];

    for (const post of newPosts) {
      const lead = await claudeFilter(post);
      if (!lead) continue; // Claude API error — don't mark seen, retry next cycle

      scoredLeads.push(lead);

      const { relevanceScore, reason } = lead.analysis;
      const label = relevanceScore >= MIN_SCORE ? '✓ LEAD' : '✗ skip';
      const title = post.title ?? post.body.slice(0, 60);
      console.log(`[filter] ${label} score ${relevanceScore}/10 — ${title.trim()} — ${reason}`);

      if (relevanceScore >= MIN_SCORE) {
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
        markAsSeen(post.id); // scored below threshold — discard
      }
    }

    saveRunSnapshot(rawPosts, scoredLeads, sent);
    console.log(`[${new Date().toISOString()}] Scan done. ${sent} leads sent to Telegram.`);
  } catch (err) {
    console.error('Pipeline failed:', err instanceof Error ? err.message : err);
  }
}

const runOnce = process.argv.includes('--once');

if (runOnce) {
  runPipeline().then(() => process.exit(0));
} else {
  console.log('Lead finder started. Running now, then each day at 9:00 AM.');
  runPipeline();
  cron.schedule('0 */2 * * *', runPipeline);
}
