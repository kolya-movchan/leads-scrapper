import 'dotenv/config';
import { scrapeDesignReddit } from '../src/scrapers/design-reddit.js';

scrapeDesignReddit()
  .then((posts) => {
    console.log(`Found ${posts.length} design-related Reddit posts`);
    posts.slice(0, 3).forEach((p) => {
      console.log(`  - ${p.title || p.body.slice(0, 50)}`);
    });
  })
  .catch((err) => console.error('Error:', err));
