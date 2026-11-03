import { getSupabaseClient, getCachedCurrentProfile, computePenaltyExpirationIso, type PenaltyDurationUnit } from '@pixchats/core';

const CLOUD_BUCKET = 'avatars';
const PREMIUM_CLOUD_PATH = 'moderation/premium_users_v1.json';
const EXTENDED_PROFILE_CLOUD_PATH = 'profiles/extended_meta_v1.json';
const GROUP_EXTRA_CLOUD_PATH = 'chats/group_extra_v1.json';

const PREMIUM_LOCAL_KEY = 'pixchats:premium_manifest_v1';
const EXTENDED_PROFILE_LOCAL_KEY = 'pixchats:extended_profile_meta_v1';
const GROUP_EXTRA_LOCAL_KEY = 'pixchats:group_extra_meta_v1';
const DRAFTS_LOCAL_KEY = 'pixchats:chat_drafts_v1';
const SCHEDULED_MSGS_LOCAL_KEY = 'pixchats:scheduled_messages_v1';
const MULTI_PINS_LOCAL_KEY = 'pixchats:multi_pinned_messages_v1';
const AUTO_DELETE_LOCAL_KEY = 'pixchats:chat_auto_delete_v1';
const UNREAD_FIRST_LOCAL_KEY = 'pixchats:unread_first_sort_v1';
const STRANGER_REQUESTS_FILTER_KEY = 'pixchats:stranger_requests_filter_v1';
const APPROVED_REQUEST_CHATS_KEY = 'pixchats:approved_request_chats_v1';
const POWER_SAVER_LOCAL_KEY = 'pixchats:power_saver_config_v1';
const APP_LANGUAGE_LOCAL_KEY = 'pixchats:app_language_v1';
const DATA_STORAGE_PREFS_KEY = 'pixchats:data_storage_prefs_v1';

export interface PremiumRecord {
  userId: string;
  username?: string;
  expiresAt: string | null; // null = Навсегда
  grantedBy?: string;
  reason?: string;
  grantedAt: string;
}

export interface PremiumManifest {
  users: Record<string, PremiumRecord>; // key: userId or @username
  updatedAt: string;
}

export interface MusicStatusInfo {
  title: string;
  artist: string;
  audioUrl?: string | null;
}

export interface UserExtendedProfileMeta {
  birthDate?: string | null; // YYYY-MM-DD
  bannerUrl?: string | null; // Data URL or preset gradient CSS
  musicStatus?: MusicStatusInfo | null;
  closeFriendsIds?: string[];
  updatedAt?: string;
}

export interface GroupInviteLink {
  id?: string;
  code: string;
  chatId: string;
  createdAt?: string;
  expiresAt: string | null;
  maxUses: number | null; // null = без лимита
  usedCount: number;
  createdBy?: string;
}

export interface GroupExtraConfig {
  slowModeSeconds: number; // 0, 10, 30, 60, 300
  watermarkEnabled: boolean;
  watermarkText: string;
  autoDeleteHours: number; // 0, 24, 168, 720
  pinnedMessageIds: string[];
  memberTags: Record<string, { title: string; color?: string }>; // userId -> локальный титул/роль в группе
  inviteLinks: GroupInviteLink[];
}

export const DEFAULT_GROUP_EXTRA_CONFIG: GroupExtraConfig = {
  slowModeSeconds: 0,
  watermarkEnabled: false,
  watermarkText: '',
  autoDeleteHours: 0,
  pinnedMessageIds: [],
  memberTags: {},
  inviteLinks: [],
};

export interface ScheduledMessageItem {
  id: string;
  chatId: string;
  text: string;
  sendAt: number; // timestamp ms
  silent?: boolean;
  spoiler?: boolean;
  createdAt: string;
}

export interface PowerSaverConfig {
  enabled: boolean;
  autoWhenBatteryBelow: number; // e.g. 20 (%)
  autoEnableAtBatteryPct: number;
  disableAutoplayMedia: boolean;
  disableFullscreenEffects: boolean;
  disableParticlesAndEffects: boolean;
  disableBackgroundBlur: boolean;
  reduceBlur: boolean;
  reduceAnimations: boolean;
}

export interface DataStoragePrefs {
  autoDownloadPhotos: boolean;
  autoDownloadVideos: boolean;
  autoDownloadVoice: boolean;
  autoDownloadFiles: boolean;
  defaultVideoQuality: '480p' | '720p' | '1080p' | 'original';
  useIndexedDbCache: boolean;
  indexedDbCacheEnabled: boolean;
}

export const DEFAULT_POWER_SAVER: PowerSaverConfig = {
  enabled: false,
  autoWhenBatteryBelow: 20,
  autoEnableAtBatteryPct: 20,
  disableAutoplayMedia: false,
  disableFullscreenEffects: false,
  disableParticlesAndEffects: false,
  disableBackgroundBlur: false,
  reduceBlur: false,
  reduceAnimations: false,
};

export const DEFAULT_DATA_STORAGE_PREFS: DataStoragePrefs = {
  autoDownloadPhotos: true,
  autoDownloadVideos: true,
  autoDownloadVoice: true,
  autoDownloadFiles: true,
  defaultVideoQuality: '720p',
  useIndexedDbCache: true,
  indexedDbCacheEnabled: true,
};

export const PROFILE_BANNER_PRESETS = [
  {
    id: 'gold-carbon',
    label: 'Золото Pixset Studio',
    css: 'linear-gradient(135deg, #1b1600 0%, #524000 50%, #ffd400 100%)',
  },
  {
    id: 'neon-cyber',
    label: 'Неоновый Киберпанк',
    css: 'linear-gradient(135deg, #0f172a 0%, #4c1d95 50%, #ec4899 100%)',
  },
  {
    id: 'emerald-matrix',
    label: 'Изумрудный код',
    css: 'linear-gradient(135deg, #022c22 0%, #065f46 55%, #10b981 100%)',
  },
  {
    id: 'deep-ocean',
    label: 'Глубокий океан',
    css: 'linear-gradient(135deg, #082f49 0%, #0369a1 55%, #38bdf8 100%)',
  },
  {
    id: 'crimson-sunset',
    label: 'Багровый закат',
    css: 'linear-gradient(135deg, #450a0a 0%, #9a3412 55%, #f59e0b 100%)',
  },
];

// ============================================================================
// 1. PIXCHATS PREMIUM SYSTEM
// ============================================================================

export function getPremiumManifestSync(): PremiumManifest {
  if (typeof window === 'undefined') return { users: {}, updatedAt: '' };
  try {
    const raw = localStorage.getItem(PREMIUM_LOCAL_KEY);
    if (!raw) return { users: {}, updatedAt: '' };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.users
      ? parsed
      : { users: {}, updatedAt: '' };
  } catch {
    return { users: {}, updatedAt: '' };
  }
}

function savePremiumManifestLocal(manifest: PremiumManifest): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PREMIUM_LOCAL_KEY, JSON.stringify(manifest));
    window.dispatchEvent(new CustomEvent('pixchats:premium_updated', { detail: manifest }));
  } catch {}
}

let lastPremiumFetchMs = 0;

export async function syncPremiumManifestFromCloud(force = false): Promise<PremiumManifest> {
  const local = getPremiumManifestSync();
  if (!force && Date.now() - lastPremiumFetchMs < 25_000) {
    return local;
  }
  lastPremiumFetchMs = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { data } = supabase.storage.from(CLOUD_BUCKET).getPublicUrl(PREMIUM_CLOUD_PATH);
    if (!data?.publicUrl) return local;
    const res = await fetch(`${data.publicUrl}?t=${Math.floor(Date.now() / 20000)}`);
    if (!res.ok) return local;
    const remote = (await res.json()) as PremiumManifest;
    if (remote && remote.users) {
      const merged: PremiumManifest = {
        users: { ...local.users, ...remote.users },
        updatedAt: remote.updatedAt || new Date().toISOString(),
      };
      // If remote explicitly removed a key and is newer, prefer remote
      if (!local.updatedAt || (remote.updatedAt && remote.updatedAt >= local.updatedAt)) {
        merged.users = remote.users;
      }
      savePremiumManifestLocal(merged);
      return merged;
    }
  } catch {}
  return local;
}

export function isRecordPremiumActive(rec?: PremiumRecord | null, nowMs = Date.now()): boolean {
  if (!rec) return false;
  if (rec.expiresAt === null) return true; // Навсегда
  const exp = new Date(rec.expiresAt).getTime();
  return Number.isFinite(exp) && exp > nowMs;
}

export function getUserPremiumStatus(
  userId?: string | null,
  username?: string | null,
  nowMs = Date.now()
): { active: boolean; expiresAt: string | null; record: PremiumRecord | null } {
  if (!userId && !username) return { active: false, expiresAt: null, record: null };
  const manifest = getPremiumManifestSync();
  const byId = userId ? manifest.users[userId] : undefined;
  const cleanUser = username ? username.replace(/^@/, '').toLowerCase() : '';
  const byName = cleanUser ? manifest.users[`@${cleanUser}`] : undefined;
  const rec = byId || byName || null;
  if (!rec) return { active: false, expiresAt: null, record: null };
  const active = isRecordPremiumActive(rec, nowMs);
  return { active, expiresAt: rec.expiresAt, record: active ? rec : null };
}

export function getMaxReactionsForUser(userId?: string | null, username?: string | null): number {
  const { active } = getUserPremiumStatus(userId, username);
  return active ? 3 : 1;
}

export function getMaxDailyStoriesForUser(userId?: string | null, username?: string | null): number {
  const { active } = getUserPremiumStatus(userId, username);
  return active ? 999 : 1;
}

export async function grantUserPremium(params: {
  userId: string;
  username?: string;
  permanent?: boolean;
  untilDate?: string | null;
  durationValue?: number;
  durationUnit?: PenaltyDurationUnit;
  reason?: string;
  note?: string;
  grantedBy?: string;
}): Promise<PremiumRecord> {
  const expiresAt = computePenaltyExpirationIso({
    permanent: params.permanent,
    untilDate: params.untilDate,
    durationValue: params.durationValue,
    durationUnit: params.durationUnit,
  });

  const current = await syncPremiumManifestFromCloud(true);
  const record: PremiumRecord = {
    userId: params.userId,
    username: params.username,
    expiresAt,
    reason: params.reason || params.note || 'Выдано администратором PixChats',
    grantedBy: params.grantedBy,
    grantedAt: new Date().toISOString(),
  };

  const nextUsers = { ...current.users, [params.userId]: record };
  if (params.username) {
    nextUsers[`@${params.username.replace(/^@/, '').toLowerCase()}`] = record;
  }

  const nextManifest: PremiumManifest = {
    users: nextUsers,
    updatedAt: new Date().toISOString(),
  };

  savePremiumManifestLocal(nextManifest);

  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(nextManifest)], { type: 'application/json' });
    await supabase.storage.from(CLOUD_BUCKET).upload(PREMIUM_CLOUD_PATH, blob, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '15',
    });
  } catch {}

  return record;
}

export async function revokeUserPremium(userId: string, username?: string): Promise<void> {
  const current = await syncPremiumManifestFromCloud(true);
  const nextUsers = { ...current.users };
  delete nextUsers[userId];
  if (username) {
    delete nextUsers[`@${username.replace(/^@/, '').toLowerCase()}`];
  }
  const nextManifest: PremiumManifest = {
    users: nextUsers,
    updatedAt: new Date().toISOString(),
  };
  savePremiumManifestLocal(nextManifest);

  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(nextManifest)], { type: 'application/json' });
    await supabase.storage.from(CLOUD_BUCKET).upload(PREMIUM_CLOUD_PATH, blob, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '15',
    });
  } catch {}
}

// ============================================================================
// 2. EXTENDED PROFILE METADATA (BIRTHDAY, BANNER, MUSIC STATUS, CLOSE FRIENDS)
// ============================================================================

export function getAllExtendedProfilesSync(): Record<string, UserExtendedProfileMeta> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(EXTENDED_PROFILE_LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getUserExtendedProfileSync(userId?: string | null): UserExtendedProfileMeta {
  if (!userId) return {};
  const all = getAllExtendedProfilesSync();
  return all[userId] || {};
}

let lastExtProfileFetchMs = 0;

export async function syncExtendedProfilesFromCloud(force = false): Promise<Record<string, UserExtendedProfileMeta>> {
  const local = getAllExtendedProfilesSync();
  if (!force && Date.now() - lastExtProfileFetchMs < 30_000) {
    return local;
  }
  lastExtProfileFetchMs = Date.now();
  try {
    const supabase = getSupabaseClient();
    const { data } = supabase.storage.from(CLOUD_BUCKET).getPublicUrl(EXTENDED_PROFILE_CLOUD_PATH);
    if (!data?.publicUrl) return local;
    const res = await fetch(`${data.publicUrl}?t=${Math.floor(Date.now() / 30000)}`);
    if (!res.ok) return local;
    const remote = await res.json();
    if (remote && typeof remote === 'object') {
      const merged = { ...remote, ...local };
      for (const [k, v] of Object.entries(remote as Record<string, UserExtendedProfileMeta>)) {
        const loc = local[k];
        if (!loc || (v.updatedAt && (!loc.updatedAt || v.updatedAt >= loc.updatedAt))) {
          merged[k] = v;
        }
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem(EXTENDED_PROFILE_LOCAL_KEY, JSON.stringify(merged));
        window.dispatchEvent(new CustomEvent('pixchats:extended_profile_updated', { detail: merged }));
      }
      return merged;
    }
  } catch {}
  return local;
}

export async function updateUserExtendedProfile(
  userId: string,
  patch: Partial<UserExtendedProfileMeta>
): Promise<UserExtendedProfileMeta> {
  const all = await syncExtendedProfilesFromCloud(false);
  const existing = all[userId] || {};
  const updated: UserExtendedProfileMeta = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const nextAll = { ...all, [userId]: updated };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(EXTENDED_PROFILE_LOCAL_KEY, JSON.stringify(nextAll));
      window.dispatchEvent(new CustomEvent('pixchats:extended_profile_updated', { detail: nextAll }));
    } catch {}
  }

  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(nextAll)], { type: 'application/json' });
    await supabase.storage.from(CLOUD_BUCKET).upload(EXTENDED_PROFILE_CLOUD_PATH, blob, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '30',
    });
  } catch {}

  return updated;
}

export function isBirthdayToday(birthDate?: string | null, refDate: Date = new Date()): boolean {
  if (!birthDate || typeof birthDate !== 'string') return false;
  const trimmed = birthDate.trim();
  // Supports YYYY-MM-DD or MM-DD
  const parts = trimmed.split('-');
  if (parts.length < 2) return false;
  const month = Number(parts[parts.length - 2]);
  const day = Number(parts[parts.length - 1]);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return false;
  return refDate.getMonth() + 1 === month && refDate.getDate() === day;
}

export function formatBirthdayHuman(birthDate?: string | null): string {
  if (!birthDate) return '';
  try {
    const parts = birthDate.split('-');
    if (parts.length === 3) {
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    }
    return birthDate;
  } catch {
    return birthDate;
  }
}

export function isUserInCloseFriends(ownerOrTargetId: string, maybeTargetUserId?: string): boolean {
  const ownerUserId = maybeTargetUserId ? ownerOrTargetId : getCachedCurrentProfile()?.id || '__me__';
  const targetUserId = maybeTargetUserId || ownerOrTargetId;
  const meta = getUserExtendedProfileSync(ownerUserId);
  return Array.isArray(meta.closeFriendsIds) && meta.closeFriendsIds.includes(targetUserId);
}

export function toggleCloseFriend(ownerOrFriendId: string, maybeFriendUserId?: string): string[] {
  const ownerUserId = maybeFriendUserId ? ownerOrFriendId : getCachedCurrentProfile()?.id || '__me__';
  const friendUserId = maybeFriendUserId || ownerOrFriendId;
  const meta = getUserExtendedProfileSync(ownerUserId);
  const current = Array.isArray(meta.closeFriendsIds) ? meta.closeFriendsIds : [];
  const next = current.includes(friendUserId)
    ? current.filter((id) => id !== friendUserId)
    : [...current, friendUserId];
  saveExtendedProfile(ownerUserId, { closeFriendsIds: next });
  return next;
}

// ============================================================================
// 3. GROUP / CHAT EXTRA CONFIG (SLOW MODE, INVITE LINKS, TAGS, WATERMARK, PINS)
// ============================================================================

export function getAllGroupExtraConfigsSync(): Record<string, GroupExtraConfig> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(GROUP_EXTRA_LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getGroupExtraConfigSync(chatId?: string | null): GroupExtraConfig {
  if (!chatId) return { ...DEFAULT_GROUP_EXTRA_CONFIG };
  const all = getAllGroupExtraConfigsSync();
  return { ...DEFAULT_GROUP_EXTRA_CONFIG, ...(all[chatId] || {}) };
}

export async function updateGroupExtraConfig(
  chatId: string,
  patch: Partial<GroupExtraConfig>
): Promise<GroupExtraConfig> {
  const all = getAllGroupExtraConfigsSync();
  const existing = { ...DEFAULT_GROUP_EXTRA_CONFIG, ...(all[chatId] || {}) };
  const updated: GroupExtraConfig = { ...existing, ...patch };
  const nextAll = { ...all, [chatId]: updated };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(GROUP_EXTRA_LOCAL_KEY, JSON.stringify(nextAll));
      window.dispatchEvent(new CustomEvent('pixchats:group_extra_updated', { detail: { chatId, config: updated } }));
    } catch {}
  }
  try {
    const supabase = getSupabaseClient();
    const blob = new Blob([JSON.stringify(nextAll)], { type: 'application/json' });
    await supabase.storage.from(CLOUD_BUCKET).upload(GROUP_EXTRA_CLOUD_PATH, blob, {
      upsert: true,
      contentType: 'application/json',
      cacheControl: '30',
    });
  } catch {}
  return updated;
}

export async function createTemporaryInviteLink(params: {
  chatId: string;
  createdBy: string;
  expiresHours?: number | null;
  maxUses?: number | null;
}): Promise<GroupInviteLink> {
  const cfg = getGroupExtraConfigSync(params.chatId);
  const existing = Array.isArray(cfg.inviteLinks) ? cfg.inviteLinks : [];
  const code = `px_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
  const expiresAt =
    params.expiresHours && params.expiresHours > 0
      ? new Date(Date.now() + params.expiresHours * 3600 * 1000).toISOString()
      : null;
  const link: GroupInviteLink = {
    id: `inv_${Date.now()}`,
    code,
    chatId: params.chatId,
    createdAt: new Date().toISOString(),
    expiresAt,
    maxUses: params.maxUses && params.maxUses > 0 ? params.maxUses : null,
    usedCount: 0,
    createdBy: params.createdBy,
  };
  await updateGroupExtraConfig(params.chatId, {
    inviteLinks: [link, ...existing],
  });
  return link;
}

// ============================================================================
// 4. DRAFTS, SCHEDULED MESSAGES, MULTI-PINS, AUTO-DELETE, UNREAD FIRST
// ============================================================================

export function getAllChatDrafts(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(DRAFTS_LOCAL_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function getChatDraft(chatId?: string | null): string {
  if (!chatId) return '';
  return getAllChatDrafts()[chatId] || '';
}

export function setChatDraft(chatId: string, text: string): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    const current = getAllChatDrafts();
    if (!text.trim()) {
      if (!current[chatId]) return;
      delete current[chatId];
    } else {
      current[chatId] = text;
    }
    localStorage.setItem(DRAFTS_LOCAL_KEY, JSON.stringify(current));
    window.dispatchEvent(new CustomEvent('pixchats:drafts_changed', { detail: { chatId, text } }));
  } catch {}
}

export function getScheduledMessages(chatId?: string | null): ScheduledMessageItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SCHEDULED_MSGS_LOCAL_KEY);
    const list: ScheduledMessageItem[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return chatId ? list.filter((m) => m.chatId === chatId) : list;
  } catch {
    return [];
  }
}

export function addScheduledMessage(item: Omit<ScheduledMessageItem, 'id' | 'createdAt'>): ScheduledMessageItem {
  const all = getScheduledMessages();
  const created: ScheduledMessageItem = {
    ...item,
    id: `sched_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  const next = [...all, created].sort(
    (a, b) => new Date(a.sendAt).getTime() - new Date(b.sendAt).getTime()
  );
  if (typeof window !== 'undefined') {
    localStorage.setItem(SCHEDULED_MSGS_LOCAL_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('pixchats:scheduled_changed'));
  }
  return created;
}

export function removeScheduledMessage(id: string): void {
  const all = getScheduledMessages();
  const next = all.filter((m) => m.id !== id);
  if (typeof window !== 'undefined') {
    localStorage.setItem(SCHEDULED_MSGS_LOCAL_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('pixchats:scheduled_changed'));
  }
}

export function getMultiPinnedMessageIds(chatId: string, primaryPinnedId?: string | null): string[] {
  const cfg = getGroupExtraConfigSync(chatId);
  let localPins: string[] = [];
  if (typeof window !== 'undefined') {
    try {
      const map = JSON.parse(localStorage.getItem(MULTI_PINS_LOCAL_KEY) || '{}');
      if (Array.isArray(map[chatId])) localPins = map[chatId];
    } catch {}
  }
  const combined = new Set<string>([
    ...(primaryPinnedId ? [primaryPinnedId] : []),
    ...(cfg.pinnedMessageIds || []),
    ...localPins,
  ]);
  return Array.from(combined);
}

export async function toggleMultiPinnedMessage(chatId: string, messageId: string): Promise<string[]> {
  const current = getMultiPinnedMessageIds(chatId);
  const next = current.includes(messageId)
    ? current.filter((id) => id !== messageId)
    : [...current, messageId];
  if (typeof window !== 'undefined') {
    try {
      const map = JSON.parse(localStorage.getItem(MULTI_PINS_LOCAL_KEY) || '{}');
      map[chatId] = next;
      localStorage.setItem(MULTI_PINS_LOCAL_KEY, JSON.stringify(map));
    } catch {}
  }
  await updateGroupExtraConfig(chatId, { pinnedMessageIds: next });
  return next;
}

export function getUnreadFirstSortEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(UNREAD_FIRST_LOCAL_KEY) === '1';
}

export function setUnreadFirstSortEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(UNREAD_FIRST_LOCAL_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent('pixchats:folders_changed'));
}

export function getStrangerRequestsFilterEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(STRANGER_REQUESTS_FILTER_KEY) === '1';
}

export function setStrangerRequestsFilterEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STRANGER_REQUESTS_FILTER_KEY, enabled ? '1' : '0');
  window.dispatchEvent(new CustomEvent('pixchats:folders_changed'));
}

export function getApprovedRequestChatIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(APPROVED_REQUEST_CHATS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function approveMessageRequestChat(chatId: string): void {
  if (typeof window === 'undefined') return;
  const current = getApprovedRequestChatIds();
  if (!current.includes(chatId)) {
    localStorage.setItem(APPROVED_REQUEST_CHATS_KEY, JSON.stringify([...current, chatId]));
    window.dispatchEvent(new CustomEvent('pixchats:folders_changed'));
  }
}

// ============================================================================
// 5. POWER SAVER, DATA/STORAGE PREFS, LANGUAGE, & INDEXEDDB MEDIA CACHE
// ============================================================================

export function getPowerSaverConfig(): PowerSaverConfig {
  if (typeof window === 'undefined') return DEFAULT_POWER_SAVER;
  try {
    const raw = localStorage.getItem(POWER_SAVER_LOCAL_KEY);
    return raw ? { ...DEFAULT_POWER_SAVER, ...JSON.parse(raw) } : DEFAULT_POWER_SAVER;
  } catch {
    return DEFAULT_POWER_SAVER;
  }
}

export function savePowerSaverConfig(patch: Partial<PowerSaverConfig>): PowerSaverConfig {
  const current = getPowerSaverConfig();
  const cfg: PowerSaverConfig = {
    ...current,
    ...patch,
  };
  if (patch.autoEnableAtBatteryPct !== undefined) {
    cfg.autoWhenBatteryBelow = patch.autoEnableAtBatteryPct;
  } else if (patch.autoWhenBatteryBelow !== undefined) {
    cfg.autoEnableAtBatteryPct = patch.autoWhenBatteryBelow;
  }
  if (patch.disableParticlesAndEffects !== undefined) {
    cfg.disableFullscreenEffects = patch.disableParticlesAndEffects;
  }
  if (patch.reduceBlur !== undefined) {
    cfg.disableBackgroundBlur = patch.reduceBlur;
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(POWER_SAVER_LOCAL_KEY, JSON.stringify(cfg));
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-power-saver', cfg.enabled ? '1' : '0');
    }
    window.dispatchEvent(new CustomEvent('pixchats:power_saver_changed', { detail: cfg }));
  }
  return cfg;
}

export function getDataStoragePrefs(): DataStoragePrefs {
  if (typeof window === 'undefined') return DEFAULT_DATA_STORAGE_PREFS;
  try {
    const raw = localStorage.getItem(DATA_STORAGE_PREFS_KEY);
    return raw ? { ...DEFAULT_DATA_STORAGE_PREFS, ...JSON.parse(raw) } : DEFAULT_DATA_STORAGE_PREFS;
  } catch {
    return DEFAULT_DATA_STORAGE_PREFS;
  }
}

export function saveDataStoragePrefs(patch: Partial<DataStoragePrefs>): DataStoragePrefs {
  const current = getDataStoragePrefs();
  const prefs: DataStoragePrefs = {
    ...current,
    ...patch,
  };
  if (patch.indexedDbCacheEnabled !== undefined) {
    prefs.useIndexedDbCache = patch.indexedDbCacheEnabled;
  } else if (patch.useIndexedDbCache !== undefined) {
    prefs.indexedDbCacheEnabled = patch.useIndexedDbCache;
  }
  if (typeof window !== 'undefined') {
    localStorage.setItem(DATA_STORAGE_PREFS_KEY, JSON.stringify(prefs));
    window.dispatchEvent(new CustomEvent('pixchats:data_storage_changed', { detail: prefs }));
  }
  return prefs;
}

export function getAppLanguage(): 'ru' | 'en' {
  if (typeof window === 'undefined') return 'ru';
  return (localStorage.getItem(APP_LANGUAGE_LOCAL_KEY) as 'ru' | 'en') || 'ru';
}

export function setAppLanguage(lang: 'ru' | 'en'): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(APP_LANGUAGE_LOCAL_KEY, lang);
  window.dispatchEvent(new CustomEvent('pixchats:language_changed', { detail: lang }));
}

const IDB_NAME = 'pixchats_media_cache_db';
const IDB_STORE = 'media_blobs';

function openMediaCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'url' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putMediaInIndexedDb(url: string, dataUrl: string): Promise<void> {
  if (!getDataStoragePrefs().useIndexedDbCache) return;
  try {
    const db = await openMediaCacheDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put({
        url,
        dataUrl,
        size: dataUrl.length,
        savedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function getMediaFromIndexedDb(url: string): Promise<string | null> {
  if (!getDataStoragePrefs().useIndexedDbCache) return null;
  try {
    const db = await openMediaCacheDb();
    return await new Promise<string | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(url);
      req.onsuccess = () => resolve(req.result?.dataUrl || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getMediaCacheStats(): Promise<{ count: number; totalBytes: number }> {
  try {
    const db = await openMediaCacheDb();
    return await new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => {
        const items = Array.isArray(req.result) ? req.result : [];
        const totalBytes = items.reduce((acc, it) => acc + (Number(it.size) || 0), 0);
        resolve({ count: items.length, totalBytes });
      };
      req.onerror = () => resolve({ count: 0, totalBytes: 0 });
    });
  } catch {
    return { count: 0, totalBytes: 0 };
  }
}

export async function clearMediaIndexedDbCache(): Promise<void> {
  try {
    const db = await openMediaCacheDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {}
}

// ============================================================================
// 6. WATERMARK, PIXEL/3D AVATAR GENERATOR, TABLES, ALBUMS, TIMECODES
// ============================================================================

export async function applyChannelWatermarkToDataUrl(
  imageDataUrl: string,
  watermarkText: string
): Promise<string> {
  if (typeof document === 'undefined' || !watermarkText.trim()) return imageDataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width || 800;
        canvas.height = img.height || 600;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(imageDataUrl);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const fontSize = Math.max(14, Math.round(canvas.width * 0.032));
        ctx.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
        const label = `⚡ ${watermarkText.trim()}`;
        const metrics = ctx.measureText(label);
        const padX = Math.round(fontSize * 0.65);
        const padY = Math.round(fontSize * 0.45);
        const boxW = metrics.width + padX * 2;
        const boxH = fontSize + padY * 2;
        const x = canvas.width - boxW - Math.round(canvas.width * 0.025);
        const y = canvas.height - boxH - Math.round(canvas.height * 0.025);

        ctx.fillStyle = 'rgba(9, 9, 11, 0.72)';
        ctx.beginPath();
        ctx.roundRect(x, y, boxW, boxH, Math.round(fontSize * 0.4));
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 212, 0, 0.65)';
        ctx.lineWidth = Math.max(1.5, fontSize * 0.08);
        ctx.stroke();

        ctx.fillStyle = '#ffd400';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + padX, y + boxH / 2);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        resolve(imageDataUrl);
      }
    };
    img.onerror = () => resolve(imageDataUrl);
    img.src = imageDataUrl;
  });
}

export function generatePixsetAvatarSvgDataUrl(
  seedOrParams:
    | string
    | {
        seed: string;
        bgIndex?: number;
        fgColor?: string;
        style?: 'pixel' | '3d';
      },
  styleArg?: 'pixel' | '3d',
  bgIndexArg?: number
): string {
  const params =
    typeof seedOrParams === 'string'
      ? { seed: seedOrParams, style: styleArg, bgIndex: bgIndexArg }
      : seedOrParams;
  const palettes = [
    ['#18181b', '#ffd400', '#f59e0b'],
    ['#0f172a', '#38bdf8', '#818cf8'],
    ['#1e1b4b', '#ec4899', '#a855f7'],
    ['#052e16', '#22c55e', '#10b981'],
    ['#450a0a', '#f97316', '#facc15'],
  ];
  const p = palettes[(params.bgIndex ?? 0) % palettes.length];
  const fg = params.fgColor || p[1];
  const acc = p[2];

  // Deterministic hash from seed
  let h = 2166136261;
  for (let i = 0; i < params.seed.length; i++) {
    h ^= params.seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  if (params.style === '3d') {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240">
      <defs>
        <radialGradient id="bg" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="${acc}" stop-opacity="0.45"/>
          <stop offset="100%" stop-color="${p[0]}"/>
        </radialGradient>
        <radialGradient id="sphere" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="35%" stop-color="${fg}"/>
          <stop offset="100%" stop-color="${p[0]}"/>
        </radialGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill="url(#bg)"/>
      <circle cx="60" cy="52" r="24" fill="url(#sphere)"/>
      <path d="M26 104 C26 78, 94 78, 94 104" fill="url(#sphere)"/>
      <circle cx="51" cy="48" r="3.5" fill="#09090b"/>
      <circle cx="69" cy="48" r="3.5" fill="#09090b"/>
      <path d="M52 59 Q60 66 68 59" stroke="#09090b" stroke-width="3" fill="none" stroke-linecap="round"/>
    </svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  // Symmetric 5x5 pixel-art avatar
  let rects = '';
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      const bit = (Math.abs(h >> (y * 3 + x)) & 1) === 1;
      if (bit) {
        const color = (x + y) % 2 === 0 ? fg : acc;
        const px1 = 20 + x * 16;
        const px2 = 20 + (4 - x) * 16;
        const py = 20 + y * 16;
        rects += `<rect x="${px1}" y="${py}" width="15" height="15" rx="3" fill="${color}"/>`;
        if (px2 !== px1) {
          rects += `<rect x="${px2}" y="${py}" width="15" height="15" rx="3" fill="${color}"/>`;
        }
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="240" height="240">
    <rect width="120" height="120" rx="26" fill="${p[0]}"/>
    ${rects}
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export interface ChatTablePayload {
  headers: string[];
  rows: string[][];
}

export function encodeTableMessage(
  tableOrHeaders: ChatTablePayload | string[],
  rowsOrCaption?: string[][] | string,
  captionArg?: string
): string {
  const table: ChatTablePayload = Array.isArray(tableOrHeaders)
    ? {
        headers: tableOrHeaders,
        rows: Array.isArray(rowsOrCaption) ? rowsOrCaption : [],
      }
    : tableOrHeaders;
  const caption =
    typeof rowsOrCaption === 'string'
      ? rowsOrCaption
      : typeof captionArg === 'string'
        ? captionArg
        : undefined;
  return `__TABLE__:${JSON.stringify(table)}${caption ? `\n${caption}` : ''}`;
}

export function parseTableMessage(
  text: string
): { headers: string[]; rows: string[][]; table: ChatTablePayload; caption: string } | null {
  if (!text || !text.startsWith('__TABLE__:')) return null;
  try {
    const firstNewline = text.indexOf('\n');
    const jsonPart = firstNewline === -1 ? text.slice(10) : text.slice(10, firstNewline);
    const caption = firstNewline === -1 ? '' : text.slice(firstNewline + 1);
    const parsed = JSON.parse(jsonPart);
    if (parsed && Array.isArray(parsed.headers) && Array.isArray(parsed.rows)) {
      return {
        headers: parsed.headers,
        rows: parsed.rows,
        table: parsed,
        caption,
      };
    }
  } catch {}
  return null;
}

export interface ChatAlbumPayload {
  images: string[]; // array of URLs or Data URLs
  caption?: string;
  spoiler?: boolean;
}

export function encodeAlbumMessage(album: ChatAlbumPayload): string {
  return `__ALBUM__:${JSON.stringify(album)}`;
}

export function parseAlbumMessage(text: string): ChatAlbumPayload | null {
  if (!text || !text.startsWith('__ALBUM__:')) return null;
  try {
    const parsed = JSON.parse(text.slice(10));
    if (parsed && Array.isArray(parsed.images) && parsed.images.length > 0) {
      return parsed;
    }
  } catch {}
  return null;
}

export function parseTimecodeToSeconds(tc: string): number | null {
  const m = tc.trim().match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hours = m[1] ? Number(m[1]) : 0;
  const mins = Number(m[2]);
  const secs = Number(m[3]);
  if (secs >= 60 || mins >= 60) return null;
  return hours * 3600 + mins * 60 + secs;
}

// ============================================================================
// 7. CONVENIENCE ALIASES & ADDITIONAL HELPERS USED ACROSS PAGES
// ============================================================================

export type PremiumDurationUnit = PenaltyDurationUnit;
export type ExtendedProfileData = UserExtendedProfileMeta;
export type DataStorageConfig = DataStoragePrefs;

export const syncPremiumRegistryFromCloud = syncPremiumManifestFromCloud;
export const BANNER_PRESETS = PROFILE_BANNER_PRESETS;

export function getExtendedProfile(userId?: string | null, username?: string | null): UserExtendedProfileMeta {
  const all = getAllExtendedProfilesSync();
  if (userId && all[userId]) return all[userId];
  if (username) {
    const clean = `@${username.replace(/^@/, '').toLowerCase()}`;
    if (all[clean]) return all[clean];
  }
  return {};
}

export function saveExtendedProfile(
  userId: string,
  patch: Partial<UserExtendedProfileMeta>,
  username?: string | null
): UserExtendedProfileMeta {
  const all = getAllExtendedProfilesSync();
  const existing = all[userId] || (username ? all[`@${username.replace(/^@/, '').toLowerCase()}`] : undefined) || {};
  const updated: UserExtendedProfileMeta = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  const nextAll: Record<string, UserExtendedProfileMeta> = { ...all, [userId]: updated };
  if (username) {
    nextAll[`@${username.replace(/^@/, '').toLowerCase()}`] = updated;
  }
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(EXTENDED_PROFILE_LOCAL_KEY, JSON.stringify(nextAll));
      window.dispatchEvent(new CustomEvent('pixchats:extended_profile_updated', { detail: nextAll }));
    } catch {}
  }
  void updateUserExtendedProfile(userId, patch);
  return updated;
}

export const getGroupExtraConfig = getGroupExtraConfigSync;

export function saveGroupExtraConfig(
  chatId: string,
  patch: Partial<GroupExtraConfig>
): GroupExtraConfig {
  const all = getAllGroupExtraConfigsSync();
  const existing = { ...DEFAULT_GROUP_EXTRA_CONFIG, ...(all[chatId] || {}) };
  const updated: GroupExtraConfig = { ...existing, ...patch };
  const nextAll = { ...all, [chatId]: updated };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(GROUP_EXTRA_LOCAL_KEY, JSON.stringify(nextAll));
      window.dispatchEvent(new CustomEvent('pixchats:group_extra_updated', { detail: { chatId, config: updated } }));
    } catch {}
  }
  void updateGroupExtraConfig(chatId, patch);
  return updated;
}

export const saveChatDraft = setChatDraft;
export const getDataStorageConfig = getDataStoragePrefs;
export const saveDataStorageConfig = saveDataStoragePrefs;
export const getIndexedDbCacheStats = getMediaCacheStats;
export const clearIndexedDbMediaCache = clearMediaIndexedDbCache;
export const parseTimecodeSeconds = parseTimecodeToSeconds;

export function getCloseFriendIds(ownerUserId?: string | null): string[] {
  const resolvedOwner = ownerUserId || getCachedCurrentProfile()?.id || '__me__';
  const meta = getUserExtendedProfileSync(resolvedOwner);
  return Array.isArray(meta.closeFriendsIds) ? meta.closeFriendsIds : [];
}

export function formatPremiumRemaining(expiresAt?: string | null, nowMs = Date.now()): string {
  if (expiresAt === null || expiresAt === undefined) return 'Навсегда';
  const exp = new Date(expiresAt).getTime();
  if (!Number.isFinite(exp)) return 'Навсегда';
  const diffSec = Math.max(0, Math.floor((exp - nowMs) / 1000));
  if (diffSec <= 0) return 'Истёк';
  if (diffSec < 60) return `${diffSec} сек.`;
  if (diffSec < 3600) return `${Math.ceil(diffSec / 60)} мин.`;
  if (diffSec < 86400) return `${Math.ceil(diffSec / 3600)} ч.`;
  const days = Math.ceil(diffSec / 86400);
  if (days <= 60) return `${days} дн.`;
  return `до ${new Date(exp).toLocaleDateString('ru-RU')}`;
}

export function popDueScheduledMessages(nowMs = Date.now()): ScheduledMessageItem[] {
  if (typeof window === 'undefined') return [];
  const all = getScheduledMessages();
  if (all.length === 0) return [];
  const due: ScheduledMessageItem[] = [];
  const remaining: ScheduledMessageItem[] = [];
  for (const item of all) {
    const t = new Date(item.sendAt).getTime();
    if (Number.isFinite(t) && t <= nowMs) {
      due.push(item);
    } else {
      remaining.push(item);
    }
  }
  if (due.length > 0) {
    try {
      localStorage.setItem(SCHEDULED_MSGS_LOCAL_KEY, JSON.stringify(remaining));
      window.dispatchEvent(new CustomEvent('pixchats:scheduled_changed'));
    } catch {}
  }
  return due;
}


