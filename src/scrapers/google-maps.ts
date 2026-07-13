import axios from 'axios';
import { GoogleMapsPlace } from '../types/index.js';

// Google Maps places scraper with contact-details enrichment (scrapeContacts
// pulls emails/socials from each place's website). Pay-per-event pricing:
// keep GMAPS_MAX_PLACES low for test runs.
const ACTOR_ID = 'compass~crawler-google-places';
const APIFY_BASE = 'https://api.apify.com/v2';

const DEFAULT_QUERIES = ['english lessons', 'dental clinic'];

// Override via env: GMAPS_QUERIES=comma,separated GMAPS_LOCATION="Kyiv, Ukraine"
const SEARCH_QUERIES = process.env.GMAPS_QUERIES
  ? process.env.GMAPS_QUERIES.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_QUERIES;
const LOCATION = process.env.GMAPS_LOCATION || 'Kyiv, Ukraine';
const MAX_PLACES = Number(process.env.GMAPS_MAX_PLACES) || 10;

// Apify caps waitForFinish at 60s; after that we poll until the run finishes
const WAIT_FOR_FINISH_SECS = 60;
const MAX_POLL_MINUTES = 20;

interface ApifyPlaceItem {
  placeId?: string;
  title?: string;
  categoryName?: string;
  address?: string;
  city?: string;
  phone?: string;
  website?: string;
  emails?: string[];
  instagrams?: string[];
  facebooks?: string[];
  totalScore?: number;
  reviewsCount?: number;
  url?: string;
  searchString?: string;
  permanentlyClosed?: boolean;
  temporarilyClosed?: boolean;
}

const first = (arr?: string[]): string | null => (arr && arr.length > 0 ? arr[0] : null);

export async function scrapeGoogleMaps(): Promise<GoogleMapsPlace[]> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not set');

  const input = {
    searchStringsArray: SEARCH_QUERIES,
    locationQuery: LOCATION,
    maxCrawledPlacesPerSearch: MAX_PLACES,
    language: 'en',
    scrapeContacts: true,
    skipClosedPlaces: true,
    scrapePlaceDetailPage: false,
    maxReviews: 0,
    maxImages: 0,
  };

  console.log(`[google-maps] searching ${SEARCH_QUERIES.length} queries in "${LOCATION}", max ${MAX_PLACES} places each`);

  const startRes = await axios.post(
    `${APIFY_BASE}/acts/${ACTOR_ID}/runs?token=${token}&waitForFinish=${WAIT_FOR_FINISH_SECS}`,
    input,
    { headers: { 'Content-Type': 'application/json' }, timeout: (WAIT_FOR_FINISH_SECS + 30) * 1000 },
  );

  let run = startRes.data.data;

  const terminal = ['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'];
  const maxPolls = (MAX_POLL_MINUTES * 60) / 15;
  let polls = 0;
  while (!terminal.includes(run.status) && polls < maxPolls) {
    await new Promise((r) => setTimeout(r, 15_000));
    const pollRes = await axios.get(`${APIFY_BASE}/actor-runs/${run.id}?token=${token}`);
    run = pollRes.data.data;
    polls++;
  }

  // Timed out on our side but the run is still going — abort it so we don't
  // pay for a zombie run, then use whatever it collected so far.
  if (run.status === 'RUNNING') {
    const abortRes = await axios.post(`${APIFY_BASE}/actor-runs/${run.id}/abort?token=${token}`, {});
    run = abortRes.data.data;
    console.warn(`[google-maps] run ${run.id} exceeded ${MAX_POLL_MINUTES}min, aborted; using partial results`);
  }

  // ABORTED (by us, above) still has a usable partial dataset
  if (run.status !== 'SUCCEEDED' && run.status !== 'ABORTED') {
    throw new Error(`Apify run ${run.id} ended with status ${run.status}`);
  }

  const itemsRes = await axios.get(
    `${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${token}&format=json`,
  );
  const items: ApifyPlaceItem[] = itemsRes.data;

  // Same place can match multiple search queries — dedup within the batch
  const seen = new Set<string>();
  const places: GoogleMapsPlace[] = [];
  for (const item of items) {
    if (!item.placeId || !item.title) continue;
    if (item.permanentlyClosed || item.temporarilyClosed) continue;
    if (seen.has(item.placeId)) continue;
    seen.add(item.placeId);

    places.push({
      id: `google-maps-${item.placeId}`,
      name: item.title,
      category: item.categoryName ?? '',
      address: item.address ?? '',
      city: item.city ?? '',
      phone: item.phone ?? null,
      website: item.website ?? null,
      email: first(item.emails),
      instagram: first(item.instagrams),
      facebook: first(item.facebooks),
      rating: item.totalScore ?? null,
      reviewsCount: item.reviewsCount ?? null,
      url: item.url ?? `https://www.google.com/maps/place/?q=place_id:${item.placeId}`,
      searchString: item.searchString ?? '',
    });
  }

  return places;
}
