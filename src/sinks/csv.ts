import fs from 'node:fs';
import path from 'node:path';
import { BusinessLead } from '../types/index.js';

const DEFAULT_PATH = path.resolve('data', 'leads.csv');

const HEADER = [
  'date',
  'name',
  'category',
  'city',
  'address',
  'phone',
  'email',
  'website',
  'instagram',
  'facebook',
  'rating',
  'reviews',
  'fitScore',
  'reason',
  'outreachMessage',
  'mapsUrl',
  'searchQuery',
];

// RFC 4180: wrap in quotes when the value contains comma/quote/newline, double inner quotes
function escapeField(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function appendLeadsToCsv(leads: BusinessLead[], filePath = DEFAULT_PATH): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const rows = leads.map((l) =>
    [
      new Date().toISOString().slice(0, 10),
      l.place.name,
      l.place.category,
      l.place.city,
      l.place.address,
      l.place.phone,
      l.place.email,
      l.place.website,
      l.place.instagram,
      l.place.facebook,
      l.place.rating,
      l.place.reviewsCount,
      l.fitScore,
      l.reason,
      l.outreachMessage,
      l.place.url,
      l.place.searchString,
    ]
      .map(escapeField)
      .join(','),
  );

  const needsHeader = !fs.existsSync(filePath);
  const chunk = (needsHeader ? HEADER.join(',') + '\n' : '') + rows.join('\n') + '\n';
  fs.appendFileSync(filePath, chunk);
  console.log(`[csv] appended ${leads.length} leads → ${path.relative(process.cwd(), filePath)}`);
}
