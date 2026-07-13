import axios from 'axios';
import { FilteredLead } from '../types/index.js';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain one-line notification (e.g. run summaries), HTML parse mode. */
export async function sendTelegramText(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set');

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

export async function sendToTelegram(lead: FilteredLead): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set');

  const { post, analysis } = lead;
  const platformName = post.platform.charAt(0).toUpperCase() + post.platform.slice(1);
  const source = post.subreddit ? `r/${post.subreddit}` : platformName;

  // Web design leads get a distinct header + tag so they stand out (friend collab)
  const header = analysis.isWebDesign
    ? `🎨 <b>New Lead — ${platformName}</b> · <b>#WEB_DESIGN</b> 🟣`
    : `🎯 <b>New Lead — ${platformName}</b>`;

  const message = [
    header,
    '',
    `📌 <b>${escapeHtml(source)}</b> · @${escapeHtml(post.author)}`,
    '',
    `<b>What they need:</b>`,
    escapeHtml(analysis.whatTheyNeed),
    '',
    `💰 <b>Budget:</b> ${escapeHtml(analysis.budget ?? 'not mentioned')}`,
    `⚡ <b>Urgency:</b> ${escapeHtml(analysis.urgency ?? 'not mentioned')}`,
    analysis.contactHint ? `📬 <b>Contact:</b> ${escapeHtml(analysis.contactHint)}` : null,
    `🏷 <b>Score:</b> ${analysis.relevanceScore}/10`,
    '',
    `<a href="${post.url}">→ Open Post</a>`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
    chat_id: chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}
