import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  CheckCircle2,
  CornerDownRight,
  Globe,
  HelpCircle,
  Lock,
  MessageCircle,
  MessageSquare,
  Plus,
  Search,
  Send,
  ThumbsUp,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, apiPublicFetch } from '../lib/api';
import { useForumSocket } from '../lib/forumSocket';
import type {
  ForumAnswerKey,
  ForumAttachmentItem,
  ForumPostItem,
  ForumQuestionSpec,
  ForumReplyItem,
  ForumRoomItem,
  ForumSocketEvent,
  PointRewardsConfig,
  ToolUserSummary,
} from '../types';
import { ForumAttachmentGrid } from './ForumAttachmentViewer';
import { QuestionSolverCard } from './QuestionSolverCard';
import { QuestionSpecBuilder } from './QuestionSpecBuilder';
import { SafeHtmlContent } from './SafeHtmlContent';
import { SummernoteEditor } from './SummernoteEditor';
import { UserAvatarBadge } from './UserAvatarBadge';

const INITIAL_SPEC: ForumQuestionSpec = {
  examPreset: 'JEE Main',
  subject: 'Physics',
  topic: '',
  fieldType: 'mcq_single',
  options: [
    { id: 'A', text: '' },
    { id: 'B', text: '' },
    { id: 'C', text: '' },
    { id: 'D', text: '' },
  ],
  positiveMarks: 4,
  negativeMarks: 1,
  revealMode: 'after_attempt',
};

export const ForumView: React.FC = () => {
  const { dbUser, isGuest, signIn, refreshProfile } = useAuth();

  const [rooms, setRooms] = useState<ForumRoomItem[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(null);
  const [posts, setPosts] = useState<ForumPostItem[]>([]);
  const [selectedPost, setSelectedPost] = useState<ForumPostItem | null>(null);
  const [toolUsers, setToolUsers] = useState<ToolUserSummary[]>([]);
  const [satisfactionReward, setSatisfactionReward] = useState<number>(25);

  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Filters
  const [kindFilter, setKindFilter] = useState<'all' | 'question' | 'message'>('all');
  const [solvedFilter, setSolvedFilter] = useState<'all' | 'unsolved' | 'solved'>('all');
  const [examFilter, setExamFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Presence & Typing
  const [onlineByRoom, setOnlineByRoom] = useState<Record<number, number[]>>({});
  const [typingMap, setTypingMap] = useState<
    Record<string, { displayName: string; username: string; expiresAt: number }>
  >({});

  // Compose Modal
  const [composeOpen, setComposeOpen] = useState(false);
  const [postKind, setPostKind] = useState<'question' | 'message'>('question');
  const [postTitle, setPostTitle] = useState('');
  const [postSubject, setPostSubject] = useState('Physics');
  const [postHtml, setPostHtml] = useState('');
  const [postAttachments, setPostAttachments] = useState<ForumAttachmentItem[]>([]);
  const [questionSpec, setQuestionSpec] = useState<ForumQuestionSpec>(INITIAL_SPEC);
  const [answerKey, setAnswerKey] = useState<ForumAnswerKey>({});
  const [officialExplanationHtml, setOfficialExplanationHtml] = useState('');
  const [publishing, setPublishing] = useState(false);

  // Group / DM Modals
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupTitle, setGroupTitle] = useState('');
  const [groupSubject, setGroupSubject] = useState('General');
  const [groupDesc, setGroupDesc] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<number[]>([]);
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberIds, setAddMemberIds] = useState<number[]>([]);
  const [dmModalOpen, setDmModalOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Reply Composer State
  const [replyKind, setReplyKind] = useState<'solution' | 'opinion' | 'refinement' | 'message'>(
    'solution'
  );
  const [replyHtml, setReplyHtml] = useState('');
  const [replyAttachments, setReplyAttachments] = useState<ForumAttachmentItem[]>([]);
  const [replyingTo, setReplyingTo] = useState<ForumReplyItem | null>(null);
  const [sendingReply, setSendingReply] = useState(false);
  const [satisfyingId, setSatisfyingId] = useState<number | null>(null);

  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const activeRoomIdRef = useRef<number | null>(activeRoomId);
  activeRoomIdRef.current = activeRoomId;
  const selectedPostIdRef = useRef<number | null>(selectedPost?.id || null);
  selectedPostIdRef.current = selectedPost?.id || null;
  const lastTypingSentRef = useRef<number>(0);

  const handleSocketEvent = useCallback(
    (evt: ForumSocketEvent) => {
      if (evt.type === 'room:created' || evt.type === 'room:updated') {
        setRooms((prev) => {
          const exists = prev.some((r) => r.id === evt.room.id);
          if (exists) return prev.map((r) => (r.id === evt.room.id ? evt.room : r));
          return [evt.room, ...prev];
        });
        return;
      }

      if (evt.type === 'post:created') {
        setRooms((prev) =>
          prev.map((r) =>
            r.id === evt.roomId
              ? {
                  ...r,
                  lastMessagePreview: (evt.post.title || evt.post.contentText).slice(0, 90),
                  lastActivityAt: evt.post.updatedAt,
                  unreadCount:
                    activeRoomIdRef.current === evt.roomId ? r.unreadCount : r.unreadCount + 1,
                }
              : r
          )
        );
        if (activeRoomIdRef.current === evt.roomId) {
          setPosts((prev) => {
            if (prev.some((p) => p.id === evt.post.id)) return prev;
            return [evt.post, ...prev];
          });
        }
        return;
      }

      if (evt.type === 'reply:created') {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === evt.postId
              ? { ...p, replyCount: p.replyCount + 1, updatedAt: evt.reply.createdAt }
              : p
          )
        );
        if (selectedPostIdRef.current === evt.postId) {
          setSelectedPost((prev) => {
            if (!prev) return prev;
            const existingReplies = prev.replies || [];
            if (existingReplies.some((r) => r.id === evt.reply.id)) return prev;
            return {
              ...prev,
              replyCount: prev.replyCount + 1,
              replies: [...existingReplies, evt.reply],
            };
          });
        }
        return;
      }

      if (evt.type === 'reply:voted') {
        if (selectedPostIdRef.current === evt.postId) {
          setSelectedPost((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              replies: (prev.replies || []).map((r) =>
                r.id === evt.replyId
                  ? {
                      ...r,
                      upvoteCount: evt.upvoteCount,
                      viewerHasUpvoted:
                        evt.userId === dbUser?.id ? evt.voted : r.viewerHasUpvoted,
                    }
                  : r
              ),
            };
          });
        }
        return;
      }

      if (evt.type === 'attempt:created') {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === evt.postId ? { ...p, attemptCount: evt.attemptCount } : p
          )
        );
        if (selectedPostIdRef.current === evt.postId) {
          setSelectedPost((prev) =>
            prev ? { ...prev, attemptCount: evt.attemptCount } : prev
          );
        }
        return;
      }

      if (evt.type === 'post:satisfied') {
        setPosts((prev) =>
          prev.map((p) =>
            p.id === evt.postId
              ? { ...p, isSolved: true, acceptedReplyId: evt.replyId }
              : p
          )
        );
        if (selectedPostIdRef.current === evt.postId) {
          setSelectedPost((prev) =>
            prev
              ? {
                  ...prev,
                  isSolved: true,
                  acceptedReplyId: evt.replyId,
                  replies: (prev.replies || []).map((r) =>
                    r.id === evt.replyId
                      ? {
                          ...r,
                          isAcceptedSolution: true,
                          acceptedPointsAwarded: evt.pointsAwarded,
                        }
                      : r
                  ),
                }
              : prev
          );
        }
        return;
      }

      if (evt.type === 'presence:room') {
        setOnlineByRoom((prev) => ({
          ...prev,
          [evt.roomId]: evt.onlineUserIds,
        }));
        return;
      }

      if (evt.type === 'typing:state') {
        if (evt.userId === dbUser?.id) return;
        const key = `${evt.roomId}:${evt.postId || 0}:${evt.userId}`;
        setTypingMap((prev) => {
          const next = { ...prev };
          if (!evt.isTyping) {
            delete next[key];
          } else {
            next[key] = {
              displayName: evt.displayName,
              username: evt.username,
              expiresAt: Date.now() + 3800,
            };
          }
          return next;
        });
        return;
      }

      if (evt.type === 'points:updated' && evt.userId === dbUser?.id) {
        void refreshProfile();
      }
    },
    [dbUser?.id, refreshProfile]
  );

  const { connected, transport, sendTyping } = useForumSocket({
    enabled: !isGuest && Boolean(dbUser),
    activeRoomId,
    onEvent: handleSocketEvent,
  });

  // Clean expired typing indicators every second
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setTypingMap((prev) => {
        let changed = false;
        const next: typeof prev = {};
        for (const [k, v] of Object.entries(prev)) {
          if (v.expiresAt > now) next[k] = v;
          else changed = true;
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const loadInitial = useCallback(async () => {
    if (isGuest || !dbUser) {
      setLoadingRooms(false);
      return;
    }
    setLoadingRooms(true);
    try {
      const [roomRows, usersRows, rewardsRes] = await Promise.all([
        apiFetch<ForumRoomItem[]>('/api/forum/rooms'),
        apiFetch<ToolUserSummary[]>('/api/tool-users').catch(() => []),
        apiPublicFetch<{ rewards?: PointRewardsConfig } & Partial<PointRewardsConfig>>(
          '/api/point-rewards'
        ).catch(() => ({} as Partial<PointRewardsConfig>)),
      ]);
      setRooms(roomRows);
      setToolUsers(usersRows);
      const rCfg = (rewardsRes as { rewards?: PointRewardsConfig }).rewards || rewardsRes;
      if (typeof rCfg.forumSatisfactoryAnswer === 'number') {
        setSatisfactionReward(rCfg.forumSatisfactoryAnswer);
      }
      if (roomRows.length > 0 && !activeRoomIdRef.current) {
        setActiveRoomId(roomRows[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load Study Forum');
    } finally {
      setLoadingRooms(false);
    }
  }, [dbUser, isGuest]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  const loadRoomPosts = useCallback(
    async (roomId: number) => {
      setLoadingPosts(true);
      setErrorMsg(null);
      try {
        const list = await apiFetch<ForumPostItem[]>(`/api/forum/rooms/${roomId}/posts`);
        setPosts(list);
        await apiFetch(`/api/forum/rooms/${roomId}/read`, { method: 'POST' }).catch(() => {});
        setRooms((prev) =>
          prev.map((r) => (r.id === roomId ? { ...r, unreadCount: 0 } : r))
        );
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Failed to load room discussions');
      } finally {
        setLoadingPosts(false);
      }
    },
    []
  );

  useEffect(() => {
    if (activeRoomId && !isGuest && dbUser) {
      setSelectedPost(null);
      void loadRoomPosts(activeRoomId);
    }
  }, [activeRoomId, dbUser, isGuest, loadRoomPosts]);

  // Fallback polling only if socket & SSE are unavailable (offline/inbuilt PWA)
  useEffect(() => {
    if (isGuest || !dbUser || !activeRoomId || connected) return;
    const id = window.setInterval(() => {
      void apiFetch<ForumPostItem[]>(`/api/forum/rooms/${activeRoomId}/posts`)
        .then((list) => setPosts(list))
        .catch(() => {});
    }, 6000);
    return () => window.clearInterval(id);
  }, [activeRoomId, connected, dbUser, isGuest]);

  const openPostDetail = async (post: ForumPostItem) => {
    setSelectedPost(post);
    setReplyingTo(null);
    setReplyHtml('');
    setReplyAttachments([]);
    setReplyKind(post.postKind === 'question' ? 'solution' : 'message');
    setLoadingDetail(true);
    try {
      const full = await apiFetch<ForumPostItem>(`/api/forum/posts/${post.id}`);
      setSelectedPost(full);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load post thread');
    } finally {
      setLoadingDetail(false);
    }
  };

  const activeRoom = useMemo(
    () => rooms.find((r) => r.id === activeRoomId) || null,
    [rooms, activeRoomId]
  );

  const filteredPosts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return posts.filter((p) => {
      if (kindFilter !== 'all' && p.postKind !== kindFilter) return false;
      if (solvedFilter === 'solved' && !p.isSolved) return false;
      if (solvedFilter === 'unsolved' && (p.isSolved || p.postKind !== 'question')) return false;
      if (examFilter !== 'all' && p.examBoard !== examFilter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.contentText.toLowerCase().includes(q) ||
        p.subject.toLowerCase().includes(q) ||
        p.author.username.toLowerCase().includes(q) ||
        p.author.displayName.toLowerCase().includes(q)
      );
    });
  }, [posts, kindFilter, solvedFilter, examFilter, searchTerm]);

  const handlePublishPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoomId) return;
    setPublishing(true);
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const payloadSpec =
        postKind === 'question'
          ? {
              ...questionSpec,
              subject: postSubject.trim() || questionSpec.subject || 'General',
            }
          : null;
      const created = await apiFetch<ForumPostItem>('/api/forum/posts', {
        method: 'POST',
        body: JSON.stringify({
          roomId: activeRoomId,
          postKind,
          title: postTitle.trim(),
          contentHtml: postHtml,
          subject: postSubject.trim() || 'General',
          examBoard: payloadSpec ? payloadSpec.examPreset : '',
          questionSpec: payloadSpec,
          answerKey: postKind === 'question' ? answerKey : null,
          officialExplanationHtml:
            postKind === 'question' ? officialExplanationHtml : '',
          attachmentIds: postAttachments.map((a) => a.id),
        }),
      });
      setPosts((prev) =>
        prev.some((p) => p.id === created.id) ? prev : [created, ...prev]
      );
      setComposeOpen(false);
      setPostTitle('');
      setPostHtml('');
      setPostAttachments([]);
      setQuestionSpec(INITIAL_SPEC);
      setAnswerKey({});
      setOfficialExplanationHtml('');
      setStatusMsg(
        postKind === 'question'
          ? 'Question published! Other students can attempt it and collaborate.'
          : 'Message posted.'
      );
      void openPostDetail(created);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to publish post');
    } finally {
      setPublishing(false);
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const created = await apiFetch<ForumRoomItem>('/api/forum/groups', {
        method: 'POST',
        body: JSON.stringify({
          title: groupTitle.trim(),
          subject: groupSubject.trim() || 'General',
          description: groupDesc.trim(),
          memberIds: groupMemberIds,
        }),
      });
      setRooms((prev) =>
        prev.some((r) => r.id === created.id) ? prev : [created, ...prev]
      );
      setActiveRoomId(created.id);
      setGroupModalOpen(false);
      setGroupTitle('');
      setGroupDesc('');
      setGroupMemberIds([]);
      setStatusMsg(`Created Study Group "${created.title}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create group');
    }
  };

  const handleAddGroupMembers = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRoom || addMemberIds.length === 0) return;
    try {
      const res = await apiFetch<{ room: ForumRoomItem }>(
        `/api/forum/groups/${activeRoom.id}/members`,
        {
          method: 'POST',
          body: JSON.stringify({ memberIds: addMemberIds }),
        }
      );
      setRooms((prev) => prev.map((r) => (r.id === res.room.id ? res.room : r)));
      setAddMemberOpen(false);
      setAddMemberIds([]);
      setStatusMsg(`Added ${addMemberIds.length} member(s) to ${res.room.title}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to add members');
    }
  };

  const handleStartDm = async (targetUserId: number) => {
    try {
      const room = await apiFetch<ForumRoomItem>('/api/forum/dm', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
      setRooms((prev) => (prev.some((r) => r.id === room.id) ? prev : [room, ...prev]));
      setActiveRoomId(room.id);
      setDmModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to open 1-to-1 chat');
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPost) return;
    setSendingReply(true);
    setErrorMsg(null);
    try {
      const reply = await apiFetch<ForumReplyItem>(
        `/api/forum/posts/${selectedPost.id}/replies`,
        {
          method: 'POST',
          body: JSON.stringify({
            parentReplyId: replyingTo ? replyingTo.id : null,
            replyKind,
            contentHtml: replyHtml,
            attachmentIds: replyAttachments.map((a) => a.id),
          }),
        }
      );
      if (activeRoomId) sendTyping(activeRoomId, selectedPost.id, false);
      setReplyHtml('');
      setReplyAttachments([]);
      setReplyingTo(null);
      setSelectedPost((prev) => {
        if (!prev) return prev;
        const list = prev.replies || [];
        if (list.some((r) => r.id === reply.id)) return prev;
        return { ...prev, replyCount: prev.replyCount + 1, replies: [...list, reply] };
      });
      setPosts((prev) =>
        prev.map((p) =>
          p.id === selectedPost.id ? { ...p, replyCount: p.replyCount + 1 } : p
        )
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to post reply');
    } finally {
      setSendingReply(false);
    }
  };

  const handleVoteReply = async (replyId: number) => {
    try {
      const res = await apiFetch<{
        replyId: number;
        upvoteCount: number;
        voted: boolean;
      }>(`/api/forum/replies/${replyId}/vote`, { method: 'POST' });
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              replies: (prev.replies || []).map((r) =>
                r.id === res.replyId
                  ? { ...r, upvoteCount: res.upvoteCount, viewerHasUpvoted: res.voted }
                  : r
              ),
            }
          : prev
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Vote failed');
    }
  };

  const handleMarkSatisfactory = async (reply: ForumReplyItem) => {
    if (!selectedPost) return;
    setSatisfyingId(reply.id);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{
        postId: number;
        replyId: number;
        pointsAwarded: number;
      }>(`/api/forum/posts/${selectedPost.id}/satisfy`, {
        method: 'POST',
        body: JSON.stringify({ replyId: reply.id }),
      });
      setSelectedPost((prev) =>
        prev
          ? {
              ...prev,
              isSolved: true,
              acceptedReplyId: res.replyId,
              replies: (prev.replies || []).map((r) =>
                r.id === res.replyId
                  ? {
                      ...r,
                      isAcceptedSolution: true,
                      acceptedPointsAwarded: res.pointsAwarded,
                    }
                  : r
              ),
            }
          : prev
      );
      setPosts((prev) =>
        prev.map((p) =>
          p.id === selectedPost.id
            ? { ...p, isSolved: true, acceptedReplyId: res.replyId }
            : p
        )
      );
      setStatusMsg(
        `Marked @${reply.author.username}'s reply as satisfactory (+${res.pointsAwarded} points awarded)!`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not award satisfaction points');
    } finally {
      setSatisfyingId(null);
    }
  };

  const activeTypingUsers = useMemo(() => {
    if (!activeRoomId) return [];
    const list: string[] = [];
    for (const [key, val] of Object.entries(typingMap)) {
      if (key.startsWith(`${activeRoomId}:`)) {
        list.push(`@${val.username}`);
      }
    }
    return list;
  }, [typingMap, activeRoomId]);

  const orderedReplies = useMemo(() => {
    const all = selectedPost?.replies || [];
    const roots = all.filter((r) => !r.parentReplyId);
    const childrenByParent = new Map<number, ForumReplyItem[]>();
    for (const r of all) {
      if (r.parentReplyId) {
        const arr = childrenByParent.get(r.parentReplyId) || [];
        arr.push(r);
        childrenByParent.set(r.parentReplyId, arr);
      }
    }
    const flattened: { reply: ForumReplyItem; depth: number }[] = [];
    const visit = (item: ForumReplyItem, depth: number) => {
      flattened.push({ reply: item, depth });
      const kids = childrenByParent.get(item.id) || [];
      for (const k of kids) visit(k, Math.min(depth + 1, 3));
    };
    for (const root of roots) visit(root, 0);
    // Catch any orphans if parent wasn't loaded
    const seen = new Set(flattened.map((x) => x.reply.id));
    for (const r of all) {
      if (!seen.has(r.id)) flattened.push({ reply: r, depth: 0 });
    }
    return flattened;
  }, [selectedPost?.replies]);

  if (isGuest) {
    return (
      <div className="mx-auto max-w-2xl py-8">
        <div className="asan-card-hover rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 space-y-4">
          <div className="flex items-start gap-3">
            <Lock className="mt-1 h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                Study Forum, Group Study &amp; Competitive Q&amp;A
              </h1>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Sign in to ask JEE, NEET, ISC, CBSE, and CUET questions, solve peer problems with interactive answer fields, collaborate in study groups or 1-to-1 chats, and earn +{satisfactionReward} points per accepted solution.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={signIn}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Sign in to Join Forum
          </button>
        </div>
      </div>
    );
  }

  const globalRooms = rooms.filter((r) => r.roomType === 'global_qa');
  const groupRooms = rooms.filter((r) => r.roomType === 'group');
  const dmRooms = rooms.filter((r) => r.roomType === 'dm');
  const selectableUsers = toolUsers.filter(
    (u) =>
      u.id !== dbUser?.id &&
      (!userSearch.trim() ||
        u.displayName.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.shortUid.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase()))
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Study Forum &amp; Collaborative Q&amp;A
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
            Global Q&amp;A arena, Study Groups &amp; 1-to-1 Chats · Earn{' '}
            <strong className="text-emerald-700 dark:text-emerald-400 tabular-nums">
              +{satisfactionReward} pts
            </strong>{' '}
            when your peer solution satisfies the question author ({transport.toUpperCase()} sync).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDmModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <MessageCircle className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            1-to-1 Chat
          </button>
          <button
            type="button"
            onClick={() => setGroupModalOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
          >
            <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            New Group
          </button>
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            disabled={!activeRoomId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Ask Question / Post
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-300">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
          {errorMsg}
        </div>
      )}

      {/* Main 3-Panel Grid: Rooms | Feed | Collaborative Thread */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start">
        {/* Rooms Sidebar */}
        <aside className="lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 space-y-4">
          {loadingRooms ? (
            <div className="py-6 text-center text-xs text-slate-500">Loading rooms...</div>
          ) : (
            <>
              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Global Arena
                </div>
                {globalRooms.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setActiveRoomId(r.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                      activeRoomId === r.id
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{r.title}</span>
                    </span>
                    {r.unreadCount > 0 && (
                      <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                        {r.unreadCount}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between px-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Study Groups ({groupRooms.length})
                  </span>
                </div>
                {groupRooms.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] text-slate-400">
                    Create a group to study together.
                  </div>
                ) : (
                  groupRooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setActiveRoomId(r.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                        activeRoomId === r.id
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <Users className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{r.title}</span>
                      </span>
                      <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                        {r.unreadCount > 0 ? `${r.unreadCount} new` : `${r.memberCount}m`}
                      </span>
                    </button>
                  ))
                )}
              </div>

              <div className="space-y-1">
                <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Direct 1-to-1 ({dmRooms.length})
                </div>
                {dmRooms.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] text-slate-400">
                    Start a private 1-to-1 chat with any peer.
                  </div>
                ) : (
                  dmRooms.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setActiveRoomId(r.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
                        activeRoomId === r.id
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-semibold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{r.title}</span>
                      </span>
                      {r.unreadCount > 0 && (
                        <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                          {r.unreadCount}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </>
          )}
        </aside>

        {/* Feed Panel */}
        <section
          className={`${
            selectedPost ? 'hidden lg:block lg:col-span-4' : 'lg:col-span-9'
          } rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4`}
        >
          {activeRoom && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="min-w-0">
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
                  {activeRoom.title}
                </h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {activeRoom.description || activeRoom.subject}
                  {(onlineByRoom[activeRoom.id]?.length || 0) > 0 && (
                    <span className="tabular-nums">
                      {' '}
                      · {onlineByRoom[activeRoom.id].length} online now
                    </span>
                  )}
                </p>
              </div>
              {activeRoom.roomType === 'group' && (
                <button
                  type="button"
                  onClick={() => setAddMemberOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add Members
                </button>
              )}
            </div>
          )}

          {/* Filter Strip */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search questions, topics, @user..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 pl-8 pr-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 dark:bg-slate-800 p-1 text-[11px]">
              {(['all', 'question', 'message'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKindFilter(k)}
                  className={`rounded px-2 py-1 font-medium capitalize ${
                    kindFilter === k
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {k === 'all' ? 'All' : k === 'question' ? 'Questions' : 'Messages'}
                </button>
              ))}
            </div>

            <select
              value={solvedFilter}
              onChange={(e) =>
                setSolvedFilter(e.target.value as 'all' | 'unsolved' | 'solved')
              }
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-[11px] text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Status</option>
              <option value="unsolved">Unsolved</option>
              <option value="solved">Solved</option>
            </select>

            <select
              value={examFilter}
              onChange={(e) => setExamFilter(e.target.value)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-[11px] text-slate-700 dark:text-slate-200"
            >
              <option value="all">All Exams</option>
              <option value="JEE Main">JEE Main</option>
              <option value="JEE Advanced">JEE Advanced</option>
              <option value="NEET UG">NEET UG</option>
              <option value="ISC">ISC</option>
              <option value="CBSE">CBSE</option>
              <option value="CUET">CUET</option>
              <option value="Competitive / Custom">Competitive</option>
            </select>
          </div>

          {/* Posts List */}
          {loadingPosts ? (
            <div className="py-10 text-center text-xs text-slate-500">Loading posts...</div>
          ) : filteredPosts.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <HelpCircle className="mx-auto h-6 w-6 text-slate-400" />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                No questions or messages match here yet. Be the first to ask a question or start a discussion!
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredPosts.map((p) => {
                const isSelected = selectedPost?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => void openPostDetail(p)}
                    className={`w-full py-3.5 px-2.5 text-left transition-colors rounded-lg ${
                      isSelected
                        ? 'bg-blue-50/70 dark:bg-blue-950/40'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          {p.postKind === 'question' ? (
                            <span className="font-semibold text-blue-700 dark:text-blue-400">
                              {p.examBoard || 'Question'}
                            </span>
                          ) : (
                            <span className="font-semibold text-slate-500 dark:text-slate-400">
                              Message
                            </span>
                          )}
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-500 dark:text-slate-400">{p.subject}</span>
                          {p.isSolved && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="h-3 w-3" /> Solved
                              </span>
                            </>
                          )}
                        </div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 line-clamp-2">
                          {p.title}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2">
                          {p.contentText}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                          <span>@{p.author.username}</span>
                          <span aria-hidden="true">·</span>
                          <span>{p.replyCount} replies</span>
                          {p.postKind === 'question' && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{p.attemptCount} attempts</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Thread & Solving Detail Panel */}
        {selectedPost && (
          <section className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <UserAvatarBadge
                  name={selectedPost.author.displayName}
                  photoUrl={selectedPost.author.photoUrl}
                  plan={selectedPost.author.plan}
                  role={selectedPost.author.role}
                  contributorApproved={selectedPost.author.contributorApproved}
                  size="sm"
                />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {selectedPost.author.displayName}
                    </span>
                    <span className="font-mono text-blue-700 dark:text-blue-400">
                      @{selectedPost.author.username}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                      {new Date(selectedPost.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <h2 className="mt-1 font-display text-lg font-bold text-slate-900 dark:text-white">
                    {selectedPost.title}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPost(null)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 shrink-0"
              >
                Close
              </button>
            </div>

            {/* Post Rich Content & Attachments */}
            <SafeHtmlContent html={selectedPost.contentHtml} className="text-sm" />
            <ForumAttachmentGrid attachments={selectedPost.attachments || []} />

            {/* Interactive Question Attempt Card */}
            {selectedPost.postKind === 'question' && selectedPost.questionSpec && (
              <QuestionSolverCard
                post={selectedPost}
                currentUserId={dbUser?.id || null}
                onAttemptSubmitted={(updated) => {
                  setSelectedPost(updated);
                  setPosts((prev) =>
                    prev.map((p) => (p.id === updated.id ? updated : p))
                  );
                }}
              />
            )}

            {/* Live Typing Indicator */}
            {activeTypingUsers.length > 0 && (
              <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                {activeTypingUsers.join(', ')} {activeTypingUsers.length === 1 ? 'is' : 'are'} typing...
              </div>
            )}

            {/* Collaborative Discussion Thread */}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Collaborative Discussion &amp; Solutions ({orderedReplies.length})
                </h3>
              </div>

              {loadingDetail ? (
                <div className="py-4 text-xs text-slate-500">Loading discussion thread...</div>
              ) : orderedReplies.length === 0 ? (
                <p className="py-3 text-xs text-slate-500 dark:text-slate-400">
                  No replies yet. Share your solution approach or build on someone&apos;s idea below.
                </p>
              ) : (
                <div className="space-y-3">
                  {orderedReplies.map(({ reply, depth }) => {
                    const canMarkSatisfactory =
                      selectedPost.postKind === 'question' &&
                      selectedPost.authorId === dbUser?.id &&
                      !selectedPost.isSolved &&
                      reply.authorId !== dbUser?.id;

                    return (
                      <div
                        key={reply.id}
                        style={{ marginLeft: depth > 0 ? `${depth * 18}px` : undefined }}
                        className={`rounded-xl border p-3.5 space-y-2.5 ${
                          reply.isAcceptedSolution
                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/30'
                            : 'border-slate-200 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <UserAvatarBadge
                              name={reply.author.displayName}
                              photoUrl={reply.author.photoUrl}
                              plan={reply.author.plan}
                              role={reply.author.role}
                              contributorApproved={reply.author.contributorApproved}
                              size="sm"
                            />
                            <div className="min-w-0 text-xs">
                              <span className="font-semibold text-slate-900 dark:text-slate-100">
                                {reply.author.displayName}
                              </span>{' '}
                              <span className="font-mono text-blue-700 dark:text-blue-400">
                                @{reply.author.username}
                              </span>{' '}
                              <span className="text-slate-400">·</span>{' '}
                              <span className="capitalize font-medium text-slate-600 dark:text-slate-300">
                                {reply.replyKind}
                              </span>
                            </div>
                          </div>

                          {reply.isAcceptedSolution && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white tabular-nums">
                              <Award className="h-3 w-3" />
                              Satisfactory Answer (+{reply.acceptedPointsAwarded} pts)
                            </span>
                          )}
                        </div>

                        <SafeHtmlContent html={reply.contentHtml} className="text-xs" />
                        <ForumAttachmentGrid attachments={reply.attachments || []} />

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px]">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleVoteReply(reply.id)}
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium transition-colors tabular-nums ${
                                reply.viewerHasUpvoted
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                              }`}
                            >
                              <ThumbsUp className="h-3 w-3" />
                              {reply.upvoteCount}
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setReplyingTo(reply);
                                setReplyKind('refinement');
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                              <CornerDownRight className="h-3 w-3" />
                              Add to Opinion
                            </button>
                          </div>

                          {canMarkSatisfactory && (
                            <button
                              type="button"
                              disabled={satisfyingId === reply.id}
                              onClick={() => void handleMarkSatisfactory(reply)}
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700 disabled:opacity-60 tabular-nums"
                            >
                              <Award className="h-3 w-3" />
                              {satisfyingId === reply.id
                                ? 'Awarding...'
                                : `Mark Satisfactory (+${satisfactionReward} pts)`}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline Collaborative Reply Form */}
              <form
                onSubmit={handleSendReply}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
                    <span>
                      {replyingTo
                        ? `Replying to @${replyingTo.author.username}'s ${replyingTo.replyKind}`
                        : 'Contribute to Thread'}
                    </span>
                    {replyingTo && (
                      <button
                        type="button"
                        onClick={() => setReplyingTo(null)}
                        className="text-[11px] font-normal text-red-600 hover:underline"
                      >
                        Cancel reply target
                      </button>
                    )}
                  </div>
                  <select
                    value={replyKind}
                    onChange={(e) =>
                      setReplyKind(
                        e.target.value as 'solution' | 'opinion' | 'refinement' | 'message'
                      )
                    }
                    className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-[11px] text-slate-800 dark:text-slate-200"
                  >
                    <option value="solution">Proposed Solution</option>
                    <option value="opinion">Approach / Opinion</option>
                    <option value="refinement">Collaborative Refinement</option>
                    <option value="message">Comment / Message</option>
                  </select>
                </div>

                <SummernoteEditor
                  valueHtml={replyHtml}
                  onChangeHtml={setReplyHtml}
                  attachments={replyAttachments}
                  onAttachmentsChange={setReplyAttachments}
                  minHeight={110}
                  placeholder="Write formatted derivation steps, add to a peer's method, or attach solution PDF/images..."
                  onTypingPulse={() => {
                    const now = Date.now();
                    if (activeRoomId && now - lastTypingSentRef.current > 2000) {
                      lastTypingSentRef.current = now;
                      sendTyping(activeRoomId, selectedPost.id, true);
                    }
                  }}
                />

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={sendingReply}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {sendingReply ? 'Posting...' : 'Post Reply'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        )}
      </div>

      {/* Compose Question / Message Modal */}
      {composeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-6 overflow-y-auto">
          <form
            onSubmit={handlePublishPost}
            className="w-full max-w-3xl my-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xl space-y-4 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                  {postKind === 'question'
                    ? 'Ask a Single Competitive / Board Question'
                    : 'Post Formatted Forum Message'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Posting in <strong>{activeRoom?.title}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close composer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {(['question', 'message'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPostKind(k)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize ${
                    postKind === k
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {k === 'question' ? 'Single Question + Answering Field' : 'Discussion Message'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  required
                  value={postTitle}
                  onChange={(e) => setPostTitle(e.target.value)}
                  placeholder="e.g., JEE Adv Electrostatics Sphere Charge Density Question"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 dark:text-slate-300 mb-1">
                  Subject
                </label>
                <input
                  type="text"
                  value={postSubject}
                  onChange={(e) => setPostSubject(e.target.value)}
                  placeholder="Physics / Maths / Chemistry"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                Question / Message Content (Headings, Formatting, Tables, Images &amp; PDFs)
              </label>
              <SummernoteEditor
                valueHtml={postHtml}
                onChangeHtml={setPostHtml}
                attachments={postAttachments}
                onAttachmentsChange={setPostAttachments}
                minHeight={170}
              />
            </div>

            {postKind === 'question' && (
              <QuestionSpecBuilder
                spec={questionSpec}
                answerKey={answerKey}
                officialExplanationHtml={officialExplanationHtml}
                onChangeSpec={setQuestionSpec}
                onChangeAnswerKey={setAnswerKey}
                onChangeOfficialExplanationHtml={setOfficialExplanationHtml}
              />
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setComposeOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-xs font-medium text-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={publishing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
              >
                <Send className="h-3.5 w-3.5" />
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Create Study Group Modal */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <form
            onSubmit={handleCreateGroup}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Create Study Group
              </h2>
              <button type="button" onClick={() => setGroupModalOpen(false)} className="text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              required
              value={groupTitle}
              onChange={(e) => setGroupTitle(e.target.value)}
              placeholder="Group name (e.g. JEE 2027 Physics Prep)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={groupSubject}
              onChange={(e) => setGroupSubject(e.target.value)}
              placeholder="Primary subject (e.g. Physics, Mathematics)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <input
              type="text"
              value={groupDesc}
              onChange={(e) => setGroupDesc(e.target.value)}
              placeholder="Short description..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <div className="space-y-2">
              <input
                type="search"
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search students by @username, UID, or name..."
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
              />
              <div className="max-h-44 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                {selectableUsers.map((u) => {
                  const checked = groupMemberIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <span>
                        <strong>{u.displayName}</strong>{' '}
                        <span className="font-mono text-blue-600 dark:text-blue-400">
                          @{u.username}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setGroupMemberIds((prev) =>
                            checked ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                          )
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGroupModalOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Create Group
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Add Group Members Modal */}
      {addMemberOpen && activeRoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <form
            onSubmit={handleAddGroupMembers}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Add Members to {activeRoom.title}
              </h2>
              <button type="button" onClick={() => setAddMemberOpen(false)} className="text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search students..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100"
            />
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
              {selectableUsers.map((u) => {
                const checked = addMemberIds.includes(u.id);
                return (
                  <label
                    key={u.id}
                    className="flex items-center justify-between px-3 py-2 text-xs cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    <span>
                      <strong>{u.displayName}</strong> @{u.username}
                    </span>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAddMemberIds((prev) =>
                          checked ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                        )
                      }
                    />
                  </label>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddMemberOpen(false)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={addMemberIds.length === 0}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                Add Selected
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Direct 1-to-1 Chat Modal */}
      {dmModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-base font-bold text-slate-900 dark:text-white">
                Start 1-to-1 Direct Study Chat
              </h2>
              <button type="button" onClick={() => setDmModalOpen(false)} className="text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search student by name, @username, UID, or email..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100"
            />
            <div className="max-h-60 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
              {selectableUsers.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-500">No matching users found.</div>
              ) : (
                selectableUsers.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => void handleStartDm(u.id)}
                    className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs hover:bg-blue-50 dark:hover:bg-slate-800"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <UserAvatarBadge
                        name={u.displayName}
                        photoUrl={u.photoUrl}
                        plan={u.plan}
                        role={u.role}
                        contributorApproved={u.contributorApproved}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {u.displayName}
                        </div>
                        <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400">
                          @{u.username} · {u.shortUid}
                        </div>
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-blue-600 dark:text-blue-400 shrink-0">
                      Chat
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
