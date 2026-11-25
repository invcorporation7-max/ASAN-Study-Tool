import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { db } from './index.ts';
import {
  getLocalStore,
  isDbUnavailableError,
  nextSeq,
  persistLocalStore,
} from './localStore.ts';
import {
  forumAttachments,
  forumAttempts,
  forumMembers,
  forumPosts,
  forumReplies,
  forumReplyVotes,
  forumRooms,
  notifications,
  pointTransactions,
  userMessages,
  users,
} from './schema.ts';
import { awardPoints, getPointRewardsConfig } from './users.ts';
import { richHtmlToPlainText, sanitizeRichHtmlServer } from '../lib/htmlSanitizer.ts';
import type {
  ForumAnswerKey,
  ForumAttachmentItem,
  ForumAttemptItem,
  ForumAttemptPayload,
  ForumAuthorSummary,
  ForumPostItem,
  ForumQuestionSpec,
  ForumReplyItem,
  ForumRoomItem,
  ForumRoomMemberSummary,
} from '../types.ts';

function toAuthorSummary(u?: {
  id: number;
  displayName?: string | null;
  username?: string | null;
  shortUid?: string | null;
  photoUrl?: string | null;
  plan?: string | null;
  role?: string | null;
  contributorApproved?: boolean | null;
}): ForumAuthorSummary {
  return {
    id: u?.id || 0,
    displayName: u?.displayName || 'Student',
    username: u?.username || `user${u?.id || 0}`,
    shortUid: u?.shortUid || '',
    photoUrl: u?.photoUrl || '',
    plan: u?.plan || 'basic',
    role: u?.role || 'user',
    contributorApproved: Boolean(u?.contributorApproved),
  };
}

function toAttachmentItem(att: {
  id: number;
  postId: number | null;
  replyId: number | null;
  messageId: number | null;
  uploaderId: number;
  fileName: string;
  storedFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
  kind: string;
  createdAt: Date | string;
}): ForumAttachmentItem {
  return {
    id: att.id,
    postId: att.postId,
    replyId: att.replyId,
    messageId: att.messageId,
    uploaderId: att.uploaderId,
    fileName: att.fileName,
    storedFileName: att.storedFileName,
    mimeType: att.mimeType,
    fileSizeBytes: Number(att.fileSizeBytes || 0),
    pageCount: Number(att.pageCount || 1),
    kind: att.kind === 'pdf' ? 'pdf' : 'image',
    url: `/api/forum/attachments/${att.id}/file`,
    createdAt: att.createdAt instanceof Date ? att.createdAt.toISOString() : String(att.createdAt),
  };
}

function hasAnswerKeyConfigured(key: ForumAnswerKey | null | undefined): boolean {
  if (!key) return false;
  if (key.selectedOption) return true;
  if (Array.isArray(key.selectedOptions) && key.selectedOptions.length > 0) return true;
  if (typeof key.integerValue === 'number' && Number.isFinite(key.integerValue)) return true;
  if (typeof key.doubleValue === 'number' && Number.isFinite(key.doubleValue)) return true;
  if (key.matrixMap && Object.values(key.matrixMap).some((cols) => Array.isArray(cols) && cols.length > 0)) {
    return true;
  }
  if (typeof key.subjectiveAnswer === 'string' && key.subjectiveAnswer.trim().length > 0) return true;
  return false;
}

export function gradeQuestionAttempt(
  spec: ForumQuestionSpec | null,
  answerKey: ForumAnswerKey | null,
  payload: ForumAttemptPayload
): { isCorrect: boolean | null; scoreNote: string } {
  if (!spec) {
    return { isCorrect: null, scoreNote: 'Response recorded.' };
  }
  const effectiveType =
    spec.fieldType === 'comprehension'
      ? spec.subQuestionType || 'mcq_single'
      : spec.fieldType;

  if (!answerKey || !hasAnswerKeyConfigured(answerKey)) {
    return {
      isCorrect: null,
      scoreNote: 'Attempt recorded (open/unkeyed question — awaiting author review).',
    };
  }

  if (effectiveType === 'mcq_single' || effectiveType === 'assertion_reason') {
    const expected = String(answerKey.selectedOption || '').trim().toUpperCase();
    const got = String(payload.selectedOption || '').trim().toUpperCase();
    if (!got) throw new Error('Select an option before submitting your attempt.');
    const correct = expected === got;
    return {
      isCorrect: correct,
      scoreNote: correct
        ? `Correct option (${expected})`
        : `Submitted (${got}) · Official answer: ${expected}`,
    };
  }

  if (effectiveType === 'mcq_multi') {
    const expectedSet = new Set((answerKey.selectedOptions || []).map((x) => x.trim().toUpperCase()));
    const gotSet = new Set((payload.selectedOptions || []).map((x) => x.trim().toUpperCase()));
    if (gotSet.size === 0) throw new Error('Select one or more options before submitting.');
    const exactMatch =
      expectedSet.size === gotSet.size && [...expectedSet].every((x) => gotSet.has(x));
    const hasWrong = [...gotSet].some((x) => !expectedSet.has(x));
    const partialMatches = [...gotSet].filter((x) => expectedSet.has(x)).length;
    if (exactMatch) {
      return {
        isCorrect: true,
        scoreNote: `Exact multi-select match (${[...expectedSet].sort().join(', ')})`,
      };
    }
    if (!hasWrong && partialMatches > 0) {
      return {
        isCorrect: false,
        scoreNote: `Partial match (${partialMatches}/${expectedSet.size} correct options selected, no wrong option). Official: ${[...expectedSet].sort().join(', ')}`,
      };
    }
    return {
      isCorrect: false,
      scoreNote: `Submitted [${[...gotSet].sort().join(', ')}] · Official: [${[...expectedSet].sort().join(', ')}]`,
    };
  }

  if (effectiveType === 'integer') {
    const expected = Number(answerKey.integerValue);
    const parsed = Number(String(payload.integerValue ?? '').trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      throw new Error('Enter a valid integer answer.');
    }
    const min = typeof spec.integerMin === 'number' ? spec.integerMin : -999999;
    const max = typeof spec.integerMax === 'number' ? spec.integerMax : 999999;
    if (parsed < min || parsed > max) {
      throw new Error(`Integer must be between ${min} and ${max}.`);
    }
    const correct = parsed === Math.round(expected);
    return {
      isCorrect: correct,
      scoreNote: correct
        ? `Correct integer (${expected})`
        : `Submitted ${parsed} · Official integer: ${expected}`,
    };
  }

  if (effectiveType === 'double') {
    const expected = Number(answerKey.doubleValue);
    const parsed = Number(String(payload.doubleValue ?? '').trim());
    if (!Number.isFinite(parsed)) {
      throw new Error('Enter a valid numerical / decimal answer.');
    }
    const tol =
      typeof spec.numericTolerance === 'number' && spec.numericTolerance >= 0
        ? spec.numericTolerance
        : 0.01;
    const correct = Math.abs(parsed - expected) <= tol;
    return {
      isCorrect: correct,
      scoreNote: correct
        ? `Within tolerance (${expected} ± ${tol}${spec.unit ? ` ${spec.unit}` : ''})`
        : `Submitted ${parsed} · Official: ${expected} (±${tol}${spec.unit ? ` ${spec.unit}` : ''})`,
    };
  }

  if (effectiveType === 'matrix_match') {
    const expectedMap = answerKey.matrixMap || {};
    const gotMap = payload.matrixMap || {};
    const rows = Object.keys(expectedMap);
    if (rows.length === 0) {
      return { isCorrect: null, scoreNote: 'Matrix attempt recorded.' };
    }
    let matchedRows = 0;
    for (const rowId of rows) {
      const expCols = new Set((expectedMap[rowId] || []).map((c) => c.trim()));
      const gotCols = new Set((gotMap[rowId] || []).map((c) => c.trim()));
      const ok = expCols.size === gotCols.size && [...expCols].every((c) => gotCols.has(c));
      if (ok) matchedRows += 1;
    }
    const allMatch = matchedRows === rows.length;
    return {
      isCorrect: allMatch,
      scoreNote: allMatch
        ? `All ${rows.length} matrix rows matched accurately.`
        : `Matched ${matchedRows}/${rows.length} matrix rows accurately.`,
    };
  }

  return {
    isCorrect: null,
    scoreNote: 'Subjective attempt submitted — compare with peer solutions & official notes.',
  };
}

function projectPostForViewer(params: {
  post: {
    id: number;
    roomId: number;
    authorId: number;
    postKind: string;
    title: string;
    contentHtml: string;
    contentText: string;
    subject: string;
    examBoard: string;
    questionSpec: Record<string, unknown> | null;
    answerKey: Record<string, unknown> | null;
    officialExplanationHtml: string;
    isSolved: boolean;
    acceptedReplyId: number | null;
    createdAt: Date | string;
    updatedAt: Date | string;
  };
  viewerUserId: number;
  author: ForumAuthorSummary;
  attachments: ForumAttachmentItem[];
  replyCount: number;
  attemptCount: number;
  myAttempt: ForumAttemptItem | null;
  replies?: ForumReplyItem[];
}): ForumPostItem {
  const spec = (params.post.questionSpec as ForumQuestionSpec | null) || null;
  const rawKey = (params.post.answerKey as ForumAnswerKey | null) || null;
  const isAuthor = params.post.authorId === params.viewerUserId;
  const canRevealKey =
    isAuthor ||
    params.post.isSolved ||
    Boolean(params.myAttempt) ||
    spec?.revealMode === 'immediate';

  return {
    id: params.post.id,
    roomId: params.post.roomId,
    authorId: params.post.authorId,
    author: params.author,
    postKind: params.post.postKind === 'message' ? 'message' : 'question',
    title: params.post.title,
    contentHtml: params.post.contentHtml,
    contentText: params.post.contentText,
    subject: params.post.subject,
    examBoard: params.post.examBoard,
    questionSpec: spec
      ? { ...spec, hasOfficialKey: hasAnswerKeyConfigured(rawKey) }
      : null,
    answerKey: canRevealKey ? rawKey : null,
    officialExplanationHtml: canRevealKey ? params.post.officialExplanationHtml || '' : '',
    attachments: params.attachments,
    isSolved: Boolean(params.post.isSolved),
    acceptedReplyId: params.post.acceptedReplyId ?? null,
    replyCount: params.replyCount,
    attemptCount: params.attemptCount,
    myAttempt: params.myAttempt,
    replies: params.replies,
    createdAt:
      params.post.createdAt instanceof Date
        ? params.post.createdAt.toISOString()
        : String(params.post.createdAt),
    updatedAt:
      params.post.updatedAt instanceof Date
        ? params.post.updatedAt.toISOString()
        : String(params.post.updatedAt),
  };
}

export async function ensureDefaultGlobalForumRoom(actorUserId: number): Promise<number> {
  try {
    const existing = await db
      .select()
      .from(forumRooms)
      .where(eq(forumRooms.roomType, 'global_qa'))
      .limit(1);
    if (existing.length > 0) return existing[0].id;
    const [created] = await db
      .insert(forumRooms)
      .values({
        roomType: 'global_qa',
        title: 'Global Q&A & Competitive Arena',
        description:
          'Ask single competitive questions (JEE, NEET, ISC, CBSE, CUET), collaborate on peer solutions, and earn points for satisfactory answers.',
        subject: 'All Subjects',
        dmKey: '',
        createdById: actorUserId,
      })
      .returning();
    return created.id;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const existing = store.forumRooms.find((r) => r.roomType === 'global_qa');
    if (existing) return existing.id;
    const now = new Date();
    const created = {
      id: nextSeq('forumRooms'),
      roomType: 'global_qa',
      title: 'Global Q&A & Competitive Arena',
      description:
        'Ask single competitive questions (JEE, NEET, ISC, CBSE, CUET), collaborate on peer solutions, and earn points for satisfactory answers.',
      subject: 'All Subjects',
      dmKey: '',
      createdById: actorUserId,
      createdAt: now,
      updatedAt: now,
    };
    store.forumRooms.push(created);
    persistLocalStore();
    return created.id;
  }
}

export async function getUserSubscribedForumRoomIds(userId: number): Promise<number[]> {
  try {
    const globalId = await ensureDefaultGlobalForumRoom(userId);
    const memberships = await db
      .select({ roomId: forumMembers.roomId })
      .from(forumMembers)
      .where(eq(forumMembers.userId, userId));
    return Array.from(new Set([globalId, ...memberships.map((m) => m.roomId)]));
  } catch (error) {
    if (!isDbUnavailableError(error)) return [];
    const globalId = await ensureDefaultGlobalForumRoom(userId);
    const store = getLocalStore();
    const ids = store.forumMembers.filter((m) => m.userId === userId).map((m) => m.roomId);
    return Array.from(new Set([globalId, ...ids]));
  }
}

export async function canUserAccessForumRoom(roomId: number, userId: number): Promise<{
  allowed: boolean;
  room: typeof forumRooms.$inferSelect | null;
}> {
  try {
    const [room] = await db.select().from(forumRooms).where(eq(forumRooms.id, roomId)).limit(1);
    if (!room) return { allowed: false, room: null };
    if (room.roomType === 'global_qa') return { allowed: true, room };
    const [member] = await db
      .select()
      .from(forumMembers)
      .where(and(eq(forumMembers.roomId, roomId), eq(forumMembers.userId, userId)))
      .limit(1);
    return { allowed: Boolean(member), room };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const room = store.forumRooms.find((r) => r.id === roomId) || null;
    if (!room) return { allowed: false, room: null };
    if (room.roomType === 'global_qa') return { allowed: true, room };
    const member = store.forumMembers.find((m) => m.roomId === roomId && m.userId === userId);
    return { allowed: Boolean(member), room };
  }
}

export async function listUserForumRooms(userId: number): Promise<ForumRoomItem[]> {
  await ensureDefaultGlobalForumRoom(userId);
  try {
    const myMemberships = await db
      .select()
      .from(forumMembers)
      .where(eq(forumMembers.userId, userId));
    const myRoomIds = myMemberships.map((m) => m.roomId);

    const rooms =
      myRoomIds.length > 0
        ? await db
            .select()
            .from(forumRooms)
            .where(or(eq(forumRooms.roomType, 'global_qa'), inArray(forumRooms.id, myRoomIds)))
            .orderBy(desc(forumRooms.updatedAt))
        : await db
            .select()
            .from(forumRooms)
            .where(eq(forumRooms.roomType, 'global_qa'))
            .orderBy(desc(forumRooms.updatedAt));

    const allRoomIds = rooms.map((r) => r.id);
    const allMembers =
      allRoomIds.length > 0
        ? await db.select().from(forumMembers).where(inArray(forumMembers.roomId, allRoomIds))
        : [];
    const allPosts =
      allRoomIds.length > 0
        ? await db
            .select({
              id: forumPosts.id,
              roomId: forumPosts.roomId,
              title: forumPosts.title,
              contentText: forumPosts.contentText,
              createdAt: forumPosts.createdAt,
              updatedAt: forumPosts.updatedAt,
            })
            .from(forumPosts)
            .where(inArray(forumPosts.roomId, allRoomIds))
            .orderBy(desc(forumPosts.updatedAt))
        : [];

    const memberUserIds = Array.from(new Set(allMembers.map((m) => m.userId)));
    const userRows =
      memberUserIds.length > 0
        ? await db.select().from(users).where(inArray(users.id, memberUserIds))
        : [];
    const userMap = new Map(userRows.map((u) => [u.id, u]));

    return rooms.map((room) => {
      const roomMembers = allMembers.filter((m) => m.roomId === room.id);
      const myMem = roomMembers.find((m) => m.userId === userId);
      const roomPosts = allPosts.filter((p) => p.roomId === room.id);
      const latestPost = roomPosts[0];
      const unreadCount = myMem
        ? roomPosts.filter((p) => new Date(p.updatedAt).getTime() > new Date(myMem.lastReadAt).getTime())
            .length
        : 0;

      const memberSummaries: ForumRoomMemberSummary[] = roomMembers.map((m) => ({
        ...toAuthorSummary(userMap.get(m.userId)),
        memberRole: m.memberRole === 'owner' ? 'owner' : 'member',
        joinedAt: m.joinedAt instanceof Date ? m.joinedAt.toISOString() : String(m.joinedAt),
      }));

      let displayTitle = room.title;
      if (room.roomType === 'dm') {
        const peer = memberSummaries.find((m) => m.id !== userId) || memberSummaries[0];
        if (peer) {
          displayTitle = `${peer.displayName} (@${peer.username})`;
        }
      }

      return {
        id: room.id,
        roomType:
          room.roomType === 'global_qa' ? 'global_qa' : room.roomType === 'dm' ? 'dm' : 'group',
        title: displayTitle,
        description: room.description,
        subject: room.subject,
        dmKey: room.dmKey,
        createdById: room.createdById,
        memberCount: room.roomType === 'global_qa' ? 0 : roomMembers.length,
        unreadCount,
        lastMessagePreview: latestPost
          ? (latestPost.title || latestPost.contentText).slice(0, 90)
          : room.description,
        lastActivityAt: latestPost
          ? new Date(latestPost.updatedAt).toISOString()
          : new Date(room.updatedAt).toISOString(),
        members: memberSummaries,
        createdAt: new Date(room.createdAt).toISOString(),
        updatedAt: new Date(room.updatedAt).toISOString(),
      };
    });
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const myRoomIds = new Set(
      store.forumMembers.filter((m) => m.userId === userId).map((m) => m.roomId)
    );
    const rooms = store.forumRooms
      .filter((r) => r.roomType === 'global_qa' || myRoomIds.has(r.id))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    return rooms.map((room) => {
      const roomMembers = store.forumMembers.filter((m) => m.roomId === room.id);
      const myMem = roomMembers.find((m) => m.userId === userId);
      const roomPosts = store.forumPosts
        .filter((p) => p.roomId === room.id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      const latestPost = roomPosts[0];
      const unreadCount = myMem
        ? roomPosts.filter((p) => new Date(p.updatedAt).getTime() > new Date(myMem.lastReadAt).getTime())
            .length
        : 0;
      const memberSummaries: ForumRoomMemberSummary[] = roomMembers.map((m) => ({
        ...toAuthorSummary(store.users.find((u) => u.id === m.userId)),
        memberRole: m.memberRole === 'owner' ? 'owner' : 'member',
        joinedAt: new Date(m.joinedAt).toISOString(),
      }));
      let displayTitle = room.title;
      if (room.roomType === 'dm') {
        const peer = memberSummaries.find((m) => m.id !== userId) || memberSummaries[0];
        if (peer) displayTitle = `${peer.displayName} (@${peer.username})`;
      }
      return {
        id: room.id,
        roomType:
          room.roomType === 'global_qa' ? 'global_qa' : room.roomType === 'dm' ? 'dm' : 'group',
        title: displayTitle,
        description: room.description,
        subject: room.subject,
        dmKey: room.dmKey,
        createdById: room.createdById,
        memberCount: room.roomType === 'global_qa' ? 0 : roomMembers.length,
        unreadCount,
        lastMessagePreview: latestPost
          ? (latestPost.title || latestPost.contentText).slice(0, 90)
          : room.description,
        lastActivityAt: latestPost
          ? new Date(latestPost.updatedAt).toISOString()
          : new Date(room.updatedAt).toISOString(),
        members: memberSummaries,
        createdAt: new Date(room.createdAt).toISOString(),
        updatedAt: new Date(room.updatedAt).toISOString(),
      };
    });
  }
}

export async function createForumGroupRoom(params: {
  creatorId: number;
  title: string;
  description?: string;
  subject?: string;
  memberIds?: number[];
}): Promise<ForumRoomItem> {
  const cleanTitle = params.title.trim().slice(0, 120);
  if (!cleanTitle) throw new Error('Study group name is required.');
  const cleanDesc = (params.description || '').trim().slice(0, 400);
  const cleanSubject = (params.subject || 'General').trim().slice(0, 80);
  const uniqueMembers = Array.from(
    new Set([params.creatorId, ...(params.memberIds || []).map(Number).filter(Number.isFinite)])
  );

  try {
    const [room] = await db
      .insert(forumRooms)
      .values({
        roomType: 'group',
        title: cleanTitle,
        description: cleanDesc,
        subject: cleanSubject,
        dmKey: '',
        createdById: params.creatorId,
      })
      .returning();
    await db.insert(forumMembers).values(
      uniqueMembers.map((uid) => ({
        roomId: room.id,
        userId: uid,
        memberRole: uid === params.creatorId ? 'owner' : 'member',
      }))
    );
    const list = await listUserForumRooms(params.creatorId);
    const found = list.find((r) => r.id === room.id);
    if (!found) throw new Error('Failed to load created group.');
    return found;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const now = new Date();
    const room = {
      id: nextSeq('forumRooms'),
      roomType: 'group',
      title: cleanTitle,
      description: cleanDesc,
      subject: cleanSubject,
      dmKey: '',
      createdById: params.creatorId,
      createdAt: now,
      updatedAt: now,
    };
    store.forumRooms.push(room);
    for (const uid of uniqueMembers) {
      store.forumMembers.push({
        id: nextSeq('forumMembers'),
        roomId: room.id,
        userId: uid,
        memberRole: uid === params.creatorId ? 'owner' : 'member',
        lastReadAt: now,
        joinedAt: now,
      });
    }
    persistLocalStore();
    const list = await listUserForumRooms(params.creatorId);
    return list.find((r) => r.id === room.id)!;
  }
}

export async function addMembersToForumGroup(params: {
  roomId: number;
  actorId: number;
  memberIds: number[];
}): Promise<{ room: ForumRoomItem; addedUserIds: number[] }> {
  const access = await canUserAccessForumRoom(params.roomId, params.actorId);
  if (!access.allowed || !access.room) {
    throw new Error('Room not found or access denied.');
  }
  if (access.room.roomType !== 'group') {
    throw new Error('Members can only be added to Study Groups.');
  }
  const cleanIds = Array.from(new Set(params.memberIds.map(Number).filter(Number.isFinite)));
  if (cleanIds.length === 0) throw new Error('Select at least one member to add.');

  try {
    const existing = await db
      .select()
      .from(forumMembers)
      .where(eq(forumMembers.roomId, params.roomId));
    const existingSet = new Set(existing.map((m) => m.userId));
    const toAdd = cleanIds.filter((uid) => !existingSet.has(uid));
    if (toAdd.length > 0) {
      await db.insert(forumMembers).values(
        toAdd.map((uid) => ({
          roomId: params.roomId,
          userId: uid,
          memberRole: 'member',
        }))
      );
      await db
        .update(forumRooms)
        .set({ updatedAt: new Date() })
        .where(eq(forumRooms.id, params.roomId));
    }
    const list = await listUserForumRooms(params.actorId);
    return { room: list.find((r) => r.id === params.roomId)!, addedUserIds: toAdd };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const existingSet = new Set(
      store.forumMembers.filter((m) => m.roomId === params.roomId).map((m) => m.userId)
    );
    const toAdd = cleanIds.filter((uid) => !existingSet.has(uid));
    const now = new Date();
    for (const uid of toAdd) {
      store.forumMembers.push({
        id: nextSeq('forumMembers'),
        roomId: params.roomId,
        userId: uid,
        memberRole: 'member',
        lastReadAt: now,
        joinedAt: now,
      });
    }
    persistLocalStore();
    const list = await listUserForumRooms(params.actorId);
    return { room: list.find((r) => r.id === params.roomId)!, addedUserIds: toAdd };
  }
}

export async function getOrCreateDmRoom(params: {
  userId: number;
  targetUserId: number;
}): Promise<ForumRoomItem> {
  if (params.userId === params.targetUserId) {
    throw new Error('Select another registered student to start a 1-to-1 chat.');
  }
  const a = Math.min(params.userId, params.targetUserId);
  const b = Math.max(params.userId, params.targetUserId);
  const dmKey = `${a}:${b}`;

  try {
    const [target] = await db.select().from(users).where(eq(users.id, params.targetUserId)).limit(1);
    if (!target) throw new Error('Target student account not found.');

    const existing = await db
      .select()
      .from(forumRooms)
      .where(and(eq(forumRooms.roomType, 'dm'), eq(forumRooms.dmKey, dmKey)))
      .limit(1);

    let roomId: number;
    if (existing.length > 0) {
      roomId = existing[0].id;
    } else {
      const [created] = await db
        .insert(forumRooms)
        .values({
          roomType: 'dm',
          title: `Direct Chat`,
          description: 'Private 1-to-1 Study Chat',
          subject: 'Direct',
          dmKey,
          createdById: params.userId,
        })
        .returning();
      roomId = created.id;
      await db.insert(forumMembers).values([
        { roomId, userId: params.userId, memberRole: 'member' },
        { roomId, userId: params.targetUserId, memberRole: 'member' },
      ]);
    }

    const list = await listUserForumRooms(params.userId);
    return list.find((r) => r.id === roomId)!;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const target = store.users.find((u) => u.id === params.targetUserId);
    if (!target) throw new Error('Target student account not found.');
    let existing = store.forumRooms.find((r) => r.roomType === 'dm' && r.dmKey === dmKey);
    const now = new Date();
    if (!existing) {
      existing = {
        id: nextSeq('forumRooms'),
        roomType: 'dm',
        title: 'Direct Chat',
        description: 'Private 1-to-1 Study Chat',
        subject: 'Direct',
        dmKey,
        createdById: params.userId,
        createdAt: now,
        updatedAt: now,
      };
      store.forumRooms.push(existing);
      store.forumMembers.push(
        {
          id: nextSeq('forumMembers'),
          roomId: existing.id,
          userId: params.userId,
          memberRole: 'member',
          lastReadAt: now,
          joinedAt: now,
        },
        {
          id: nextSeq('forumMembers'),
          roomId: existing.id,
          userId: params.targetUserId,
          memberRole: 'member',
          lastReadAt: now,
          joinedAt: now,
        }
      );
      persistLocalStore();
    }
    const list = await listUserForumRooms(params.userId);
    return list.find((r) => r.id === existing!.id)!;
  }
}

export async function markForumRoomRead(roomId: number, userId: number): Promise<void> {
  try {
    await db
      .update(forumMembers)
      .set({ lastReadAt: new Date() })
      .where(and(eq(forumMembers.roomId, roomId), eq(forumMembers.userId, userId)));
  } catch (error) {
    if (!isDbUnavailableError(error)) return;
    const store = getLocalStore();
    const mem = store.forumMembers.find((m) => m.roomId === roomId && m.userId === userId);
    if (mem) {
      mem.lastReadAt = new Date();
      persistLocalStore();
    }
  }
}

export async function listForumRoomPosts(params: {
  roomId: number;
  userId: number;
  postKind?: string;
  examBoard?: string;
  subject?: string;
  solved?: string;
}): Promise<ForumPostItem[]> {
  const access = await canUserAccessForumRoom(params.roomId, params.userId);
  if (!access.allowed || !access.room) {
    throw new Error('Forum room not found or access denied.');
  }

  try {
    let posts = await db
      .select()
      .from(forumPosts)
      .where(eq(forumPosts.roomId, params.roomId))
      .orderBy(desc(forumPosts.updatedAt));

    if (params.postKind === 'question' || params.postKind === 'message') {
      posts = posts.filter((p) => p.postKind === params.postKind);
    }
    if (params.examBoard && params.examBoard !== 'All') {
      posts = posts.filter((p) => p.examBoard === params.examBoard);
    }
    if (params.subject && params.subject !== 'All') {
      posts = posts.filter((p) => p.subject.toLowerCase() === params.subject!.toLowerCase());
    }
    if (params.solved === 'solved') {
      posts = posts.filter((p) => p.isSolved);
    } else if (params.solved === 'unsolved') {
      posts = posts.filter((p) => !p.isSolved);
    }

    if (posts.length === 0) return [];
    const postIds = posts.map((p) => p.id);
    const authorIds = Array.from(new Set(posts.map((p) => p.authorId)));

    const [authorRows, attRows, replyRows, attemptRows] = await Promise.all([
      db.select().from(users).where(inArray(users.id, authorIds)),
      db.select().from(forumAttachments).where(inArray(forumAttachments.postId, postIds)),
      db
        .select({ id: forumReplies.id, postId: forumReplies.postId })
        .from(forumReplies)
        .where(inArray(forumReplies.postId, postIds)),
      db
        .select()
        .from(forumAttempts)
        .where(inArray(forumAttempts.postId, postIds))
        .orderBy(desc(forumAttempts.createdAt)),
    ]);

    const userMap = new Map(authorRows.map((u) => [u.id, u]));
    return posts.map((p) => {
      const postAtts = attRows.filter((a) => a.postId === p.id && !a.replyId).map(toAttachmentItem);
      const replyCount = replyRows.filter((r) => r.postId === p.id).length;
      const postAttempts = attemptRows.filter((a) => a.postId === p.id);
      const viewerAttemptRow = postAttempts.find((a) => a.userId === params.userId);
      const myAttempt: ForumAttemptItem | null = viewerAttemptRow
        ? {
            id: viewerAttemptRow.id,
            postId: viewerAttemptRow.postId,
            userId: viewerAttemptRow.userId,
            attemptPayload: viewerAttemptRow.attemptPayload as ForumAttemptPayload,
            isCorrect: viewerAttemptRow.isCorrect,
            scoreNote: viewerAttemptRow.scoreNote,
            createdAt: new Date(viewerAttemptRow.createdAt).toISOString(),
          }
        : null;

      return projectPostForViewer({
        post: p,
        viewerUserId: params.userId,
        author: toAuthorSummary(userMap.get(p.authorId)),
        attachments: postAtts,
        replyCount,
        attemptCount: new Set(postAttempts.map((a) => a.userId)).size,
        myAttempt,
      });
    });
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    let posts = store.forumPosts
      .filter((p) => p.roomId === params.roomId)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    if (params.postKind === 'question' || params.postKind === 'message') {
      posts = posts.filter((p) => p.postKind === params.postKind);
    }
    if (params.examBoard && params.examBoard !== 'All') {
      posts = posts.filter((p) => p.examBoard === params.examBoard);
    }
    if (params.subject && params.subject !== 'All') {
      posts = posts.filter((p) => p.subject.toLowerCase() === params.subject!.toLowerCase());
    }
    if (params.solved === 'solved') {
      posts = posts.filter((p) => p.isSolved);
    } else if (params.solved === 'unsolved') {
      posts = posts.filter((p) => !p.isSolved);
    }

    return posts.map((p) => {
      const postAtts = store.forumAttachments
        .filter((a) => a.postId === p.id && !a.replyId)
        .map(toAttachmentItem);
      const replyCount = store.forumReplies.filter((r) => r.postId === p.id).length;
      const postAttempts = store.forumAttempts
        .filter((a) => a.postId === p.id)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const viewerAttemptRow = postAttempts.find((a) => a.userId === params.userId);
      const myAttempt: ForumAttemptItem | null = viewerAttemptRow
        ? {
            id: viewerAttemptRow.id,
            postId: viewerAttemptRow.postId,
            userId: viewerAttemptRow.userId,
            attemptPayload: viewerAttemptRow.attemptPayload as ForumAttemptPayload,
            isCorrect: viewerAttemptRow.isCorrect,
            scoreNote: viewerAttemptRow.scoreNote,
            createdAt: new Date(viewerAttemptRow.createdAt).toISOString(),
          }
        : null;
      return projectPostForViewer({
        post: p,
        viewerUserId: params.userId,
        author: toAuthorSummary(store.users.find((u) => u.id === p.authorId)),
        attachments: postAtts,
        replyCount,
        attemptCount: new Set(postAttempts.map((a) => a.userId)).size,
        myAttempt,
      });
    });
  }
}

export async function getForumPostDetail(postId: number, viewerUserId: number): Promise<ForumPostItem> {
  try {
    const [post] = await db.select().from(forumPosts).where(eq(forumPosts.id, postId)).limit(1);
    if (!post) throw new Error('Forum post not found.');
    const access = await canUserAccessForumRoom(post.roomId, viewerUserId);
    if (!access.allowed) throw new Error('You do not have access to this forum post.');

    const [attRows, replyRows, attemptRows] = await Promise.all([
      db.select().from(forumAttachments).where(eq(forumAttachments.postId, postId)),
      db
        .select()
        .from(forumReplies)
        .where(eq(forumReplies.postId, postId))
        .orderBy(asc(forumReplies.createdAt)),
      db
        .select()
        .from(forumAttempts)
        .where(eq(forumAttempts.postId, postId))
        .orderBy(desc(forumAttempts.createdAt)),
    ]);

    const replyIds = replyRows.map((r) => r.id);
    const voteRows =
      replyIds.length > 0
        ? await db.select().from(forumReplyVotes).where(inArray(forumReplyVotes.replyId, replyIds))
        : [];

    const neededUserIds = Array.from(
      new Set([post.authorId, ...replyRows.map((r) => r.authorId), ...attemptRows.map((a) => a.userId)])
    );
    const userRows =
      neededUserIds.length > 0
        ? await db.select().from(users).where(inArray(users.id, neededUserIds))
        : [];
    const userMap = new Map(userRows.map((u) => [u.id, u]));

    const replies: ForumReplyItem[] = replyRows.map((r) => {
      const rVotes = voteRows.filter((v) => v.replyId === r.id);
      return {
        id: r.id,
        postId: r.postId,
        authorId: r.authorId,
        author: toAuthorSummary(userMap.get(r.authorId)),
        parentReplyId: r.parentReplyId ?? null,
        replyKind:
          r.replyKind === 'solution' ||
          r.replyKind === 'refinement' ||
          r.replyKind === 'message'
            ? r.replyKind
            : 'opinion',
        contentHtml: r.contentHtml,
        contentText: r.contentText,
        attachments: attRows.filter((a) => a.replyId === r.id).map(toAttachmentItem),
        attemptPayload: (r.attemptPayload as ForumAttemptPayload | null) || null,
        isAcceptedSolution: Boolean(r.isAcceptedSolution),
        acceptedPointsAwarded: Number(r.acceptedPointsAwarded || 0),
        upvoteCount: rVotes.length,
        viewerHasUpvoted: rVotes.some((v) => v.userId === viewerUserId),
        createdAt: new Date(r.createdAt).toISOString(),
      };
    });

    const viewerAttemptRow = attemptRows.find((a) => a.userId === viewerUserId);
    const myAttempt: ForumAttemptItem | null = viewerAttemptRow
      ? {
          id: viewerAttemptRow.id,
          postId: viewerAttemptRow.postId,
          userId: viewerAttemptRow.userId,
          attemptPayload: viewerAttemptRow.attemptPayload as ForumAttemptPayload,
          isCorrect: viewerAttemptRow.isCorrect,
          scoreNote: viewerAttemptRow.scoreNote,
          createdAt: new Date(viewerAttemptRow.createdAt).toISOString(),
        }
      : null;

    return projectPostForViewer({
      post,
      viewerUserId,
      author: toAuthorSummary(userMap.get(post.authorId)),
      attachments: attRows.filter((a) => !a.replyId).map(toAttachmentItem),
      replyCount: replies.length,
      attemptCount: new Set(attemptRows.map((a) => a.userId)).size,
      myAttempt,
      replies,
    });
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const post = store.forumPosts.find((p) => p.id === postId);
    if (!post) throw new Error('Forum post not found.');
    const access = await canUserAccessForumRoom(post.roomId, viewerUserId);
    if (!access.allowed) throw new Error('You do not have access to this forum post.');

    const attRows = store.forumAttachments.filter((a) => a.postId === postId);
    const replyRows = store.forumReplies
      .filter((r) => r.postId === postId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const attemptRows = store.forumAttempts
      .filter((a) => a.postId === postId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const replies: ForumReplyItem[] = replyRows.map((r) => {
      const rVotes = store.forumReplyVotes.filter((v) => v.replyId === r.id);
      return {
        id: r.id,
        postId: r.postId,
        authorId: r.authorId,
        author: toAuthorSummary(store.users.find((u) => u.id === r.authorId)),
        parentReplyId: r.parentReplyId ?? null,
        replyKind:
          r.replyKind === 'solution' ||
          r.replyKind === 'refinement' ||
          r.replyKind === 'message'
            ? r.replyKind
            : 'opinion',
        contentHtml: r.contentHtml,
        contentText: r.contentText,
        attachments: attRows.filter((a) => a.replyId === r.id).map(toAttachmentItem),
        attemptPayload: (r.attemptPayload as ForumAttemptPayload | null) || null,
        isAcceptedSolution: Boolean(r.isAcceptedSolution),
        acceptedPointsAwarded: Number(r.acceptedPointsAwarded || 0),
        upvoteCount: rVotes.length,
        viewerHasUpvoted: rVotes.some((v) => v.userId === viewerUserId),
        createdAt: new Date(r.createdAt).toISOString(),
      };
    });

    const viewerAttemptRow = attemptRows.find((a) => a.userId === viewerUserId);
    const myAttempt: ForumAttemptItem | null = viewerAttemptRow
      ? {
          id: viewerAttemptRow.id,
          postId: viewerAttemptRow.postId,
          userId: viewerAttemptRow.userId,
          attemptPayload: viewerAttemptRow.attemptPayload as ForumAttemptPayload,
          isCorrect: viewerAttemptRow.isCorrect,
          scoreNote: viewerAttemptRow.scoreNote,
          createdAt: new Date(viewerAttemptRow.createdAt).toISOString(),
        }
      : null;

    return projectPostForViewer({
      post,
      viewerUserId,
      author: toAuthorSummary(store.users.find((u) => u.id === post.authorId)),
      attachments: attRows.filter((a) => !a.replyId).map(toAttachmentItem),
      replyCount: replies.length,
      attemptCount: new Set(attemptRows.map((a) => a.userId)).size,
      myAttempt,
      replies,
    });
  }
}

export async function createForumPost(params: {
  roomId: number;
  authorId: number;
  postKind: 'question' | 'message';
  title: string;
  contentHtml: string;
  subject?: string;
  examBoard?: string;
  questionSpec?: ForumQuestionSpec | null;
  answerKey?: ForumAnswerKey | null;
  officialExplanationHtml?: string;
  attachmentIds?: number[];
}): Promise<ForumPostItem> {
  const access = await canUserAccessForumRoom(params.roomId, params.authorId);
  if (!access.allowed || !access.room) {
    throw new Error('Forum room not found or access denied.');
  }

  const sanitizedHtml = sanitizeRichHtmlServer(params.contentHtml || '');
  const plainText = richHtmlToPlainText(sanitizedHtml);
  const cleanTitle = params.title.trim().slice(0, 220);
  const cleanExplanation = sanitizeRichHtmlServer(params.officialExplanationHtml || '');

  if (params.postKind === 'question' && !cleanTitle && !plainText) {
    throw new Error('Question title or statement is required.');
  }
  if (
    params.postKind === 'message' &&
    !plainText &&
    !sanitizedHtml.includes('<img') &&
    (!params.attachmentIds || params.attachmentIds.length === 0)
  ) {
    throw new Error('Enter message content or attach an image/PDF.');
  }

  const attIds = Array.from(new Set((params.attachmentIds || []).map(Number).filter(Number.isFinite)));
  const cleanSubject = (params.subject || params.questionSpec?.subject || 'General').trim().slice(0, 80);
  const cleanExamBoard = (params.examBoard || params.questionSpec?.examPreset || 'Competitive / Custom')
    .trim()
    .slice(0, 60);

  try {
    const [created] = await db
      .insert(forumPosts)
      .values({
        roomId: params.roomId,
        authorId: params.authorId,
        postKind: params.postKind,
        title: cleanTitle,
        contentHtml: sanitizedHtml,
        contentText: plainText,
        subject: cleanSubject,
        examBoard: cleanExamBoard,
        questionSpec: (params.questionSpec as unknown as Record<string, unknown>) || null,
        answerKey: (params.answerKey as unknown as Record<string, unknown>) || null,
        officialExplanationHtml: cleanExplanation,
        isSolved: false,
      })
      .returning();

    if (attIds.length > 0) {
      await db
        .update(forumAttachments)
        .set({ postId: created.id })
        .where(and(inArray(forumAttachments.id, attIds), eq(forumAttachments.uploaderId, params.authorId)));
    }

    await db
      .update(forumRooms)
      .set({ updatedAt: new Date() })
      .where(eq(forumRooms.id, params.roomId));

    return await getForumPostDetail(created.id, params.authorId);
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const now = new Date();
    const created = {
      id: nextSeq('forumPosts'),
      roomId: params.roomId,
      authorId: params.authorId,
      postKind: params.postKind,
      title: cleanTitle,
      contentHtml: sanitizedHtml,
      contentText: plainText,
      subject: cleanSubject,
      examBoard: cleanExamBoard,
      questionSpec: (params.questionSpec as unknown as Record<string, unknown>) || null,
      answerKey: (params.answerKey as unknown as Record<string, unknown>) || null,
      officialExplanationHtml: cleanExplanation,
      isSolved: false,
      acceptedReplyId: null,
      createdAt: now,
      updatedAt: now,
    };
    store.forumPosts.unshift(created);
    if (attIds.length > 0) {
      store.forumAttachments.forEach((a) => {
        if (attIds.includes(a.id) && a.uploaderId === params.authorId) {
          a.postId = created.id;
        }
      });
    }
    const room = store.forumRooms.find((r) => r.id === params.roomId);
    if (room) room.updatedAt = now;
    persistLocalStore();
    return await getForumPostDetail(created.id, params.authorId);
  }
}

export async function submitQuestionAttempt(params: {
  postId: number;
  userId: number;
  attemptPayload: ForumAttemptPayload;
}): Promise<{
  roomId: number;
  post: ForumPostItem;
  attempt: ForumAttemptItem;
  attemptCount: number;
}> {
  try {
    const [post] = await db.select().from(forumPosts).where(eq(forumPosts.id, params.postId)).limit(1);
    if (!post) throw new Error('Question not found.');
    if (post.postKind !== 'question') throw new Error('Attempts apply only to question posts.');
    const access = await canUserAccessForumRoom(post.roomId, params.userId);
    if (!access.allowed) throw new Error('Access denied.');

    const grade = gradeQuestionAttempt(
      (post.questionSpec as ForumQuestionSpec | null) || null,
      (post.answerKey as ForumAnswerKey | null) || null,
      params.attemptPayload
    );

    const [createdAttempt] = await db
      .insert(forumAttempts)
      .values({
        postId: params.postId,
        userId: params.userId,
        attemptPayload: params.attemptPayload as unknown as Record<string, unknown>,
        isCorrect: grade.isCorrect,
        scoreNote: grade.scoreNote,
      })
      .returning();

    const updatedPost = await getForumPostDetail(params.postId, params.userId);
    return {
      roomId: post.roomId,
      post: updatedPost,
      attempt: {
        id: createdAttempt.id,
        postId: createdAttempt.postId,
        userId: createdAttempt.userId,
        attemptPayload: createdAttempt.attemptPayload as ForumAttemptPayload,
        isCorrect: createdAttempt.isCorrect,
        scoreNote: createdAttempt.scoreNote,
        createdAt: new Date(createdAttempt.createdAt).toISOString(),
      },
      attemptCount: updatedPost.attemptCount,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const post = store.forumPosts.find((p) => p.id === params.postId);
    if (!post) throw new Error('Question not found.');
    if (post.postKind !== 'question') throw new Error('Attempts apply only to question posts.');
    const access = await canUserAccessForumRoom(post.roomId, params.userId);
    if (!access.allowed) throw new Error('Access denied.');

    const grade = gradeQuestionAttempt(
      (post.questionSpec as ForumQuestionSpec | null) || null,
      (post.answerKey as ForumAnswerKey | null) || null,
      params.attemptPayload
    );
    const now = new Date();
    const createdAttempt = {
      id: nextSeq('forumAttempts'),
      postId: params.postId,
      userId: params.userId,
      attemptPayload: params.attemptPayload as unknown as Record<string, unknown>,
      isCorrect: grade.isCorrect,
      scoreNote: grade.scoreNote,
      createdAt: now,
    };
    store.forumAttempts.unshift(createdAttempt);
    persistLocalStore();
    const updatedPost = await getForumPostDetail(params.postId, params.userId);
    return {
      roomId: post.roomId,
      post: updatedPost,
      attempt: {
        id: createdAttempt.id,
        postId: createdAttempt.postId,
        userId: createdAttempt.userId,
        attemptPayload: createdAttempt.attemptPayload as ForumAttemptPayload,
        isCorrect: createdAttempt.isCorrect,
        scoreNote: createdAttempt.scoreNote,
        createdAt: now.toISOString(),
      },
      attemptCount: updatedPost.attemptCount,
    };
  }
}

export async function createForumReply(params: {
  postId: number;
  authorId: number;
  parentReplyId?: number | null;
  replyKind: 'solution' | 'opinion' | 'refinement' | 'message';
  contentHtml: string;
  attachmentIds?: number[];
  attemptPayload?: ForumAttemptPayload | null;
}): Promise<{ roomId: number; reply: ForumReplyItem }> {
  const sanitizedHtml = sanitizeRichHtmlServer(params.contentHtml || '');
  const plainText = richHtmlToPlainText(sanitizedHtml);
  const attIds = Array.from(new Set((params.attachmentIds || []).map(Number).filter(Number.isFinite)));

  if (!plainText && !sanitizedHtml.includes('<img') && attIds.length === 0) {
    throw new Error('Reply text or media attachment cannot be empty.');
  }

  try {
    const [post] = await db.select().from(forumPosts).where(eq(forumPosts.id, params.postId)).limit(1);
    if (!post) throw new Error('Forum post not found.');
    const access = await canUserAccessForumRoom(post.roomId, params.authorId);
    if (!access.allowed) throw new Error('Access denied.');

    let validParentId: number | null = null;
    if (params.parentReplyId) {
      const [parentRow] = await db
        .select()
        .from(forumReplies)
        .where(and(eq(forumReplies.id, params.parentReplyId), eq(forumReplies.postId, params.postId)))
        .limit(1);
      if (!parentRow) throw new Error('Parent reply does not belong to this post.');
      validParentId = parentRow.id;
    }

    const [created] = await db
      .insert(forumReplies)
      .values({
        postId: params.postId,
        authorId: params.authorId,
        parentReplyId: validParentId,
        replyKind: params.replyKind,
        contentHtml: sanitizedHtml,
        contentText: plainText,
        attemptPayload: (params.attemptPayload as unknown as Record<string, unknown>) || null,
      })
      .returning();

    if (attIds.length > 0) {
      await db
        .update(forumAttachments)
        .set({ postId: params.postId, replyId: created.id })
        .where(and(inArray(forumAttachments.id, attIds), eq(forumAttachments.uploaderId, params.authorId)));
    }

    const now = new Date();
    await db.update(forumPosts).set({ updatedAt: now }).where(eq(forumPosts.id, params.postId));
    await db.update(forumRooms).set({ updatedAt: now }).where(eq(forumRooms.id, post.roomId));

    const [authorRow] = await db.select().from(users).where(eq(users.id, params.authorId)).limit(1);
    const attRows =
      attIds.length > 0
        ? await db.select().from(forumAttachments).where(eq(forumAttachments.replyId, created.id))
        : [];

    if (post.authorId !== params.authorId) {
      await db.insert(notifications).values({
        userId: post.authorId,
        senderId: params.authorId,
        senderLabel: `@${authorRow?.username || 'student'}`,
        title: `New Forum Reply: ${(post.title || post.contentText || 'Question').slice(0, 60)}`,
        message: plainText.slice(0, 140) || 'Shared an image/PDF response.',
        type: 'forum',
      });
    }

    return {
      roomId: post.roomId,
      reply: {
        id: created.id,
        postId: created.postId,
        authorId: created.authorId,
        author: toAuthorSummary(authorRow),
        parentReplyId: created.parentReplyId ?? null,
        replyKind: params.replyKind,
        contentHtml: created.contentHtml,
        contentText: created.contentText,
        attachments: attRows.map(toAttachmentItem),
        attemptPayload: params.attemptPayload || null,
        isAcceptedSolution: false,
        acceptedPointsAwarded: 0,
        upvoteCount: 0,
        viewerHasUpvoted: false,
        createdAt: new Date(created.createdAt).toISOString(),
      },
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const post = store.forumPosts.find((p) => p.id === params.postId);
    if (!post) throw new Error('Forum post not found.');
    const access = await canUserAccessForumRoom(post.roomId, params.authorId);
    if (!access.allowed) throw new Error('Access denied.');

    let validParentId: number | null = null;
    if (params.parentReplyId) {
      const parentRow = store.forumReplies.find(
        (r) => r.id === params.parentReplyId && r.postId === params.postId
      );
      if (!parentRow) throw new Error('Parent reply does not belong to this post.');
      validParentId = parentRow.id;
    }

    const now = new Date();
    const created = {
      id: nextSeq('forumReplies'),
      postId: params.postId,
      authorId: params.authorId,
      parentReplyId: validParentId,
      replyKind: params.replyKind,
      contentHtml: sanitizedHtml,
      contentText: plainText,
      attemptPayload: (params.attemptPayload as unknown as Record<string, unknown>) || null,
      isAcceptedSolution: false,
      acceptedPointsAwarded: 0,
      createdAt: now,
    };
    store.forumReplies.push(created);
    if (attIds.length > 0) {
      store.forumAttachments.forEach((a) => {
        if (attIds.includes(a.id) && a.uploaderId === params.authorId) {
          a.postId = params.postId;
          a.replyId = created.id;
        }
      });
    }
    post.updatedAt = now;
    const room = store.forumRooms.find((r) => r.id === post.roomId);
    if (room) room.updatedAt = now;

    const authorRow = store.users.find((u) => u.id === params.authorId);
    if (post.authorId !== params.authorId) {
      store.notifications.unshift({
        id: nextSeq('notifications'),
        userId: post.authorId,
        senderId: params.authorId,
        senderLabel: `@${authorRow?.username || 'student'}`,
        title: `New Forum Reply: ${(post.title || post.contentText || 'Question').slice(0, 60)}`,
        message: plainText.slice(0, 140) || 'Shared an image/PDF response.',
        type: 'forum',
        isRead: false,
        createdAt: now,
      });
    }
    persistLocalStore();

    return {
      roomId: post.roomId,
      reply: {
        id: created.id,
        postId: created.postId,
        authorId: created.authorId,
        author: toAuthorSummary(authorRow),
        parentReplyId: created.parentReplyId ?? null,
        replyKind: params.replyKind,
        contentHtml: created.contentHtml,
        contentText: created.contentText,
        attachments: store.forumAttachments
          .filter((a) => a.replyId === created.id)
          .map(toAttachmentItem),
        attemptPayload: params.attemptPayload || null,
        isAcceptedSolution: false,
        acceptedPointsAwarded: 0,
        upvoteCount: 0,
        viewerHasUpvoted: false,
        createdAt: now.toISOString(),
      },
    };
  }
}

export async function toggleForumReplyVote(
  replyId: number,
  userId: number
): Promise<{ roomId: number; postId: number; replyId: number; upvoteCount: number; voted: boolean }> {
  try {
    const [reply] = await db.select().from(forumReplies).where(eq(forumReplies.id, replyId)).limit(1);
    if (!reply) throw new Error('Reply not found.');
    const [post] = await db.select().from(forumPosts).where(eq(forumPosts.id, reply.postId)).limit(1);
    if (!post) throw new Error('Post not found.');
    const access = await canUserAccessForumRoom(post.roomId, userId);
    if (!access.allowed) throw new Error('Access denied.');

    const existing = await db
      .select()
      .from(forumReplyVotes)
      .where(and(eq(forumReplyVotes.replyId, replyId), eq(forumReplyVotes.userId, userId)))
      .limit(1);

    let voted = false;
    if (existing.length > 0) {
      await db.delete(forumReplyVotes).where(eq(forumReplyVotes.id, existing[0].id));
      voted = false;
    } else {
      await db.insert(forumReplyVotes).values({ replyId, userId });
      voted = true;
    }
    const allVotes = await db
      .select()
      .from(forumReplyVotes)
      .where(eq(forumReplyVotes.replyId, replyId));
    return {
      roomId: post.roomId,
      postId: post.id,
      replyId,
      upvoteCount: allVotes.length,
      voted,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const reply = store.forumReplies.find((r) => r.id === replyId);
    if (!reply) throw new Error('Reply not found.');
    const post = store.forumPosts.find((p) => p.id === reply.postId);
    if (!post) throw new Error('Post not found.');
    const access = await canUserAccessForumRoom(post.roomId, userId);
    if (!access.allowed) throw new Error('Access denied.');

    const idx = store.forumReplyVotes.findIndex((v) => v.replyId === replyId && v.userId === userId);
    let voted = false;
    if (idx >= 0) {
      store.forumReplyVotes.splice(idx, 1);
      voted = false;
    } else {
      store.forumReplyVotes.push({
        id: nextSeq('forumReplyVotes'),
        replyId,
        userId,
        createdAt: new Date(),
      });
      voted = true;
    }
    persistLocalStore();
    const count = store.forumReplyVotes.filter((v) => v.replyId === replyId).length;
    return {
      roomId: post.roomId,
      postId: post.id,
      replyId,
      upvoteCount: count,
      voted,
    };
  }
}

export async function markForumReplySatisfactory(params: {
  postId: number;
  replyId: number;
  actorUserId: number;
}): Promise<{
  roomId: number;
  postId: number;
  replyId: number;
  solverUserId: number;
  pointsAwarded: number;
  solverNewPoints?: number;
  post: ForumPostItem;
}> {
  const rewards = await getPointRewardsConfig();
  const configuredPoints = Math.max(0, Math.round(rewards.forumSatisfactoryAnswer ?? 25));

  try {
    const [post] = await db
      .select()
      .from(forumPosts)
      .where(eq(forumPosts.id, params.postId))
      .limit(1);
    if (!post) throw new Error('Question not found.');
    if (post.postKind !== 'question') {
      throw new Error('Satisfaction points can only be awarded on question posts.');
    }
    if (post.authorId !== params.actorUserId) {
      throw new Error('Only the question author can mark a reply as satisfactory.');
    }

    const [reply] = await db
      .select()
      .from(forumReplies)
      .where(and(eq(forumReplies.id, params.replyId), eq(forumReplies.postId, params.postId)))
      .limit(1);
    if (!reply) throw new Error('Reply not found on this question.');
    if (reply.authorId === post.authorId) {
      throw new Error('Self-award is disabled: you cannot mark your own reply as satisfactory.');
    }
    if (reply.isAcceptedSolution) {
      throw new Error('This reply has already been awarded satisfaction points.');
    }

    const reasonTag = `Forum Satisfactory Answer #${post.id}:${reply.id}`;
    const existingTx = await db
      .select()
      .from(pointTransactions)
      .where(eq(pointTransactions.userId, reply.authorId));
    if (existingTx.some((t) => t.reason.includes(`#${post.id}:${reply.id}`))) {
      throw new Error('Satisfaction points were already credited for this reply.');
    }

    const [updatedSolver] = configuredPoints > 0
      ? [
          await awardPoints(
            reply.authorId,
            configuredPoints,
            `${reasonTag} — ${(post.title || post.contentText || 'Question').slice(0, 60)}`,
            'forum_satisfactory'
          ),
        ]
      : [null];

    await db
      .update(forumReplies)
      .set({
        isAcceptedSolution: true,
        acceptedPointsAwarded: configuredPoints,
      })
      .where(eq(forumReplies.id, reply.id));

    await db
      .update(forumPosts)
      .set({
        isSolved: true,
        acceptedReplyId: post.acceptedReplyId || reply.id,
        updatedAt: new Date(),
      })
      .where(eq(forumPosts.id, post.id));

    await db.insert(notifications).values({
      userId: reply.authorId,
      senderId: params.actorUserId,
      senderLabel: 'Study Forum',
      title: `Answer Marked Satisfactory (+${configuredPoints} pts)`,
      message: `Your solution on "${(post.title || post.contentText).slice(0, 70)}" was marked satisfactory and awarded +${configuredPoints} points.`,
      type: 'points',
    });

    const refreshedPost = await getForumPostDetail(post.id, params.actorUserId);
    return {
      roomId: post.roomId,
      postId: post.id,
      replyId: reply.id,
      solverUserId: reply.authorId,
      pointsAwarded: configuredPoints,
      solverNewPoints: updatedSolver?.points,
      post: refreshedPost,
    };
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const post = store.forumPosts.find((p) => p.id === params.postId);
    if (!post) throw new Error('Question not found.');
    if (post.postKind !== 'question') {
      throw new Error('Satisfaction points can only be awarded on question posts.');
    }
    if (post.authorId !== params.actorUserId) {
      throw new Error('Only the question author can mark a reply as satisfactory.');
    }
    const reply = store.forumReplies.find(
      (r) => r.id === params.replyId && r.postId === params.postId
    );
    if (!reply) throw new Error('Reply not found on this question.');
    if (reply.authorId === post.authorId) {
      throw new Error('Self-award is disabled: you cannot mark your own reply as satisfactory.');
    }
    if (reply.isAcceptedSolution) {
      throw new Error('This reply has already been awarded satisfaction points.');
    }

    const reasonTag = `Forum Satisfactory Answer #${post.id}:${reply.id}`;
    const updatedSolver =
      configuredPoints > 0
        ? await awardPoints(
            reply.authorId,
            configuredPoints,
            `${reasonTag} — ${(post.title || post.contentText || 'Question').slice(0, 60)}`,
            'forum_satisfactory'
          )
        : null;

    reply.isAcceptedSolution = true;
    reply.acceptedPointsAwarded = configuredPoints;
    post.isSolved = true;
    if (!post.acceptedReplyId) post.acceptedReplyId = reply.id;
    post.updatedAt = new Date();
    store.notifications.unshift({
      id: nextSeq('notifications'),
      userId: reply.authorId,
      senderId: params.actorUserId,
      senderLabel: 'Study Forum',
      title: `Answer Marked Satisfactory (+${configuredPoints} pts)`,
      message: `Your solution on "${(post.title || post.contentText).slice(0, 70)}" was marked satisfactory and awarded +${configuredPoints} points.`,
      type: 'points',
      isRead: false,
      createdAt: new Date(),
    });
    persistLocalStore();

    const refreshedPost = await getForumPostDetail(post.id, params.actorUserId);
    return {
      roomId: post.roomId,
      postId: post.id,
      replyId: reply.id,
      solverUserId: reply.authorId,
      pointsAwarded: configuredPoints,
      solverNewPoints: updatedSolver?.points,
      post: refreshedPost,
    };
  }
}

export async function createForumAttachmentRecord(params: {
  uploaderId: number;
  fileName: string;
  storedFileName: string;
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
  kind: 'image' | 'pdf';
}): Promise<ForumAttachmentItem> {
  try {
    const [created] = await db
      .insert(forumAttachments)
      .values({
        uploaderId: params.uploaderId,
        fileName: params.fileName,
        storedFileName: params.storedFileName,
        mimeType: params.mimeType,
        fileSizeBytes: params.fileSizeBytes,
        pageCount: params.pageCount,
        kind: params.kind,
      })
      .returning();
    return toAttachmentItem(created);
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const created = {
      id: nextSeq('forumAttachments'),
      postId: null,
      replyId: null,
      messageId: null,
      uploaderId: params.uploaderId,
      fileName: params.fileName,
      storedFileName: params.storedFileName,
      mimeType: params.mimeType,
      fileSizeBytes: params.fileSizeBytes,
      pageCount: params.pageCount,
      kind: params.kind,
      createdAt: new Date(),
    };
    store.forumAttachments.unshift(created);
    persistLocalStore();
    return toAttachmentItem(created);
  }
}

export async function getForumAttachmentForUser(
  attachmentId: number,
  viewerUserId: number
): Promise<ForumAttachmentItem | null> {
  try {
    const [att] = await db
      .select()
      .from(forumAttachments)
      .where(eq(forumAttachments.id, attachmentId))
      .limit(1);
    if (!att) return null;
    if (att.uploaderId === viewerUserId) return toAttachmentItem(att);
    if (att.postId) {
      const [post] = await db
        .select()
        .from(forumPosts)
        .where(eq(forumPosts.id, att.postId))
        .limit(1);
      if (post) {
        const access = await canUserAccessForumRoom(post.roomId, viewerUserId);
        if (access.allowed) return toAttachmentItem(att);
      }
    }
    if (att.messageId) {
      const [msg] = await db
        .select()
        .from(userMessages)
        .where(eq(userMessages.id, att.messageId))
        .limit(1);
      if (
        msg &&
        (msg.senderId === viewerUserId ||
          msg.recipientId === viewerUserId ||
          msg.visibility === 'public')
      ) {
        return toAttachmentItem(att);
      }
    }
    // Check if embedded inside any visible userMessage attachmentsJson
    const visibleMsgs = await db
      .select()
      .from(userMessages)
      .where(
        or(
          eq(userMessages.senderId, viewerUserId),
          eq(userMessages.recipientId, viewerUserId),
          eq(userMessages.visibility, 'public')
        )
      );
    if (
      visibleMsgs.some(
        (m) =>
          Array.isArray(m.attachmentsJson) &&
          m.attachmentsJson.some((x) => Number((x as { id?: unknown }).id) === attachmentId)
      )
    ) {
      return toAttachmentItem(att);
    }
    return null;
  } catch (error) {
    if (!isDbUnavailableError(error)) throw error;
    const store = getLocalStore();
    const att = store.forumAttachments.find((a) => a.id === attachmentId);
    if (!att) return null;
    if (att.uploaderId === viewerUserId) return toAttachmentItem(att);
    if (att.postId) {
      const post = store.forumPosts.find((p) => p.id === att.postId);
      if (post) {
        const access = await canUserAccessForumRoom(post.roomId, viewerUserId);
        if (access.allowed) return toAttachmentItem(att);
      }
    }
    const visibleMsgs = store.userMessages.filter(
      (m) =>
        m.senderId === viewerUserId || m.recipientId === viewerUserId || m.visibility === 'public'
    );
    if (
      visibleMsgs.some(
        (m) =>
          Array.isArray(m.attachmentsJson) &&
          m.attachmentsJson.some((x) => Number((x as { id?: unknown }).id) === attachmentId)
      )
    ) {
      return toAttachmentItem(att);
    }
    return null;
  }
}
