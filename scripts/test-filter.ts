import 'dotenv/config';
if (!process.env.ANTHROPIC_API_KEY) delete process.env.ANTHROPIC_API_KEY;
const { claudeFilter } = await import('../src/filters/claudeFilter.js');

const result = await claudeFilter({
  id: 'reddit-test1',
  platform: 'reddit',
  title: '[Hiring] Need someone to build an n8n automation for invoice processing',
  body: 'Budget is around $500. Need it done ASAP, DM me if interested.',
  author: 'testuser',
  url: 'https://reddit.com/r/forhire/test',
  subreddit: 'forhire',
  createdAt: new Date().toISOString(),
});
console.log(JSON.stringify(result, null, 2));
