/**
 * Text-to-speech for Miko's replies (the speaker button and voice mode). The
 * reply text goes to OpenAI and comes back as MP3; nothing is stored.
 */
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { AssistantProviderError } from './openai';

const SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const TIMEOUT_MS = 45_000;
// Fixed on purpose, like the chat and transcription models.
const MODEL = 'gpt-4o-mini-tts';
const VOICE = 'coral';
export const MAX_SPEECH_CHARS = 1500;

const INSTRUCTIONS: Record<'en' | 'te', string> = {
  en: 'Speak in clear Indian English, warm and calm, at a steady pace. Read rupee amounts the Indian way (lakh, crore) and document numbers letter by letter.',
  te: 'Speak natural, clear Telugu, warm and calm, at a steady pace. English words such as PO, MPR, invoice and material names stay in English. Read rupee amounts the Indian way (lakh, crore).',
};

const HOUR_MS = 60 * 60 * 1000;
const HOURLY_BUDGET = 150;
const budget = new Map<string, { windowStart: number; count: number }>();

export function consumeSpeechBudget(userId: string): boolean {
  const now = Date.now();
  const cur = budget.get(userId);
  const entry = cur && now - cur.windowStart < HOUR_MS ? cur : { windowStart: now, count: 0 };
  budget.set(userId, entry);
  if (entry.count >= HOURLY_BUDGET) return false;
  entry.count += 1;
  return true;
}

/** Drops what should not be read aloud (markdown marks, links). */
export function speakableText(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SPEECH_CHARS);
}

export async function synthesizeSpeech(opts: { text: string; language?: 'en' | 'te' }): Promise<Buffer> {
  if (!env.OPENAI_API_KEY) throw new AssistantProviderError('Voice replies are not configured', 503);
  const input = speakableText(opts.text);
  if (!input) throw new AssistantProviderError('Nothing to read aloud', 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(SPEECH_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        voice: VOICE,
        input,
        instructions: INSTRUCTIONS[opts.language ?? 'en'],
        response_format: 'mp3',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn({ event: 'assistant_speech_upstream', status: res.status, detail: detail.slice(0, 300) });
      throw new AssistantProviderError('Speech failed', res.status === 429 ? 429 : 502, res.status);
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (error) {
    if (error instanceof AssistantProviderError) throw error;
    logger.warn({ event: 'assistant_speech_unreachable', message: (error as Error).message });
    throw new AssistantProviderError('Speech unreachable');
  } finally {
    clearTimeout(timer);
  }
}
