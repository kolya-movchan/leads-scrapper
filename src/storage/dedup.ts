import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const SEEN_FILE = path.join(DATA_DIR, 'seen-posts.json');
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type SeenMap = Record<string, number>; // post id -> timestamp (ms)

function load(): SeenMap {
  try {
    return JSON.parse(fs.readFileSync(SEEN_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function save(map: SeenMap): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(map, null, 2));
}

/** Remove entries older than 30 days. Call once per pipeline run. */
export function cleanupSeen(): void {
  const map = load();
  const cutoff = Date.now() - RETENTION_MS;
  let removed = 0;
  for (const [id, ts] of Object.entries(map)) {
    if (ts < cutoff) {
      delete map[id];
      removed++;
    }
  }
  if (removed > 0) {
    save(map);
    console.log(`[dedup] cleaned up ${removed} entries older than 30 days`);
  }
}

export function isSeen(id: string): boolean {
  return id in load();
}

export function markAsSeen(id: string): void {
  const map = load();
  map[id] = Date.now();
  save(map);
}

export function filterDuplicates<T extends { id: string }>(posts: T[]): T[] {
  const map = load();
  return posts.filter((p) => !(p.id in map));
}
