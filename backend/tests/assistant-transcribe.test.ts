import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const envState = vi.hoisted(() => ({ OPENAI_API_KEY: 'sk-test' as string | undefined }));
vi.mock('../src/config/env', () => ({
  env: {
    get OPENAI_API_KEY() {
      return envState.OPENAI_API_KEY;
    },
  },
}));

import { transcribeAudio, consumeTranscribeBudget } from '../src/services/assistant/transcribe';
import { AssistantProviderError } from '../src/services/assistant/openai';

const audio = Buffer.from('fake-webm-bytes');

describe('assistant voice transcription', () => {
  beforeEach(() => {
    envState.OPENAI_API_KEY = 'sk-test';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the clip to the transcription model and returns trimmed text', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ text: '  ABC Traders కి 100 బస్తాల సిమెంట్  ' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await transcribeAudio({ data: audio, mimeType: 'audio/webm', language: 'te' });

    expect(text).toBe('ABC Traders కి 100 బస్తాల సిమెంట్');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    const form = init.body as FormData;
    expect(form.get('model')).toBe('gpt-4o-transcribe');
    expect(form.get('language')).toBe('te');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('leaves the language to the model when none is given', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ text: 'hello' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await transcribeAudio({ data: audio, mimeType: 'audio/mp4' });

    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get('language')).toBeNull();
  });

  it('reports an upstream failure as a provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    await expect(transcribeAudio({ data: audio, mimeType: 'audio/webm' })).rejects.toMatchObject({
      status: 502,
      upstream: 500,
    });
  });

  it('passes an upstream rate limit through as 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('slow down', { status: 429 })),
    );
    await expect(transcribeAudio({ data: audio, mimeType: 'audio/webm' })).rejects.toMatchObject({
      status: 429,
    });
  });

  it('reports an unreachable provider as a provider error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    );
    await expect(transcribeAudio({ data: audio, mimeType: 'audio/webm' })).rejects.toBeInstanceOf(
      AssistantProviderError,
    );
  });

  it('refuses when no key is configured', async () => {
    envState.OPENAI_API_KEY = undefined;
    await expect(transcribeAudio({ data: audio, mimeType: 'audio/webm' })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('caps how many voice requests one user can make per hour', () => {
    const user = `voice-budget-${Date.now()}`;
    let allowed = 0;
    for (let i = 0; i < 500; i += 1) if (consumeTranscribeBudget(user)) allowed += 1;
    expect(allowed).toBe(400);
    expect(consumeTranscribeBudget('another-user')).toBe(true);
  });
});
