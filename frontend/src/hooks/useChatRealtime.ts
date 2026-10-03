import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SocketEvents } from '@hospital-erp/shared';
import { useAuthStore } from '../stores/authStore';
import { getSocket } from './usePresence';
import { messagesKey, upsertMessage } from '../components/chat/chatCache';
import type { ChatMessageDTO, MessagePage } from '../components/chat/chatTypes';

/**
 * Keeps chat data live app-wide (mounted once in the app shell): new, edited and
 * deleted messages update any cached thread, and the sidebar unread badge and
 * conversation list refresh whichever page the user is on.
 */
export function useChatRealtime(): void {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let off: (() => void) | undefined;

    void getSocket().then((s) => {
      if (cancelled || !s) return;

      const refreshLists = () => {
        void queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
        void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      };
      const onMessage = (m: ChatMessageDTO) => {
        queryClient.setQueryData<MessagePage>(messagesKey(m.conversationId), (cur) => upsertMessage(cur, m));
        refreshLists();
      };
      const onUpdated = (m: ChatMessageDTO) => {
        queryClient.setQueryData<MessagePage>(messagesKey(m.conversationId), (cur) => upsertMessage(cur, m));
        refreshLists();
      };
      const onDeleted = (d: { id: string; conversationId: string; deletedAt: string }) => {
        queryClient.setQueryData<MessagePage>(messagesKey(d.conversationId), (cur) =>
          cur
            ? {
                ...cur,
                data: cur.data.map((m) =>
                  m.id === d.id ? { ...m, body: '', mentions: [], attachments: [], deletedAt: d.deletedAt } : m,
                ),
              }
            : cur,
        );
        refreshLists();
      };
      // A new group you were added to, or messages missed while offline.
      const onConversation = () => refreshLists();
      const onReconnect = () => {
        void queryClient.invalidateQueries({ queryKey: ['chat'] });
      };

      s.on(SocketEvents.CHAT_MESSAGE, onMessage);
      s.on(SocketEvents.CHAT_MESSAGE_UPDATED, onUpdated);
      s.on(SocketEvents.CHAT_MESSAGE_DELETED, onDeleted);
      s.on(SocketEvents.CHAT_CONVERSATION, onConversation);
      s.io.on('reconnect', onReconnect);
      off = () => {
        s.off(SocketEvents.CHAT_MESSAGE, onMessage);
        s.off(SocketEvents.CHAT_MESSAGE_UPDATED, onUpdated);
        s.off(SocketEvents.CHAT_MESSAGE_DELETED, onDeleted);
        s.off(SocketEvents.CHAT_CONVERSATION, onConversation);
        s.io.off('reconnect', onReconnect);
      };
    });

    return () => {
      cancelled = true;
      off?.();
    };
  }, [userId, queryClient]);
}
