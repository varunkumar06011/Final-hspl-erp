/**
 * Speech-to-text for Miko's microphone button. The browser records the mic
 * (MediaRecorder) and sends the clip here; OpenAI transcribes it. This works on
 * every browser and the iOS app, and is far better with Telugu and Indian-accented
 * English than the browser's built-in speech recognition.
 */
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { AssistantProviderError } from './openai';

const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';
const TIMEOUT_MS = 60_000;
// Fixed on purpose, like the chat model.
const MODEL = 'gpt-4o-transcribe';
// Nudges the model towards the procurement words staff actually say.
const VOCABULARY =
  'Hospital construction procurement and accounts. Terms: MPR, quotation, purchase order, PO, vendor, invoice, goods receipt, GRN, payment, GST, budget, cement, steel, TMT bars, sand, bricks, pipes, paint, tiles.';

export const AUDIO_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/mpeg',
] as const;
const FILE_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
};

/** Live previews send the clip again every few seconds, so each user gets a generous hourly budget. */
const HOUR_MS = 60 * 60 * 1000;
const HOURLY_BUDGET = 400;
const budget = new Map<string, { windowStart: number; count: number }>();

export function consumeTranscribeBudget(userId: string): boolean {
  const now = Date.now();
  const cur = budget.get(userId);
  const entry = cur && now - cur.windowStart < HOUR_MS ? cur : { windowStart: now, count: 0 };
  budget.set(userId, entry);
  if (entry.count >= HOURLY_BUDGET) return false;
  entry.count += 1;
  return true;
}

export async function transcribeAudio(opts: {
  data: Buffer;
  mimeType: string;
  language?: 'en' | 'te';
}): Promise<string> {
  if (!env.OPENAI_API_KEY) throw new AssistantProviderError('Voice input is not configured', 503);

  const form = new FormData();
  form.append('model', MODEL);
  form.append('response_format', 'json');
  form.append('prompt', VOCABULARY);
  if (opts.language) form.append('language', opts.language);
  form.append(
    'file',
    new Blob([new Uint8Array(opts.data)], { type: opts.mimeType }),
    `speech.${FILE_EXT[opts.mimeType] ?? 'webm'}`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn({
        event: 'assistant_transcribe_upstream',
        status: res.status,
        detail: detail.slice(0, 300),
      });
      throw new AssistantProviderError(
        'Transcription failed',
        res.status === 429 ? 429 : 502,
        res.status,
      );
    }
    const json = (await res.json()) as { text?: string };
    return (json.text ?? '').trim();
  } catch (error) {
    if (error instanceof AssistantProviderError) throw error;
    logger.warn({ event: 'assistant_transcribe_unreachable', message: (error as Error).message });
    throw new AssistantProviderError('Transcription unreachable');
  } finally {
    clearTimeout(timer);
  }
}
