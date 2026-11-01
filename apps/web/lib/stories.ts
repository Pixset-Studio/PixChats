import { getSupabaseClient } from '@pixchats/core';

export interface StoryItem {
  id: string;
  userId: string; // For channel stories: `channel:${channelId}` so stories group by channel
  authorUserId?: string;
  channelId?: string;
  isChannelStory?: boolean;
  userName: string;
  userUsername: string;
  userAvatar: string | null;
  isVerified?: boolean;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | 'none';
  videoMuted?: boolean;
  filterCss?: string;
  overlayText?: string;
  overlayColor?: string;
  overlaySize?: number;
  overlayY?: number;
  overlayBg?: boolean;
  drawingDataUrl?: string | null;
  bgGradient: string;
  text: string;
  privacy: 'all' | 'friends';
  createdAt: string;
  expiresAt: string;
  viewers: string[];
  reactions: Record<string, string[]>; // emoji -> array of userIds
}

export const MAX_REACTIONS_PER_STORY_USER = 3;

const STORIES_STORAGE_KEY = 'pixchats:stories:v2';
const STORIES_VIEWED_KEY = 'pixchats:stories_viewed:v1';
const STORIES_BUCKET = 'message-media';
const STORIES_REMOTE_PATH = 'stories/active_stories.json';
const STORIES_LEGACY_PATH = 'stories/active_stories_v1.json';
const STORIES_ITEMS_FOLDER = 'stories/items';
const STORY_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours

export const STORY_GRADIENTS = [
  { id: 'gold', label: 'Золото Pix', css: 'linear-gradient(135deg, #1a1500 0%, #5c4900 50%, #ffd400 100%)' },
  { id: 'cyber', label: 'Киберпанк', css: 'linear-gradient(135deg, #090d16 0%, #3b0764 50%, #ec4899 100%)' },
  { id: 'emerald', label: 'Изумруд', css: 'linear-gradient(135deg, #052e16 0%, #065f46 50%, #10b981 100%)' },
  { id: 'ocean', label: 'Океан', css: 'linear-gradient(135deg, #082f49 0%, #0284c7 50%, #38bdf8 100%)' },
  { id: 'sunset', label: 'Закат', css: 'linear-gradient(135deg, #450a0a 0%, #c2410c 50%, #facc15 100%)' },
];

export const STORY_FILTERS = [
  { id: 'none', label: 'Оригинал', css: 'none' },
  { id: 'vivid', label: 'Яркий', css: 'saturate(1.45) contrast(1.12)' },
  { id: 'warm', label: 'Тёплый', css: 'sepia(0.28) saturate(1.35) brightness(1.05)' },
  { id: 'cool', label: 'Холодный', css: 'hue-rotate(18deg) saturate(1.15) contrast(1.08)' },
  { id: 'bw', label: 'Ч/Б Нуар', css: 'grayscale(1) contrast(1.25)' },
  { id: 'vintage', label: 'Винтаж', css: 'sepia(0.55) contrast(0.95) brightness(1.04)' },
  { id: 'cyber', label: 'Неон', css: 'hue-rotate(-25deg) saturate(1.65) contrast(1.15)' },
];

function normalizeStoryItem(raw: any): StoryItem | null {
  if (!raw || typeof raw.id !== 'string' || !raw.expiresAt) return null;
  const userName = raw.userName || raw.displayName || 'Пользователь';
  const userUsername = raw.userUsername || raw.username || 'user';
  const userAvatar = raw.userAvatar !== undefined ? raw.userAvatar : raw.avatarUrl || null;
  const text = typeof raw.text === 'string' ? raw.text : typeof raw.caption === 'string' ? raw.caption : '';
  const viewers = Array.isArray(raw.viewers)
    ? raw.viewers
    : Array.isArray(raw.viewerIds)
      ? raw.viewerIds
      : [];

  return {
    id: raw.id,
    userId: raw.userId || raw.authorUserId || 'unknown',
    authorUserId: raw.authorUserId || raw.userId,
    channelId: raw.channelId,
    isChannelStory: Boolean(raw.isChannelStory || (typeof raw.userId === 'string' && raw.userId.startsWith('channel:'))),
    userName,
    userUsername,
    userAvatar,
    isVerified: Boolean(raw.isVerified),
    mediaUrl: raw.mediaUrl || null,
    mediaType: raw.mediaType || (raw.mediaUrl ? 'image' : 'none'),
    videoMuted: Boolean(raw.videoMuted || raw.mutedAudio),
    filterCss: raw.filterCss,
    overlayText: raw.overlayText,
    overlayColor: raw.overlayColor,
    overlaySize: raw.overlaySize,
    overlayY: raw.overlayY,
    overlayBg: raw.overlayBg,
    drawingDataUrl: raw.drawingDataUrl || null,
    bgGradient: raw.bgGradient || STORY_GRADIENTS[0].css,
    text,
    privacy: raw.privacy === 'friends' ? 'friends' : 'all',
    createdAt: raw.createdAt || new Date().toISOString(),
    expiresAt: raw.expiresAt,
    viewers: Array.from(new Set(viewers)),
    reactions: raw.reactions && typeof raw.reactions === 'object' ? raw.reactions : {},
  };
}

function filterActive(items: any[]): StoryItem[] {
  const now = Date.now();
  const byId = new Map<string, StoryItem>();

  for (const raw of items) {
    const item = normalizeStoryItem(raw);
    if (!item) continue;
    const exp = new Date(item.expiresAt).getTime();
    if (!Number.isFinite(exp) || exp <= now) continue;

    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
    } else {
      const mergedViewers = Array.from(new Set([...existing.viewers, ...item.viewers]));
      const mergedReactions: Record<string, string[]> = { ...existing.reactions };
      for (const [emoji, uIds] of Object.entries(item.reactions || {})) {
        if (Array.isArray(uIds) && uIds.length > 0) {
          mergedReactions[emoji] = uIds;
        }
      }
      byId.set(item.id, {
        ...existing,
        ...item,
        viewers: mergedViewers,
        reactions: Object.keys(mergedReactions).length > 0 ? mergedReactions : item.reactions,
      });
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getCachedStories(): StoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? filterActive(parsed) : [];
  } catch {
    return [];
  }
}

function saveCachedStories(items: StoryItem[]): StoryItem[] {
  const active = filterActive(items);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORIES_STORAGE_KEY, JSON.stringify(active));
      window.dispatchEvent(new CustomEvent('pixchats:stories_updated', { detail: { stories: active } }));
    } catch {
      // ignore
    }
  }
  return active;
}

export function getViewedStoryIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(STORIES_VIEWED_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function markStoryViewedLocal(storyId: string): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getViewedStoryIds();
    current.add(storyId);
    window.localStorage.setItem(STORIES_VIEWED_KEY, JSON.stringify(Array.from(current)));
  } catch {
    // ignore
  }
}

async function saveSingleStoryItemToCloud(story: StoryItem): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(story)], { type: 'application/json' });
    await supabase.storage
      .from(STORIES_BUCKET)
      .upload(`${STORIES_ITEMS_FOLDER}/${story.id}.json`, blob, {
        upsert: true,
        contentType: 'application/json',
        cacheControl: '0',
      });
  } catch {
    // ignore
  }
}

export async function loadActiveStories(): Promise<StoryItem[]> {
  const local = getCachedStories();
  try {
    const supabase = getSupabaseClient();
    const cacheBust = Date.now();

    // 1. Load individual story objects in stories/items/*.json so stories from ALL users & channels
    // are always visible without being blocked by single-file RLS overwrite limits.
    const itemsFolderPromise = supabase.storage
      .from(STORIES_BUCKET)
      .list(STORIES_ITEMS_FOLDER, {
        limit: 100,
        sortBy: { column: 'created_at', order: 'desc' },
      })
      .then(async ({ data: files }) => {
        if (!files || files.length === 0) return [];
        const jsonFiles = files.filter((f) => f.name && f.name.endsWith('.json')).slice(0, 80);
        const loaded = await Promise.all(
          jsonFiles.map(async (f) => {
            try {
              const { data } = supabase.storage
                .from(STORIES_BUCKET)
                .getPublicUrl(`${STORIES_ITEMS_FOLDER}/${f.name}`);
              if (!data?.publicUrl) return null;
              const res = await fetch(`${data.publicUrl}?t=${cacheBust}`, { cache: 'no-store' });
              if (!res.ok) return null;
              return await res.json();
            } catch {
              return null;
            }
          })
        );
        return loaded.filter(Boolean);
      })
      .catch(() => []);

    // 2. Load shared index files (active_stories.json and active_stories_v1.json)
    const fetchIndexFile = async (path: string) => {
      try {
        const { data } = supabase.storage.from(STORIES_BUCKET).getPublicUrl(path);
        if (!data?.publicUrl) return [];
        const resp = await fetch(`${data.publicUrl}?t=${cacheBust}`, { cache: 'no-store' });
        if (!resp.ok) return [];
        const json = await resp.json();
        return Array.isArray(json) ? json : [];
      } catch {
        return [];
      }
    };

    const [fromFolder, fromMainIndex, fromLegacyIndex] = await Promise.all([
      itemsFolderPromise,
      fetchIndexFile(STORIES_REMOTE_PATH),
      fetchIndexFile(STORIES_LEGACY_PATH),
    ]);

    const merged = filterActive([...local, ...fromLegacyIndex, ...fromMainIndex, ...fromFolder]);
    return saveCachedStories(merged);
  } catch {
    return local;
  }
}

async function persistStoriesToCloud(stories: StoryItem[]): Promise<void> {
  const active = saveCachedStories(stories);
  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(active)], { type: 'application/json' });
    await supabase.storage.from(STORIES_BUCKET).upload(STORIES_REMOTE_PATH, blob, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '0',
    });

    const channel = supabase.channel('pixchats-stories-global');
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        void channel
          .send({
            type: 'broadcast',
            event: 'stories-sync',
            payload: { stories: active },
          })
          .finally(() => {
            setTimeout(() => {
              supabase.removeChannel(channel);
            }, 350);
          });
      }
    });
  } catch {
    // Local cache is already updated
  }
}

export async function publishNewStory(params: {
  userId: string;
  authorUserId?: string;
  channelId?: string;
  isChannelStory?: boolean;
  userName: string;
  userUsername: string;
  userAvatar: string | null;
  isVerified?: boolean;
  mediaUrl?: string | null;
  mediaType?: 'image' | 'video' | 'none';
  videoMuted?: boolean;
  filterCss?: string;
  overlayText?: string;
  overlayColor?: string;
  overlaySize?: number;
  overlayY?: number;
  overlayBg?: boolean;
  drawingDataUrl?: string | null;
  bgGradient: string;
  text: string;
  privacy: 'all' | 'friends';
}): Promise<StoryItem> {
  const now = new Date();
  const expires = new Date(now.getTime() + STORY_LIFETIME_MS);
  const effectiveUserId =
    params.isChannelStory && params.channelId ? `channel:${params.channelId}` : params.userId;

  const newStory: StoryItem = {
    id: `story_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: effectiveUserId,
    authorUserId: params.authorUserId || params.userId,
    channelId: params.channelId,
    isChannelStory: Boolean(params.isChannelStory && params.channelId),
    userName: params.userName,
    userUsername: params.userUsername,
    userAvatar: params.userAvatar,
    isVerified: params.isVerified,
    mediaUrl: params.mediaUrl || null,
    mediaType: params.mediaType || (params.mediaUrl ? 'image' : 'none'),
    videoMuted: params.videoMuted,
    filterCss: params.filterCss,
    overlayText: params.overlayText,
    overlayColor: params.overlayColor,
    overlaySize: params.overlaySize,
    overlayY: params.overlayY,
    overlayBg: params.overlayBg,
    drawingDataUrl: params.drawingDataUrl || null,
    bgGradient: params.bgGradient || STORY_GRADIENTS[0].css,
    text: params.text.trim(),
    privacy: params.privacy,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    viewers: [params.authorUserId || params.userId],
    reactions: {},
  };

  // Save as dedicated per-story file in stories/items/ so all users discover it reliably
  await saveSingleStoryItemToCloud(newStory);

  const current = await loadActiveStories();
  const updated = [newStory, ...current];
  await persistStoriesToCloud(updated);
  return newStory;
}

export async function deleteStoryById(storyId: string): Promise<StoryItem[]> {
  try {
    const supabase = getSupabaseClient();
    await supabase.storage.from(STORIES_BUCKET).remove([`${STORIES_ITEMS_FOLDER}/${storyId}.json`]);
  } catch {
    // ignore
  }
  const current = await loadActiveStories();
  const updated = current.filter((s) => s.id !== storyId);
  await persistStoriesToCloud(updated);
  return updated;
}

export async function recordStoryView(storyId: string, viewerUserId: string): Promise<void> {
  markStoryViewedLocal(storyId);
  const current = getCachedStories();
  let changed = false;
  let updatedItem: StoryItem | null = null;

  const updated = current.map((s) => {
    if (s.id !== storyId) return s;
    if (s.viewers.includes(viewerUserId)) return s;
    changed = true;
    updatedItem = { ...s, viewers: [...s.viewers, viewerUserId] };
    return updatedItem;
  });

  if (changed && updatedItem) {
    await saveSingleStoryItemToCloud(updatedItem);
    await persistStoriesToCloud(updated);
  }
}

export function countUserReactionsOnStory(story: StoryItem, userId: string): number {
  const reactions = story.reactions || {};
  let count = 0;
  for (const list of Object.values(reactions)) {
    if (Array.isArray(list) && list.includes(userId)) {
      count++;
    }
  }
  return count;
}

export async function toggleStoryReaction(
  storyId: string,
  emoji: string,
  userId: string,
  options?: { isDeveloper?: boolean; onLimitReached?: () => void }
): Promise<StoryItem[]> {
  const current = await loadActiveStories();
  let updatedItem: StoryItem | null = null;
  let limitReached = false;

  const updated = current.map((s) => {
    if (s.id !== storyId) return s;
    const reactions = { ...(s.reactions || {}) };
    const existing = Array.isArray(reactions[emoji]) ? [...reactions[emoji]] : [];
    const alreadyReacted = existing.includes(userId);

    if (!alreadyReacted && !options?.isDeveloper) {
      const myTotalReactions = countUserReactionsOnStory(s, userId);
      if (myTotalReactions >= MAX_REACTIONS_PER_STORY_USER) {
        limitReached = true;
        return s;
      }
    }

    if (alreadyReacted) {
      reactions[emoji] = existing.filter((id) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...existing, userId];
    }
    updatedItem = { ...s, reactions };
    return updatedItem;
  });

  if (limitReached) {
    options?.onLimitReached?.();
    return current;
  }

  if (updatedItem) {
    await saveSingleStoryItemToCloud(updatedItem);
  }
  await persistStoriesToCloud(updated);
  return updated;
}
