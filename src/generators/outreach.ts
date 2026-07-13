import Anthropic from '@anthropic-ai/sdk';
import { GoogleMapsPlace, BusinessLead } from '../types/index.js';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM_PROMPT = `You help an AI automation engineer and web developer prospect local businesses found on Google Maps. He offers: AI chatbots (website/Instagram/Telegram), automated booking and reminders, lead-capture automation, review-request automation, and modern websites.

Given one business, do two things:

1. Score fitScore 1-10: how good a prospect is this business for those services?
   High: service businesses that live on appointments/inquiries (clinics, schools, salons, repair shops), established (decent reviews count), reachable (email/phone/socials), and with visible gaps (no website, low rating with many reviews = drowning in ops, etc.).
   Low: businesses unlikely to buy (government offices, big chains with corporate IT, closed niches), or with nothing to contact.

2. Write outreachMessage: a 3-5 sentence cold email/DM in first person ("I"), addressed to this specific business. Reference something concrete about them (their niche, their rating/review count, their missing website — whatever stands out) and propose ONE specific AI service that fits their business type, with a concrete benefit. Casual-professional tone, no buzzwords, no "I hope this finds you well", end with a low-friction question. Write it in English.

Always fill "reason" with one short sentence explaining the score.`;

// Structured output schema — the API guarantees the response validates against this
const OUTPUT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      fitScore: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      reason: { type: 'string' },
      outreachMessage: { type: 'string' },
    },
    required: ['fitScore', 'reason', 'outreachMessage'],
    additionalProperties: false,
  },
} as const;

export async function analyzeBusiness(place: GoogleMapsPlace): Promise<BusinessLead | null> {
  const userMessage = [
    `Name: ${place.name}`,
    `Category: ${place.category || 'unknown'}`,
    `City: ${place.city || 'unknown'}`,
    `Address: ${place.address || 'unknown'}`,
    `Rating: ${place.rating ?? 'none'} (${place.reviewsCount ?? 0} reviews)`,
    `Website: ${place.website ?? 'NONE'}`,
    `Email: ${place.email ?? 'none'}`,
    `Phone: ${place.phone ?? 'none'}`,
    `Instagram: ${place.instagram ?? 'none'}`,
    `Facebook: ${place.facebook ?? 'none'}`,
    `Found via search: "${place.searchString}"`,
  ].join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: OUTPUT_SCHEMA },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;

    const analysis: Omit<BusinessLead, 'place'> = JSON.parse(text.text);
    return { place, ...analysis };
  } catch (err) {
    console.error(`[claude] failed to analyze ${place.id}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
