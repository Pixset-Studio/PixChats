import { getSupabaseClient } from '@pixchats/core';

const EMOJI_STATUS_STORAGE_KEY = 'pixchats:emoji_status_map:v1';
const EMOJI_STATUS_BUCKET = 'message-media';
const EMOJI_STATUS_CLOUD_PREFIX = 'emoji-status/users';

export const EMOJI_STATUS_PRESETS: Array<{ emoji: string; label: string }> = [
  { emoji: '🔥', label: 'В ударе' },
  { emoji: '⚡', label: 'В сети / Активен' },
  { emoji: '💻', label: 'За кодом' },
  { emoji: '🎮', label: 'В игре' },
  { emoji: '🎧', label: 'Слушаю музыку' },
  { emoji: '🚀', label: 'Запускаю проект' },
  { emoji: '☕', label: 'На перерыве' },
  { emoji: '🌙', label: 'Не беспокоить' },
  { emoji: '🏖️', label: 'В отпуске' },
  { emoji: '💎', label: 'VIP статус' },
  { emoji: '👑', label: 'Королевский' },
  { emoji: '❤️', label: 'Любовь' },
  { emoji: '🇷🇺', label: 'Россия' },
  { emoji: '🇰🇿', label: 'Казахстан' },
  { emoji: '🇧🇾', label: 'Беларусь' },
  { emoji: '🇺🇦', label: 'Украина' },
  { emoji: '🇺🇸', label: 'США' },
  { emoji: '🇩🇪', label: 'Германия' },
  { emoji: '🇯🇵', label: 'Япония' },
  { emoji: '🇰🇷', label: 'Корея' },
];

export const PRESET_EMOJI_STATUSES = EMOJI_STATUS_PRESETS;

type EmojiStatusMap = Record<string, string>; // key can be userId or @username (lowercase)

let memoryCache: EmojiStatusMap | null = null;
let cloudSyncInProgress = false;
let lastCloudSyncAt = 0;

function readLocalMap(): EmojiStatusMap {
  if (memoryCache) return memoryCache;
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(EMOJI_STATUS_STORAGE_KEY);
    if (!raw) {
      memoryCache = {};
      return memoryCache;
    }
    const parsed = JSON.parse(raw);
    memoryCache = parsed && typeof parsed === 'object' ? parsed : {};
    return memoryCache!;
  } catch {
    memoryCache = {};
    return memoryCache;
  }
}

function writeLocalMap(map: EmojiStatusMap): void {
  memoryCache = { ...map };
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(EMOJI_STATUS_STORAGE_KEY, JSON.stringify(memoryCache));
    window.dispatchEvent(new CustomEvent('pixchats-emoji-status-changed', { detail: memoryCache }));
  } catch {
    // ignore
  }
}

export function getUserEmojiStatus(userId?: string | null, username?: string | null): string | null {
  const map = readLocalMap();
  if (userId && map[userId]) return map[userId];
  if (username) {
    const clean = username.replace(/^@/, '').toLowerCase();
    if (map[`@${clean}`]) return map[`@${clean}`];
  }
  return null;
}

const EMOJI_STATUS_MANIFEST_PATH = 'emoji-status/all_statuses.json';

export async function setUserEmojiStatus(
  userId: string,
  emoji: string | null,
  username?: string | null
): Promise<void> {
  if (!userId) return;
  const map = { ...readLocalMap() };
  const cleanEmoji = (emoji || '').trim();
  const cleanUsername = username ? `@${username.replace(/^@/, '').toLowerCase()}` : null;

  if (cleanEmoji) {
    map[userId] = cleanEmoji;
    if (cleanUsername) map[cleanUsername] = cleanEmoji;
  } else {
    delete map[userId];
    if (cleanUsername) delete map[cleanUsername];
  }
  writeLocalMap(map);

  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(map)], { type: 'application/json' });
    await supabase.storage
      .from(EMOJI_STATUS_BUCKET)
      .upload(EMOJI_STATUS_MANIFEST_PATH, blob, {
        upsert: true,
        contentType: 'application/json',
        cacheControl: '300',
      });

    const channel = supabase.channel('pixchats-emoji-status-sync');
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channel
          .send({
            type: 'broadcast',
            event: 'emoji-status-update',
            payload: { userId, username: cleanUsername, emoji: cleanEmoji || null },
          })
          .finally(() => {
            setTimeout(() => supabase.removeChannel(channel), 400);
          });
      }
    });
  } catch {
    // Ignore cloud storage fallback errors
  }
}

export async function syncAllEmojiStatusesFromCloud(force = false): Promise<EmojiStatusMap> {
  const now = Date.now();
  // Throttle to once per 30 minutes unless forced (Realtime broadcast handles live updates)
  if (!force && (cloudSyncInProgress || now - lastCloudSyncAt < 30 * 60 * 1000)) {
    return readLocalMap();
  }
  cloudSyncInProgress = true;
  lastCloudSyncAt = now;
  try {
    const supabase = getSupabaseClient();
    const { data } = supabase.storage
      .from(EMOJI_STATUS_BUCKET)
      .getPublicUrl(EMOJI_STATUS_MANIFEST_PATH);
    if (!data?.publicUrl) {
      return readLocalMap();
    }
    const res = await fetch(data.publicUrl);
    if (!res.ok) return readLocalMap();
    const remoteMap = await res.json();
    if (remoteMap && typeof remoteMap === 'object') {
      const updated = { ...readLocalMap(), ...remoteMap };
      writeLocalMap(updated);
      return updated;
    }
    return readLocalMap();
  } catch {
    return readLocalMap();
  } finally {
    cloudSyncInProgress = false;
  }
}
