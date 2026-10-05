/**
 * Minimal Gemini function-calling client for the assistant. Kept behind a tiny
 * interface (`generate`) so the provider can be swapped without touching the
 * engine or the tools.
 */
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60_000;

export interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** A photo the user attached this turn (never kept in the history sent back to the client). */
  inlineData?: { mimeType: string; data: string };
  // Returned by thinking models on function-call parts; must be echoed back verbatim.
  thoughtSignature?: string;
  thought?: boolean;
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export class AssistantProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
    /** HTTP status returned by the provider, when it answered. */
    public upstream?: number,
  ) {
    super(message);
  }
}

export async function generate(opts: {
  system: string;
  contents: GeminiContent[];
  tools: FunctionDeclaration[];
}): Promise<GeminiContent> {
  if (!env.GEMINI_API_KEY) {
    throw new AssistantProviderError('The AI assistant is not configured', 503);
  }

  const RETRY_STATUSES = new Set([500, 502, 503, 504]);
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await generateOnce(opts);
    } catch (err) {
      const transient = err instanceof AssistantProviderError && RETRY_STATUSES.has(err.upstream ?? 0);
      if (!transient || attempt >= MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
}

async function generateOnce(opts: {
  system: string;
  contents: GeminiContent[];
  tools: FunctionDeclaration[];
}): Promise<GeminiContent> {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new AssistantProviderError('The AI assistant is not configured', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GEMINI_API_URL}/${env.ASSISTANT_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents: opts.contents,
        tools: [{ functionDeclarations: opts.tools }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
        generationConfig: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      logger.warn({ event: 'assistant_provider_429', detail: (await res.text()).slice(0, 400) });
      throw new AssistantProviderError('The AI service is busy. Please try again in a moment.', 429);
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new AssistantProviderError(res.status === 503 ? 'The AI service is busy. Please try again in a moment.' : `AI provider error (${res.status}): ${detail}`, 502, res.status);
    }

    const json: any = await res.json();
    const content = json?.candidates?.[0]?.content;
    if (!content?.parts?.length) {
      const reason = json?.candidates?.[0]?.finishReason ?? json?.promptFeedback?.blockReason;
      throw new AssistantProviderError(`The AI returned no answer${reason ? ` (${reason})` : ''}`);
    }
    return { role: 'model', parts: content.parts as GeminiPart[] };
  } catch (err) {
    if (err instanceof AssistantProviderError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AssistantProviderError('The AI took too long to answer', 504);
    }
    throw new AssistantProviderError(`Could not reach the AI service: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
