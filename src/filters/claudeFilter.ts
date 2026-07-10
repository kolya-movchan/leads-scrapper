import Anthropic from '@anthropic-ai/sdk';
import { RawPost, LeadAnalysis, FilteredLead } from '../types/index.js';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const SYSTEM_PROMPT = `You are a lead qualification assistant for an AI automation engineer and web developer (who also partners with a web designer).
You analyze social media posts and determine if the author is looking to hire someone or needs help with:
- Automation (n8n, Make, Zapier, workflow tools, AI pipelines, bots)
- Web development (websites, web apps, landing pages, SaaS products)
- AI integrations (chatbots, RAG systems, API integrations)
- Web design (UI/UX, visual design, redesigns, branding for websites)
- Any "build something for me" type request

Score relevance 1-10. Posts where the author is OFFERING services (not seeking them) score 1-2.
Set isWebDesign to true when the request is primarily about visual/UI design work.`;

// Structured output schema — the API guarantees the response validates against this,
// so no markdown-stripping or JSON.parse retry logic is needed.
const OUTPUT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      relevanceScore: { type: 'integer', enum: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
      whatTheyNeed: { type: 'string' },
      budget: { type: ['string', 'null'] },
      urgency: { type: ['string', 'null'] },
      contactHint: { type: ['string', 'null'] },
      isHiringPost: { type: 'boolean' },
      isWebDesign: { type: 'boolean' },
    },
    required: [
      'relevanceScore',
      'whatTheyNeed',
      'budget',
      'urgency',
      'contactHint',
      'isHiringPost',
      'isWebDesign',
    ],
    additionalProperties: false,
  },
} as const;

export async function claudeFilter(post: RawPost): Promise<FilteredLead | null> {
  const userMessage = [
    `Platform: ${post.platform}`,
    post.subreddit ? `Subreddit: r/${post.subreddit}` : null,
    `Title: ${post.title ?? '(no title)'}`,
    `Body:\n${post.body || '(empty)'}`,
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: OUTPUT_SCHEMA },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;

    const analysis: LeadAnalysis = JSON.parse(text.text);
    return { post, analysis };
  } catch (err) {
    console.error(`[claude] failed to score post ${post.id}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
