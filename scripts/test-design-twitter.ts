import 'dotenv/config';
import { scrapeDesignTwitter } from '../src/scrapers/design-twitter.js';

scrapeDesignTwitter()
  .then((posts) => {
    console.log(`Found ${posts.length} design-related Twitter posts`);
    posts.slice(0, 3).forEach((p) => {
      console.log(`  - ${p.body.slice(0, 50)}`);
    });
  })
  .catch((err) => console.error('Error:', err));
