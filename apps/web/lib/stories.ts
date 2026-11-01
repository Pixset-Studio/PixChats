import { getSupabaseClient } from '@pixchats/core';

export interface StoryItem {
  id: string;
  userId: string;
  userName: string;
  userUsername: string;
  userAvatar: string | null;
  isVerified?: boolean;
  mediaUrl: string | null;
  bgGradient: string;
  text: string;
  privacy: 'all' | 'friends';
  createdAt: string;
  expiresAt: string;
  reactions: Record<string, string[]>;
  viewers: string[];
}

const STORIES_LOCAL_KEY = 'pixchats:stories_v1';
const VIEWED_STORIES_KEY = 'pixchats:viewed_stories_v1';
const STORIES_STORAGE_PATH = 'stories/active_stories_v1.json';

export const STORY_GRADIENTS = [
  {
    id: 'gold-noir',
    label: '⚡ Фирменный PixChats',
    css: 'linear-gradient(135deg, #1a1600 0%, #3d3100 45%, #ffd400 100%)',
  },
  {
    id: 'cyber-violet',
    label: '🔮 Неоновый киберпанк',
    css: 'linear-gradient(135deg, #0f0728 0%, #4c1d95 55%, #ec4899 100%)',
  },
  {
    id: 'emerald-glow',
    label: 'emerald Изумрудный шторм',
    css: 'linear-gradient(135deg, #041f18 0%, #059669 55%, #34d399 100%)',
  },
  {
    id: 'crimson-sunset',
    label: '🔥 Огненный закат',
    css: 'linear-gradient(135deg, #2a0808 0%, #dc2626 55%, #f59e0b 100%)',
  },
  {
    id: 'deep-ocean',
    label: '🌊 Глубокий космос',
    css: 'linear-gradient(135deg, #06122e 0%, #1d4ed8 55%, #38bdf8 100%)',
  },
];

function filterNonExpired(stories: StoryItem[]): StoryItem[] {
  const now = Date.now();
  return stories
    .filter((s) => s && s.id && s.expiresAt && new Date(s.expiresAt).getTime() > now)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function getCachedStories(): StoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORIES_LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? filterNonExpired(parsed) : [];
  } catch {
    return [];
  }
}

export function saveCachedStories(stories: StoryItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    const valid = filterNonExpired(stories);
    localStorage.setItem(STORIES_LOCAL_KEY, JSON.stringify(valid));
  } catch {}
}

export function getViewedStoryIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(VIEWED_STORIES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function markStoryViewedLocal(storyId: string): void {
  if (typeof window === 'undefined' || !storyId) return;
  try {
    const set = getViewedStoryIds();
    set.add(storyId);
    localStorage.setItem(VIEWED_STORIES_KEY, JSON.stringify(Array.from(set).slice(-500)));
  } catch {}
}

async function fetchRemoteStoriesFile(): Promise<StoryItem[]> {
  try {
    const supabase = getSupabaseClient();
    const { data } = supabase.storage.from('message-media').getPublicUrl(STORIES_STORAGE_PATH);
    if (!data?.publicUrl) return [];
    const res = await fetch(`${data.publicUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json) ? filterNonExpired(json) : [];
  } catch {
    return [];
  }
}

async function persistRemoteStoriesFile(stories: StoryItem[]): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const valid = filterNonExpired(stories).slice(0, 120);
    const blob = new Blob([JSON.stringify(valid)], { type: 'application/json' });
    await supabase.storage.from('message-media').upload(STORIES_STORAGE_PATH, blob, {
      upsert: true,
      contentType: 'application/json',
    });
  } catch {}
}

export async function loadActiveStories(): Promise<StoryItem[]> {
  const local = getCachedStories();
  const remote = await fetchRemoteStoriesFile();

  const mergedMap = new Map<string, StoryItem>();
  for (const s of [...local, ...remote]) {
    const existing = mergedMap.get(s.id);
    if (!existing) {
      mergedMap.set(s.id, s);
    } else {
      // Объединяем реакции и просмотры
      const mergedReactions: Record<string, string[]> = { ...(existing.reactions || {}) };
      for (const [emoji, users] of Object.entries(s.reactions || {})) {
        const set = new Set([...(mergedReactions[emoji] || []), ...(users || [])]);
        mergedReactions[emoji] = Array.from(set);
      }
      const viewersSet = new Set([...(existing.viewers || []), ...(s.viewers || [])]);
      mergedMap.set(s.id, {
        ...existing,
        ...s,
        reactions: mergedReactions,
        viewers: Array.from(viewersSet),
      });
    }
  }

  const merged = filterNonExpired(Array.from(mergedMap.values()));
  saveCachedStories(merged);
  return merged;
}

export async function publishNewStory(params: {
  userId: string;
  userName: string;
  userUsername: string;
  userAvatar: string | null;
  isVerified?: boolean;
  mediaUrl: string | null;
  bgGradient: string;
  text: string;
  privacy: 'all' | 'friends';
}): Promise<StoryItem> {
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const newStory: StoryItem = {
    id: `story-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    userName: params.userName,
    userUsername: params.userUsername,
    userAvatar: params.userAvatar,
    isVerified: params.isVerified,
    mediaUrl: params.mediaUrl,
    bgGradient: params.bgGradient,
    text: params.text.trim(),
    privacy: params.privacy,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    reactions: {},
    viewers: [params.userId],
  };

  const current = await loadActiveStories();
  const updated = [newStory, ...current];
  saveCachedStories(updated);
  await persistRemoteStoriesFile(updated);
  broadcastStoriesSync(updated);
  return newStory;
}

export async function deleteStoryById(storyId: string): Promise<StoryItem[]> {
  const current = await loadActiveStories();
  const updated = current.filter((s) => s.id !== storyId);
  saveCachedStories(updated);
  await persistRemoteStoriesFile(updated);
  broadcastStoriesSync(updated);
  return updated;
}

export async function toggleStoryReaction(storyId: string, emoji: string, userId: string): Promise<StoryItem[]> {
  const current = getCachedStories();
  const updated = current.map((s) => {
    if (s.id !== storyId) return s;
    const reactions = { ...(s.reactions || {}) };
    const list = reactions[emoji] || [];
    if (list.includes(userId)) {
      reactions[emoji] = list.filter((id) => id !== userId);
      if (reactions[emoji].length === 0) delete reactions[emoji];
    } else {
      reactions[emoji] = [...list, userId];
    }
    return { ...s, reactions };
  });
  saveCachedStories(updated);
  void persistRemoteStoriesFile(updated);
  broadcastStoriesSync(updated);
  return updated;
}

export async function recordStoryView(storyId: string, viewerId: string): Promise<StoryItem[]> {
  markStoryViewedLocal(storyId);
  const current = getCachedStories();
  let changed = false;
  const updated = current.map((s) => {
    if (s.id !== storyId) return s;
    const viewers = s.viewers || [];
    if (viewers.includes(viewerId)) return s;
    changed = true;
    return { ...s, viewers: [...viewers, viewerId] };
  });
  if (changed) {
    saveCachedStories(updated);
    void persistRemoteStoriesFile(updated);
    broadcastStoriesSync(updated);
  }
  return updated;
}

function broadcastStoriesSync(stories: StoryItem[]): void {
  try {
    const supabase = getSupabaseClient();
    const channel = supabase.channel('pixchats-stories-global');
    channel.subscribe((st) => {
      if (st === 'SUBSCRIBED') {
        channel
          .send({
            type: 'broadcast',
            event: 'stories-sync',
            payload: { stories: stories.slice(0, 50) },
          })
          .then(() => {
            setTimeout(() => supabase.removeChannel(channel), 800);
          });
      }
    });
  } catch {}
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pixchats:stories_updated', { detail: { stories } }));
  }
}
