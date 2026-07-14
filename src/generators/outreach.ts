import Anthropic from '@anthropic-ai/sdk';
import { GoogleMapsPlace, BusinessLead } from '../types/index.js';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const PORTFOLIO_URL = 'https://canva.link/6wpto403og9nk5o';
const LINKEDIN_URL = 'https://www.linkedin.com/in/klmovchan/';

const SYSTEM_PROMPT = `Ти допомагаєш AI-розробнику та веб-розробнику знаходити клієнтів серед локальних бізнесів на Google Maps. Він пропонує: AI-чатботи (для сайту/Instagram/Telegram), автоматизацію запису та нагадувань, автоматизацію збору лідів, автоматизацію запитів на відгуки та сучасні сайти.

Наразі він розширює портфоліо, тому готовий зробити перший проєкт за мінімальну ціну — йому цікаво більше протестувати і показати результат, ніж заробити прямо зараз.

Для кожного бізнесу зроби два кроки:

1. Оціни fitScore від 1 до 10: наскільки цей бізнес підходить як потенційний клієнт?
   Висока оцінка: сервісні бізнеси, що живуть на записах/запитах (клініки, школи, салони, майстерні), з достатньою кількістю відгуків, з контактами та видимими прогалинами (немає сайту, низький рейтинг при великій кількості відгуків тощо).
   Низька оцінка: бізнеси, що навряд куплять (держустанови, великі мережі з корпоративним IT, закриті ніші) або без контактів.

2. Напиши outreachMessage: холодне повідомлення (email/DM) від першої особи ("Я"), адресоване конкретному бізнесу. Напиши 3-5 речень. Згадай щось конкретне про цей бізнес (нішу, рейтинг, кількість відгуків, відсутність сайту — що вирізняє). Запропонуй ОДНУ конкретну AI-послугу, що підходить їхньому типу бізнесу, з конкретною користю. Зазнач, що зараз розширюєш портфоліо і готовий зробити це за мінімальну ціну, бо цікавіше протестувати і показати результат. Закінчи легким запитанням, що мотивує відповісти. В кінці додай посилання на портфоліо та LinkedIn у такому форматі:

Портфоліо: ${PORTFOLIO_URL}
LinkedIn: ${LINKEDIN_URL}

Тон — дружній і невимушений, без кліше типу "сподіваюсь, цей лист застане вас у доброму настрої". Пиши українською мовою.

Завжди заповнюй поле "reason" одним коротким реченням із поясненням оцінки.`;

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
