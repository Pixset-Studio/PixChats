'use client';

export interface ChatTopicItem {
  id: string;
  title: string;
  icon: string;
}

export interface ChannelGroupConfig {
  commentsEnabled: boolean; // Для каналов: разрешены ли комментарии под постами
  requireJoinApproval?: boolean; // Вход только по заявкам (рассматриваются админом)
  structureMode: 'standard' | 'topics'; // Обычный или С темами (Топиками)
  topics: ChatTopicItem[];
}

export interface JoinRequestItem {
  id: string;
  chatId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  message?: string;
  createdAt: string;
}

export interface PostCommentItem {
  id: string;
  postId: string;
  userId: string;
  userName: string;
  text: string;
  createdAt: string;
}

export const DEFAULT_TOPICS: ChatTopicItem[] = [
  { id: 'general', title: 'Общее', icon: '💬' },
  { id: 'news', title: 'Новости', icon: '📢' },
  { id: 'discussion', title: 'Обсуждение', icon: '🔥' },
];

export const DEFAULT_CHANNEL_GROUP_CONFIG: ChannelGroupConfig = {
  commentsEnabled: false,
  requireJoinApproval: false,
  structureMode: 'standard',
  topics: DEFAULT_TOPICS,
};

const CFG_MARKER_START = '<!--PIXCFG:';
const CFG_MARKER_END = '-->';

/**
 * Извлекает чистое описание чата/канала и встроенные создателем настройки (комментарии и темы).
 * Хранение внутри description позволяет синхронизировать настройки канала/группы между всеми
 * подписчиками и участниками через Supabase без изменения SQL-схемы БД.
 */
export function parseChatDescriptionAndConfig(rawDescription?: string | null): {
  cleanDescription: string;
  config: ChannelGroupConfig;
} {
  if (!rawDescription) {
    return {
      cleanDescription: '',
      config: { ...DEFAULT_CHANNEL_GROUP_CONFIG, topics: [...DEFAULT_TOPICS] },
    };
  }

  const startIdx = rawDescription.indexOf(CFG_MARKER_START);
  if (startIdx === -1) {
    return {
      cleanDescription: rawDescription,
      config: { ...DEFAULT_CHANNEL_GROUP_CONFIG, topics: [...DEFAULT_TOPICS] },
    };
  }

  const endIdx = rawDescription.indexOf(CFG_MARKER_END, startIdx);
  const cleanDescription = rawDescription.slice(0, startIdx).trim();

  if (endIdx === -1) {
    return {
      cleanDescription,
      config: { ...DEFAULT_CHANNEL_GROUP_CONFIG, topics: [...DEFAULT_TOPICS] },
    };
  }

  const jsonStr = rawDescription.slice(startIdx + CFG_MARKER_START.length, endIdx);
  try {
    const parsed = JSON.parse(jsonStr);
    return {
      cleanDescription,
      config: {
        commentsEnabled: typeof parsed.commentsEnabled === 'boolean' ? parsed.commentsEnabled : false,
        requireJoinApproval: typeof parsed.requireJoinApproval === 'boolean' ? parsed.requireJoinApproval : false,
        structureMode: parsed.structureMode === 'topics' ? 'topics' : 'standard',
        topics:
          Array.isArray(parsed.topics) && parsed.topics.length > 0
            ? parsed.topics
            : [...DEFAULT_TOPICS],
      },
    };
  } catch {
    return {
      cleanDescription,
      config: { ...DEFAULT_CHANNEL_GROUP_CONFIG, topics: [...DEFAULT_TOPICS] },
    };
  }
}

/**
 * Кодирует описание чата/канала вместе с настройками создателя (комментарии + темы + заявки на вступление).
 */
export function encodeChatDescriptionWithConfig(
  cleanDescription: string,
  config: ChannelGroupConfig
): string {
  const payload = JSON.stringify({
    commentsEnabled: config.commentsEnabled,
    requireJoinApproval: config.requireJoinApproval ?? false,
    structureMode: config.structureMode,
    topics: config.topics,
  });
  const trimmed = cleanDescription.trim();
  return trimmed
    ? `${trimmed}\n${CFG_MARKER_START}${payload}${CFG_MARKER_END}`
    : `${CFG_MARKER_START}${payload}${CFG_MARKER_END}`;
}

/**
 * Кодирование и декодирование привязки сообщения к теме (Топику): `[TOPIC:id]Текст`
 */
const TOPIC_PREFIX_REGEX = /^\[TOPIC:([a-zA-Z0-9_-]+)\]/;

export function encodeTopicPrefix(topicId: string, text: string): string {
  if (!topicId || topicId === 'all') return text;
  return `[TOPIC:${topicId}]${text}`;
}

export function extractTopicFromText(rawText: string): {
  topicId: string | null;
  cleanText: string;
} {
  if (!rawText) return { topicId: null, cleanText: '' };
  const match = rawText.match(TOPIC_PREFIX_REGEX);
  if (!match) return { topicId: null, cleanText: rawText };
  return {
    topicId: match[1],
    cleanText: rawText.slice(match[0].length),
  };
}

/**
 * Кодирование и декодирование комментариев к постам канала через реакции/события `💬:...`,
 * чтобы даже подписчики с ролью `subscriber` могли оставлять комментарии в реальном времени!
 */
const COMMENT_REACTION_PREFIX = '💬:';

export function encodePostCommentPayload(comment: {
  id: string;
  userName: string;
  text: string;
  createdAt: string;
}): string {
  return `${COMMENT_REACTION_PREFIX}${JSON.stringify(comment)}`;
}

export function extractPostCommentsFromReactions(
  postId: string,
  msgReactions: Record<string, string[]>
): PostCommentItem[] {
  const list: PostCommentItem[] = [];
  for (const [key, userIds] of Object.entries(msgReactions || {})) {
    if (!key.startsWith(COMMENT_REACTION_PREFIX)) continue;
    if (!userIds || userIds.length === 0) continue;
    try {
      const parsed = JSON.parse(key.slice(COMMENT_REACTION_PREFIX.length));
      if (parsed && parsed.text) {
        list.push({
          id: parsed.id || `${postId}-${parsed.createdAt}`,
          postId,
          userId: userIds[0],
          userName: parsed.userName || 'Подписчик',
          text: parsed.text,
          createdAt: parsed.createdAt || new Date().toISOString(),
        });
      }
    } catch {}
  }
  return list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

export function getJoinRequests(chatId: string): JoinRequestItem[] {
  if (typeof window === 'undefined' || !chatId) return [];
  try {
    const raw = localStorage.getItem(`pixchats:join_requests:${chatId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function saveJoinRequest(request: JoinRequestItem): void {
  if (typeof window === 'undefined' || !request.chatId) return;
  try {
    const list = getJoinRequests(request.chatId);
    if (!list.some((r) => r.userId === request.userId)) {
      list.push(request);
      localStorage.setItem(`pixchats:join_requests:${request.chatId}`, JSON.stringify(list));
      window.dispatchEvent(new CustomEvent('pixchats:join_requests_changed', { detail: { chatId: request.chatId } }));
    }
  } catch {}
}

export function removeJoinRequest(chatId: string, userId: string): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    const list = getJoinRequests(chatId).filter((r) => r.userId !== userId);
    localStorage.setItem(`pixchats:join_requests:${chatId}`, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('pixchats:join_requests_changed', { detail: { chatId } }));
  } catch {}
}
