import {
  getSupabaseClient,
  parseProfileUserEnvelope,
  updateProfileUserEnvelope,
  type Profile,
} from '@pixchats/core';

const EMOJI_STATUS_STORAGE_KEY = 'pixchats:emoji_status_map:v1';

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

export function hydrateEmojiStatusFromProfileRow(row?: Partial<Profile> | null): void {
  if (!row || !row.id || typeof window === 'undefined') return;
  if (typeof row.signed_prekey_signature !== 'string' || !row.signed_prekey_signature.startsWith('pxext:v1:')) {
    return;
  }
  const env = parseProfileUserEnvelope(row.signed_prekey_signature);
  if (env.emojiStatus === undefined) return;
  const map = { ...readLocalMap() };
  const cleanUser = row.username ? `@${String(row.username).replace(/^@/, '').toLowerCase()}` : null;
  const emoji = env.emojiStatus?.emoji?.trim() || '';
  let changed = false;
  if (emoji) {
    if (map[row.id] !== emoji) {
      map[row.id] = emoji;
      changed = true;
    }
    if (cleanUser && map[cleanUser] !== emoji) {
      map[cleanUser] = emoji;
      changed = true;
    }
  } else {
    if (map[row.id]) {
      delete map[row.id];
      changed = true;
    }
    if (cleanUser && map[cleanUser]) {
      delete map[cleanUser];
      changed = true;
    }
  }
  if (changed) writeLocalMap(map);
}

if (typeof window !== 'undefined' && !(window as any).__pixchatsEmojiHydratorBound) {
  (window as any).__pixchatsEmojiHydratorBound = true;
  window.addEventListener('pixchats:profile_row_hydrated', (e: Event) => {
    const detail = (e as CustomEvent<Profile>).detail;
    if (detail) hydrateEmojiStatusFromProfileRow(detail);
  });
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
    await updateProfileUserEnvelope(userId, (prev) => ({
      ...prev,
      emojiStatus: cleanEmoji
        ? {
            emoji: cleanEmoji,
            updatedAt: new Date().toISOString(),
          }
        : null,
    }));

    const supabase = getSupabaseClient();
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
    // Ignore fallback errors
  }
}

export async function syncAllEmojiStatusesFromCloud(force = false): Promise<EmojiStatusMap> {
  const now = Date.now();
  if (!force && (cloudSyncInProgress || now - lastCloudSyncAt < 5 * 60 * 1000)) {
    return readLocalMap();
  }
  cloudSyncInProgress = true;
  lastCloudSyncAt = now;
  try {
    const supabase = getSupabaseClient();
    const { data: rows } = await supabase
      .from('profiles')
      .select('id, username, signed_prekey_signature')
      .like('signed_prekey_signature', 'pxext:v1:%')
      .limit(150);
    if (rows && rows.length > 0) {
      const updated = { ...readLocalMap() };
      for (const r of rows as any[]) {
        const env = parseProfileUserEnvelope(r.signed_prekey_signature);
        const cleanUser = r.username ? `@${String(r.username).replace(/^@/, '').toLowerCase()}` : null;
        if (env.emojiStatus !== undefined) {
          const emoji = env.emojiStatus?.emoji?.trim() || '';
          if (emoji) {
            updated[r.id] = emoji;
            if (cleanUser) updated[cleanUser] = emoji;
          } else {
            delete updated[r.id];
            if (cleanUser) delete updated[cleanUser];
          }
        }
      }
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
