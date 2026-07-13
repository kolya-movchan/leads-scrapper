// Google Maps local-business prospecting pipeline (separate from the social
// hiring-intent pipeline in index.ts). Run on demand: npm run maps
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { scrapeGoogleMaps } from './scrapers/google-maps.js';
import { analyzeBusiness } from './generators/outreach.js';
import { appendLeadsToCsv } from './sinks/csv.js';
import { sendTelegramText } from './notifiers/telegram.js';
import { filterDuplicates, markAsSeen, cleanupSeen } from './storage/dedup.js';
import { GoogleMapsPlace, BusinessLead } from './types/index.js';

const RUNS_DIR = path.resolve('runs');

const MIN_SCORE = Number(process.env.GMAPS_MIN_SCORE) || 6;

function hasContactChannel(place: GoogleMapsPlace): boolean {
  return Boolean(place.email || place.phone || place.instagram || place.facebook || place.website);
}

function saveRunSnapshot(allPlaces: GoogleMapsPlace[], leads: BusinessLead[], saved: number): void {
  try {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(RUNS_DIR, `maps-${ts}.json`);
    const snapshot = {
      timestamp: new Date().toISOString(),
      totalScraped: allPlaces.length,
      analyzed: leads.length,
      savedToCsv: saved,
      leads: leads.map((l) => ({
        id: l.place.id,
        name: l.place.name,
        category: l.place.category,
        city: l.place.city,
        email: l.place.email,
        phone: l.place.phone,
        website: l.place.website,
        rating: l.place.rating,
        reviewsCount: l.place.reviewsCount,
        fitScore: l.fitScore,
        reason: l.reason,
        outreachMessage: l.outreachMessage,
        url: l.place.url,
        savedToCsv: l.fitScore >= MIN_SCORE,
      })),
    };
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
    console.log(`[runs] snapshot saved → runs/maps-${ts}.json`);
  } catch (err) {
    console.error('[runs] failed to save snapshot:', err instanceof Error ? err.message : err);
  }
}

async function run(): Promise<void> {
  console.log(`[${new Date().toISOString()}] Starting Google Maps business scan...`);

  cleanupSeen();

  const places = await scrapeGoogleMaps();
  console.log(`[google-maps] ${places.length} places scraped`);

  const newPlaces = filterDuplicates(places);
  console.log(`${newPlaces.length} new after dedup`);

  const analyzed: BusinessLead[] = [];
  const accepted: BusinessLead[] = [];

  for (const place of newPlaces) {
    if (!hasContactChannel(place)) {
      // Nothing to outreach to — skip the Claude call, don't re-analyze next run
      console.log(`[filter] ✗ skip (no contacts) — ${place.name}`);
      markAsSeen(place.id);
      continue;
    }

    const lead = await analyzeBusiness(place);
    if (!lead) continue; // Claude API error — don't mark seen, retry next run

    analyzed.push(lead);

    const label = lead.fitScore >= MIN_SCORE ? '✓ LEAD' : '✗ skip';
    console.log(`[filter] ${label} score ${lead.fitScore}/10 — ${place.name} — ${lead.reason}`);

    if (lead.fitScore >= MIN_SCORE) {
      accepted.push(lead);
    } else {
      markAsSeen(place.id); // scored below threshold — discard, don't re-pay
    }
  }

  if (accepted.length > 0) {
    appendLeadsToCsv(accepted);
    // Mark seen only after the CSV write succeeded
    for (const lead of accepted) markAsSeen(lead.place.id);
  }

  saveRunSnapshot(places, analyzed, accepted.length);

  try {
    await sendTelegramText(
      `🗺 Google Maps run: ${places.length} places, ${newPlaces.length} new, <b>${accepted.length} leads</b> → data/leads.csv`,
    );
  } catch (err) {
    console.error('[telegram] summary failed:', err instanceof Error ? err.message : err);
  }

  console.log(`[${new Date().toISOString()}] Done. ${accepted.length} leads appended to data/leads.csv`);
}

run().then(() => process.exit(0)).catch((err) => {
  console.error('Maps pipeline failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
