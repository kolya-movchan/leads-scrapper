// One-off Google Maps scraper test: scrape only (no Claude, no CSV, no dedup
// marking) — for cheaply verifying the actor's output mapping.
// Usage: GMAPS_QUERIES="dental clinic" GMAPS_MAX_PLACES=3 npx tsx scripts/test-google-maps.ts
import 'dotenv/config';
import { scrapeGoogleMaps } from '../src/scrapers/google-maps.js';
import { filterDuplicates } from '../src/storage/dedup.js';

const places = await scrapeGoogleMaps();
console.log(`[google-maps] ${places.length} places scraped`);

const newPlaces = filterDuplicates(places);
console.log(`${newPlaces.length} new after dedup\n`);

for (const p of places) {
  console.log(JSON.stringify(p, null, 2));
}
