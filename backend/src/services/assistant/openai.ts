/**
 * Minimal OpenAI function-calling client for the assistant. Kept behind a tiny
 * interface (`generate`) so the provider can be swapped without touching the
 * engine or the tools.
 *
 * The conversation is stored (and round-tripped through the client) in a
 * provider-neutral, Gemini-shaped format (`ChatContent` / `ChatPart`) so old
 * histories keep working; it is translated to Chat Completions messages here.
 */
import { env } from '../../config/env';
import { logger } from '../../utils/logger';

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const TIMEOUT_MS = 90_000;
// Fixed on purpose: not configurable, so a stale env var can never point Miko at another model.
const MODEL = 'gpt-5-mini';

export interface ChatPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
  /** A photo the user attached this turn (never kept in the history sent back to the client). */
  inlineData?: { mimeType: string; data: string };
  // Legacy fields from histories written by the earlier Gemini provider; ignored.
  thoughtSignature?: string;
  thought?: boolean;
}

export interface ChatContent {
  role: 'user' | 'model';
  parts: ChatPart[];
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

/** Tool schemas are written with upper-case type names (STRING, OBJECT...); JSON Schema wants lower-case. */
function lowerTypes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(lowerTypes);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : lowerTypes(v);
  }
  return out;
}

type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | Array<Record<string, unknown>> }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
    }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Translate the neutral history into Chat Completions messages, pairing each tool result with its call id. */
function toMessages(system: string, contents: ChatContent[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [{ role: 'system', content: system }];
  let seq = 0;
  let open: Array<{ id: string; name: string }> = [];

  // A tool call left unanswered would make the API reject the request; close it with a stub.
  const closeOpen = () => {
    for (const c of open) messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify({ error: 'no result' }) });
    open = [];
  };

  for (const c of contents) {
    if (c.role === 'model') {
      closeOpen();
      const text = c.parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('');
      const calls = c.parts
        .filter((p) => p.functionCall)
        .map((p) => ({ id: `call_${++seq}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
      if (!text && calls.length === 0) continue;
      messages.push({
        role: 'assistant',
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((x) => ({
                id: x.id,
                type: 'function' as const,
                function: { name: x.name, arguments: JSON.stringify(x.args) },
              })),
            }
          : {}),
      });
      open = calls.map((x) => ({ id: x.id, name: x.name }));
      continue;
    }

    for (const p of c.parts.filter((x) => x.functionResponse)) {
      const idx = open.findIndex((o) => o.name === p.functionResponse!.name);
      if (idx === -1) continue; // orphan result: drop rather than get a 400
      const [call] = open.splice(idx, 1);
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(p.functionResponse!.response) });
    }
    closeOpen();

    const text = c.parts
      .filter((p) => p.text)
      .map((p) => p.text)
      .join('\n');
    const images = c.parts.filter((p) => p.inlineData);
    if (!text && images.length === 0) continue;
    if (images.length === 0) {
      messages.push({ role: 'user', content: text });
    } else {
      messages.push({
        role: 'user',
        content: [
          ...(text ? [{ type: 'text', text }] : []),
          ...images.map((p) => ({
            type: 'image_url',
            image_url: { url: `data:${p.inlineData!.mimeType};base64,${p.inlineData!.data}` },
          })),
        ],
      });
    }
  }
  closeOpen();
  return messages;
}

export async function generate(opts: {
  system: string;
  contents: ChatContent[];
  tools: FunctionDeclaration[];
}): Promise<ChatContent> {
  if (!env.OPENAI_API_KEY) {
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
  contents: ChatContent[];
  tools: FunctionDeclaration[];
}): Promise<ChatContent> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new AssistantProviderError('The AI assistant is not configured', 503);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: toMessages(opts.system, opts.contents),
        tools: opts.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: lowerTypes(t.parameters ?? { type: 'OBJECT', properties: {} }),
          },
        })),
        tool_choice: 'auto',
        reasoning_effort: env.ASSISTANT_REASONING_EFFORT,
      }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      const detail = (await res.text()).slice(0, 400);
      logger.warn({ event: 'assistant_provider_429', detail });
      const noCredit = detail.includes('insufficient_quota');
      throw new AssistantProviderError(
        noCredit ? 'The AI service has run out of credit. Please contact the administrator.' : 'The AI service is busy. Please try again in a moment.',
        429,
      );
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new AssistantProviderError(
        res.status === 503 ? 'The AI service is busy. Please try again in a moment.' : `AI provider error (${res.status}): ${detail}`,
        502,
        res.status,
      );
    }

    const json: any = await res.json();
    const choice = json?.choices?.[0];
    const message = choice?.message;
    const parts: ChatPart[] = [];
    if (typeof message?.content === 'string' && message.content.trim()) parts.push({ text: message.content });
    for (const call of message?.tool_calls ?? []) {
      if (call?.type !== 'function' || !call.function?.name) continue;
      let args: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.function.arguments || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
      } catch {
        // malformed arguments: pass empty args; schema validation reports what is missing
      }
      parts.push({ functionCall: { name: call.function.name, args } });
    }
    if (!parts.length) {
      const reason = message?.refusal ? 'refused' : choice?.finish_reason;
      throw new AssistantProviderError(`The AI returned no answer${reason ? ` (${reason})` : ''}`);
    }
    return { role: 'model', parts };
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
