import 'dotenv/config';
import { scrapeDesignThreads } from '../src/scrapers/design-threads.js';

scrapeDesignThreads()
  .then((posts) => {
    console.log(`Found ${posts.length} design-related Threads posts`);
    posts.slice(0, 3).forEach((p) => {
      console.log(`  - ${p.body.slice(0, 50)}`);
    });
  })
  .catch((err) => console.error('Error:', err));
