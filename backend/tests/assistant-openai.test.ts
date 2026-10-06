import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/config/env', () => ({
  env: { OPENAI_API_KEY: 'sk-test', ASSISTANT_MODEL: 'gpt-5-mini', ASSISTANT_REASONING_EFFORT: 'low' },
}));
vi.mock('../src/utils/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { generate } from '../src/services/assistant/openai';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const ok = (message: unknown) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: 'stop' }] }) });
const tools = [{ name: 'list_records', description: 'list', parameters: { type: 'OBJECT', properties: { q: { type: 'STRING' } }, required: [] } }];

describe('openai provider', () => {
  it('translates history, lower-cases schema types and pairs tool results with call ids', async () => {
    fetchMock.mockResolvedValue(ok({ content: 'done' }));
    await generate({
      system: 'sys',
      tools,
      contents: [
        { role: 'user', parts: [{ text: 'show vendors' }, { inlineData: { mimeType: 'image/png', data: 'AAA' } }] },
        { role: 'model', parts: [{ functionCall: { name: 'list_records', args: { q: 'abc' } } }] },
        { role: 'user', parts: [{ functionResponse: { name: 'list_records', response: { total: 1 } } }] },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('gpt-5-mini');
    expect(body.reasoning_effort).toBe('low');
    expect(body.tools[0].function.parameters.type).toBe('object');
    expect(body.tools[0].function.parameters.properties.q.type).toBe('string');
    const [sys, user, assistant, tool] = body.messages;
    expect(sys).toEqual({ role: 'system', content: 'sys' });
    expect(user.content[1].image_url.url).toBe('data:image/png;base64,AAA');
    expect(assistant.tool_calls[0].function).toEqual({ name: 'list_records', arguments: '{"q":"abc"}' });
    expect(tool).toEqual({ role: 'tool', tool_call_id: assistant.tool_calls[0].id, content: '{"total":1}' });
  });

  it('returns text and function calls in the neutral format', async () => {
    fetchMock.mockResolvedValue(
      ok({ content: 'ok', tool_calls: [{ id: 'x', type: 'function', function: { name: 'list_records', arguments: '{"q":"cement"}' } }] }),
    );
    const out = await generate({ system: 's', tools, contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    expect(out.role).toBe('model');
    expect(out.parts).toEqual([{ text: 'ok' }, { functionCall: { name: 'list_records', args: { q: 'cement' } } }]);
  });

  it('tolerates malformed tool arguments and reports provider errors', async () => {
    fetchMock.mockResolvedValueOnce(ok({ tool_calls: [{ id: 'x', type: 'function', function: { name: 'list_records', arguments: '{bad' } }] }));
    const out = await generate({ system: 's', tools, contents: [{ role: 'user', parts: [{ text: 'hi' }] }] });
    expect(out.parts[0].functionCall?.args).toEqual({});

    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, text: async () => '{"error":{"code":"insufficient_quota"}}' });
    await expect(generate({ system: 's', tools, contents: [{ role: 'user', parts: [{ text: 'hi' }] }] })).rejects.toMatchObject({ status: 429 });
  });
});
