// One-off: run ONLY the Twitter scraper and print what it finds (no Claude, no Telegram).
// Usage: npx tsx scripts/test-twitter.ts
import 'dotenv/config';
const { scrapeTwitter } = await import('../src/scrapers/twitter.js');

const posts = await scrapeTwitter();
console.log(`[twitter] ${posts.length} posts`);
for (const p of posts) {
  console.log(`@${p.author} | ${p.url}\n  ${p.body.slice(0, 120).replace(/\n/g, ' ')}`);
}
