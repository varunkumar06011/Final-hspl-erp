export interface ChatUser {
  id: string;
  name: string;
  role: string;
}

export interface ChatMention {
  id: string;
  name: string;
}

export interface ChatAttachmentDTO {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  fileType: 'IMAGE' | 'DOCUMENT';
}

export interface ChatReplyPreview {
  id: string;
  senderName: string;
  deleted: boolean;
  body: string;
  attachmentName: string | null;
}

export interface ChatMessageDTO {
  id: string;
  conversationId: string;
  sender: ChatUser;
  body: string;
  mentions: ChatMention[];
  attachments: ChatAttachmentDTO[];
  replyTo: ChatReplyPreview | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatConversationDTO {
  id: string;
  type: 'GENERAL' | 'DIRECT' | 'GROUP';
  name: string;
  memberCount: number | null;
  members?: ChatUser[];
  directUser: ChatUser | null;
  lastMessageAt: string;
  lastMessage: { senderName: string; senderId: string; deleted: boolean; preview: string } | null;
  unread: number;
}

export interface MessagePage {
  data: ChatMessageDTO[];
  hasMore: boolean;
}

export const CHAT_MAX_FILES = 5;
export const CHAT_MAX_FILE_MB = 25;
