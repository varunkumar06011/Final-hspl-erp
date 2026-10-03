/**
 * Internal chat — route rules (Prisma, auth, push and sockets are mocked; no database needed).
 *  - a private conversation is invisible to people who are not in it
 *  - only the sender edits; the sender or an admin deletes
 *  - tagging notifies the tagged people (in-app + push); untagged members get push only in DM/groups
 *  - a reply target must be a message of the same conversation
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import supertest from 'supertest';

const PROJECT = '00000000-0000-0000-0000-00000000000a';
const ALICE = '10000000-0000-0000-0000-000000000001';
const BOB = '10000000-0000-0000-0000-000000000002';
const CAROL = '10000000-0000-0000-0000-000000000003';
const ADMIN = '10000000-0000-0000-0000-0000000000ad';
const CONV = '20000000-0000-0000-0000-000000000001';
const MSG = '30000000-0000-0000-0000-000000000001';
const OTHER_MSG = '30000000-0000-0000-0000-000000000002';

const USERS: Record<string, { id: string; name: string; role: string }> = {
  [ALICE]: { id: ALICE, name: 'Alice', role: 'SUPERVISOR' },
  [BOB]: { id: BOB, name: 'Bob', role: 'ACCOUNTANT' },
  [CAROL]: { id: CAROL, name: 'Carol', role: 'SUPERVISOR' },
  [ADMIN]: { id: ADMIN, name: 'Root', role: 'ADMIN' },
};

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  conversation: null as Row | null,
  members: [] as string[],
  messages: new Map<string, Row>(),
  created: [] as Row[],
  notifications: [] as Row[],
}));

const notifyUsers = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('../src/middleware/auth', () => ({
  authMiddleware: (req: Row, res: Row, next: () => void) => {
    const id = req.headers['x-user'] as string;
    req.user = { ...USERS[id], projectId: PROJECT, isActive: true };
    next();
  },
  requireProjectId: (req: Row) => req.user.projectId,
}));
vi.mock('../src/services/push.service', () => ({ notifyUsers }));
vi.mock('../src/services/project.service', () => ({ projectTitlePrefix: async () => '' }));
vi.mock('../src/services/storage.service', () => ({
  getStorageService: () => ({ upload: vi.fn(), deleteFile: vi.fn(async () => {}) }),
  serveFile: vi.fn(),
}));
vi.mock('../src/socket', () => ({
  userIdsViewingChat: async () => new Set<string>(),
  emitToProject: vi.fn(),
  emitToUsers: vi.fn(),
}));

vi.mock('../src/config/prisma', () => {
  const prisma: Row = {
    chatConversation: {
      findFirst: vi.fn(async ({ where }: Row) =>
        state.conversation && where.id === state.conversation.id && where.projectId === state.conversation.projectId
          ? state.conversation
          : null
      ),
      update: vi.fn(async () => state.conversation),
    },
    chatMember: {
      findUnique: vi.fn(async ({ where }: Row) =>
        state.members.includes(where.conversationId_userId.userId) ? { id: 'm' } : null
      ),
      findMany: vi.fn(async ({ where }: Row = {}) =>
        state.members.filter((id) => id !== where?.userId?.not).map((userId) => ({ userId }))
      ),
      upsert: vi.fn(async () => ({})),
    },
    chatMessage: {
      findUnique: vi.fn(async ({ where }: Row) => state.messages.get(where.id) ?? null),
      findFirst: vi.fn(async ({ where }: Row) => {
        const m = state.messages.get(where.id);
        return m && m.conversationId === where.conversationId ? { id: m.id } : null;
      }),
      create: vi.fn(async ({ data }: Row) => {
        const row = {
          id: 'new-msg',
          createdAt: new Date(),
          editedAt: null,
          deletedAt: null,
          sender: USERS[data.senderId],
          attachments: [],
          replyTo: null,
          ...data,
        };
        delete row.attachments;
        row.attachments = [];
        state.created.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: Row) => {
        const row = { ...state.messages.get(where.id), ...data };
        row.sender = USERS[row.senderId];
        row.attachments = [];
        row.replyTo = null;
        state.messages.set(where.id, row);
        return row;
      }),
    },
    chatAttachment: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    user: {
      findMany: vi.fn(async ({ where }: Row) =>
        (where.id.in ? (where.id.in as string[]) : Object.keys(USERS).filter((id) => id !== where.id.not))
          .filter((id) => USERS[id] && (!where.chatMemberships || state.members.includes(id)))
          .map((id) => ({ id, name: USERS[id].name }))
      ),
    },
    appNotification: {
      createMany: vi.fn(async ({ data }: Row) => {
        state.notifications.push(...data);
        return { count: data.length };
      }),
    },
    $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg))),
  };
  return { prisma };
});

import chatRoutes from '../src/routes/chat.routes';

const app = express();
app.use(express.json());
app.use('/chat', chatRoutes);
app.use((err: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: err.message }));
const api = supertest(app);

function setConversation(type: 'DIRECT' | 'GROUP' | 'GENERAL', members: string[]) {
  state.conversation = { id: CONV, projectId: PROJECT, type, name: type === 'GROUP' ? 'Site team' : null };
  state.members = members;
}

function seedMessage(id: string, senderId: string, extra: Row = {}) {
  state.messages.set(id, {
    id,
    conversationId: CONV,
    senderId,
    body: 'hello',
    mentions: [],
    createdAt: new Date(),
    editedAt: null,
    deletedAt: null,
    sender: USERS[senderId],
    attachments: [],
    replyTo: null,
    ...extra,
  });
}

beforeEach(() => {
  state.conversation = null;
  state.members = [];
  state.messages.clear();
  state.created = [];
  state.notifications = [];
  notifyUsers.mockClear();
});

describe('conversation access', () => {
  it('hides a direct chat from someone who is not in it', async () => {
    setConversation('DIRECT', [ALICE, BOB]);
    const res = await api.get(`/chat/conversations/${CONV}/messages`).set('x-user', CAROL);
    expect(res.status).toBe(404);
  });

  it('lets anyone read and post in the open General room', async () => {
    setConversation('GENERAL', []);
    const res = await api.post(`/chat/conversations/${CONV}/messages`).set('x-user', CAROL).field('body', 'hi all');
    expect(res.status).toBe(201);
    expect(res.body.data.body).toBe('hi all');
  });

  it('does not match a conversation from another project', async () => {
    setConversation('GENERAL', []);
    state.conversation!.projectId = '00000000-0000-0000-0000-00000000000b';
    const res = await api.get(`/chat/conversations/${CONV}/messages`).set('x-user', ALICE);
    expect(res.status).toBe(404);
  });
});

describe('sending', () => {
  it('rejects an empty message with no files', async () => {
    setConversation('DIRECT', [ALICE, BOB]);
    const res = await api.post(`/chat/conversations/${CONV}/messages`).set('x-user', ALICE).field('body', '   ');
    expect(res.status).toBe(400);
  });

  it('rejects a disallowed file type', async () => {
    setConversation('DIRECT', [ALICE, BOB]);
    const res = await api
      .post(`/chat/conversations/${CONV}/messages`)
      .set('x-user', ALICE)
      .attach('files', Buffer.from('MZ'), { filename: 'run.exe', contentType: 'application/octet-stream' });
    expect(res.status).toBe(400);
  });

  it('rejects a reply to a message from a different conversation', async () => {
    setConversation('DIRECT', [ALICE, BOB]);
    seedMessage(OTHER_MSG, BOB, { conversationId: 'some-other-conversation' });
    const res = await api
      .post(`/chat/conversations/${CONV}/messages`)
      .set('x-user', ALICE)
      .field('body', 'replying')
      .field('replyToId', OTHER_MSG);
    expect(res.status).toBe(400);
  });

  it('accepts a reply to a message in the same conversation', async () => {
    setConversation('DIRECT', [ALICE, BOB]);
    seedMessage(MSG, BOB);
    const res = await api
      .post(`/chat/conversations/${CONV}/messages`)
      .set('x-user', ALICE)
      .field('body', 'replying')
      .field('replyToId', MSG);
    expect(res.status).toBe(201);
    expect(state.created[0].replyToId).toBe(MSG);
  });
});

describe('tagging and notifications', () => {
  it('notifies only the tagged person in General (in-app + push)', async () => {
    setConversation('GENERAL', []);
    const res = await api
      .post(`/chat/conversations/${CONV}/messages`)
      .set('x-user', ALICE)
      .field('body', 'hey @Bob please check')
      .field('mentionIds', JSON.stringify([BOB]));
    expect(res.status).toBe(201);
    expect(res.body.data.mentions).toEqual([{ id: BOB, name: 'Bob' }]);
    await vi.waitFor(() => expect(notifyUsers).toHaveBeenCalledTimes(1));
    expect(state.notifications.map((n) => n.userId)).toEqual([BOB]);
    expect(state.notifications[0].type).toBe('CHAT_MENTION');
    expect(notifyUsers.mock.calls[0][0]).toEqual([BOB]);
  });

  it('ignores a tag of someone who is not in a private group', async () => {
    setConversation('GROUP', [ALICE, BOB]);
    await api
      .post(`/chat/conversations/${CONV}/messages`)
      .set('x-user', ALICE)
      .field('body', '@Carol look')
      .field('mentionIds', JSON.stringify([CAROL]));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.notifications).toEqual([]);
  });

  it('never notifies the sender, even when they tag themselves', async () => {
    setConversation('GENERAL', []);
    await api
      .post(`/chat/conversations/${CONV}/messages`)
      .set('x-user', ALICE)
      .field('body', '@Alice note to self')
      .field('mentionIds', JSON.stringify([ALICE]));
    await new Promise((r) => setTimeout(r, 20));
    expect(state.notifications).toEqual([]);
  });

  it('pushes untagged members of a direct chat but not General', async () => {
    setConversation('DIRECT', [ALICE, BOB]);
    await api.post(`/chat/conversations/${CONV}/messages`).set('x-user', ALICE).field('body', 'ping');
    await vi.waitFor(() => expect(notifyUsers).toHaveBeenCalledTimes(1));
    expect(notifyUsers.mock.calls[0][0]).toEqual([BOB]);

    notifyUsers.mockClear();
    setConversation('GENERAL', []);
    await api.post(`/chat/conversations/${CONV}/messages`).set('x-user', ALICE).field('body', 'ping');
    await new Promise((r) => setTimeout(r, 20));
    expect(notifyUsers).not.toHaveBeenCalled();
  });
});

describe('@all', () => {
  const post = (user: string, body: string) =>
    api.post(`/chat/conversations/${CONV}/messages`).set('x-user', user).field('body', body);

  it('notifies every active user in General except the sender', async () => {
    setConversation('GENERAL', []);
    const res = await post(ALICE, 'meeting at 5 @all');
    expect(res.status).toBe(201);
    expect(res.body.data.mentions).toContainEqual({ id: 'all', name: 'all' });
    await vi.waitFor(() => expect(notifyUsers).toHaveBeenCalledTimes(1));
    expect([...notifyUsers.mock.calls[0][0]].sort()).toEqual([ADMIN, BOB, CAROL].sort());
    expect(state.notifications.every((n) => n.type === 'CHAT_MENTION')).toBe(true);
    expect(state.notifications.map((n) => n.userId)).not.toContain(ALICE);
  });

  it('only reaches the members of a group', async () => {
    setConversation('GROUP', [ALICE, BOB]);
    await post(ALICE, '@all heads up');
    await vi.waitFor(() => expect(notifyUsers).toHaveBeenCalledTimes(1));
    expect(notifyUsers.mock.calls[0][0]).toEqual([BOB]);
  });

  it('does not treat an address like me@allen.com as @all', async () => {
    setConversation('GENERAL', []);
    await post(ALICE, 'mail me@allen.com');
    await new Promise((r) => setTimeout(r, 20));
    expect(state.notifications).toEqual([]);
  });

  it('notifies everyone once when an edit first adds @all', async () => {
    setConversation('GENERAL', []);
    seedMessage(MSG, ALICE);
    await api.patch(`/chat/messages/${MSG}`).set('x-user', ALICE).send({ body: 'hello @all' });
    expect(state.notifications).toHaveLength(3);
    state.notifications = [];
    await api.patch(`/chat/messages/${MSG}`).set('x-user', ALICE).send({ body: 'hello again @all' });
    expect(state.notifications).toHaveLength(0);
  });
});

describe('edit and delete', () => {
  beforeEach(() => {
    setConversation('GROUP', [ALICE, BOB, ADMIN]);
    seedMessage(MSG, ALICE);
  });

  it('lets the sender edit and stamps editedAt', async () => {
    const res = await api.patch(`/chat/messages/${MSG}`).set('x-user', ALICE).send({ body: 'fixed' });
    expect(res.status).toBe(200);
    expect(res.body.data.body).toBe('fixed');
    expect(res.body.data.editedAt).toBeTruthy();
  });

  it('refuses an edit by someone else, even an admin', async () => {
    expect((await api.patch(`/chat/messages/${MSG}`).set('x-user', BOB).send({ body: 'x' })).status).toBe(403);
    expect((await api.patch(`/chat/messages/${MSG}`).set('x-user', ADMIN).send({ body: 'x' })).status).toBe(403);
  });

  it('only notifies people newly tagged by an edit', async () => {
    seedMessage(MSG, ALICE, { mentions: [{ id: BOB, name: 'Bob' }] });
    await api
      .patch(`/chat/messages/${MSG}`)
      .set('x-user', ALICE)
      .send({ body: '@Bob @Root see this', mentionIds: [BOB, ADMIN] });
    expect(state.notifications.map((n) => n.userId)).toEqual([ADMIN]);
  });

  it('refuses deletion by a non-sender non-admin', async () => {
    const res = await api.delete(`/chat/messages/${MSG}`).set('x-user', BOB);
    expect(res.status).toBe(403);
    expect(state.messages.get(MSG)!.deletedAt).toBeNull();
  });

  it('lets the sender delete, wiping the text but keeping the row', async () => {
    const res = await api.delete(`/chat/messages/${MSG}`).set('x-user', ALICE);
    expect(res.status).toBe(200);
    const row = state.messages.get(MSG)!;
    expect(row.deletedAt).toBeTruthy();
    expect(row.body).toBe('');
  });

  it('lets an admin delete someone else’s message', async () => {
    const res = await api.delete(`/chat/messages/${MSG}`).set('x-user', ADMIN);
    expect(res.status).toBe(200);
    expect(state.messages.get(MSG)!.deletedAt).toBeTruthy();
  });

  it('refuses editing a deleted message', async () => {
    await api.delete(`/chat/messages/${MSG}`).set('x-user', ALICE);
    const res = await api.patch(`/chat/messages/${MSG}`).set('x-user', ALICE).send({ body: 'again' });
    expect(res.status).toBe(400);
  });

  it('hides messages of conversations the user is not part of', async () => {
    setConversation('GROUP', [ALICE, BOB]);
    expect((await api.delete(`/chat/messages/${MSG}`).set('x-user', ADMIN)).status).toBe(404);
  });
});
