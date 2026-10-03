import type { ChatMessageDTO, MessagePage } from './chatTypes';

export const messagesKey = (conversationId: string) => ['chat', 'messages', conversationId] as const;

/** Add or replace a message in the cached page (dedupes by id; keeps oldest-first order). */
export function upsertMessage(page: MessagePage | undefined, message: ChatMessageDTO): MessagePage | undefined {
  if (!page) return page;
  const idx = page.data.findIndex((m) => m.id === message.id);
  if (idx >= 0) {
    const data = page.data.slice();
    data[idx] = message;
    return { ...page, data };
  }
  return { ...page, data: [...page.data, message] };
}
