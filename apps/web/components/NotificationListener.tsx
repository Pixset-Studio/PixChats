'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, getSupabaseClient, getMuteStates, decryptMessageE2EE, getFriends, sendMessage } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { getNotificationPrefs } from '../lib/notificationPrefs';
import {
  ensureNotificationPermissionEverywhere,
  sendNativeOrWebNotification,
} from '../lib/nativePlatform';
import { startDeviceSessionMonitor } from '../lib/deviceSessions';
import {
  getExtendedProfile,
  syncExtendedProfilesFromCloud,
  isBirthdayToday,
  popDueScheduledMessages,
} from '../lib/premiumAndFeatures';

const MEDIA_LABELS: Record<string, string> = {
  image: '📷 Фото',
  video: '🎥 Видео',
  audio: '🎵 Аудио',
  voice: '🎤 Голосовое сообщение',
  file: '📎 Файл',
};

interface InAppToast {
  id: string;
  title: string;
  body: string;
  url?: string;
  badge?: string;
}

function createChimeWavDataUrl(): string {
  try {
    const sampleRate = 8000;
    const durationSec = 0.35;
    const numSamples = Math.floor(sampleRate * durationSec);
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const freq = t < 0.12 ? 587.33 : 880.0;
      const decay = Math.exp(-t * 9);
      const sample = Math.sin(2 * Math.PI * freq * t) * decay * 0.45;
      const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
      view.setInt16(44 + i * 2, intSample, true);
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:audio/wav;base64,${btoa(binary)}`;
  } catch {
    return '';
  }
}

let audioContextUnlocked = false;

function unlockAudioContextOnce() {
  if (audioContextUnlocked || typeof window === 'undefined') return;
  audioContextUnlocked = true;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioContextClass) {
      const ctx = new AudioContextClass();
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
    }
  } catch {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', unlockAudioContextOnce, { once: true, passive: true });
  window.addEventListener('keydown', unlockAudioContextOnce, { once: true, passive: true });
  window.addEventListener('touchstart', unlockAudioContextOnce, { once: true, passive: true });
}

/**
 * Проигрывает звуковой сигнал и тактильный виброотклик (HTML5 Audio + Web Audio + Haptics)
 */
function playChime() {
  unlockAudioContextOnce();

  // Вибрация на телефонах (Android / Web)
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([80, 40, 80]);
    }
  } catch {}

  try {
    const wavUrl = createChimeWavDataUrl();
    if (wavUrl) {
      const audio = new Audio(wavUrl);
      audio.volume = 0.9;
      void audio.play().catch(() => {});
    }
  } catch {}

  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch {
    // ignore
  }
}

/**
 * Универсальный кроссплатформенный слушатель уведомлений (.exe, .apk, Web):
 * Автоматически запрашивает разрешение на всех платформах без лишних кнопок
 * и фильтрует события согласно настройкам раздела «Уведомления» в /settings.
 */
export function NotificationListener() {
  const router = useRouter();
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const meRef = useRef<Profile | null>(null);

  function pushAlert(title: string, body: string, url?: string, badge?: string, forceSilent = false) {
    const prefs = getNotificationPrefs();
    if (!prefs.enabled) return;

    if (prefs.sound && !forceSilent) {
      playChime();
    }

    // Отправляем нативное уведомление ОС (.exe Windows Toast / .apk Android NotificationManager / Web Push)
    void sendNativeOrWebNotification({
      title,
      body,
      url,
      silent: !prefs.sound || forceSilent,
      onNavigate: (targetUrl) => router.push(targetUrl),
    });

    // Всплывающее уведомление внутри приложения (In-App Toast)
    const toastId = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { id: toastId, title, body, url, badge }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 5000);
  }

  const handledMessageIdsRef = useRef<Set<string>>(new Set());
  const chatsByIdRef = useRef<Map<string, { type: string; title: string | null }>>(new Map());
  const myMembershipSetRef = useRef<Set<string>>(new Set());
  const profilesByIdRef = useRef<Map<string, { display_name: string; username: string }>>(new Map());
  const lastCheckedIsoRef = useRef<string>(new Date().toISOString());

  async function handleIncomingMessage(
    row: any,
    senderProfile?: any,
    hintChatType?: string,
    hintChatTitle?: string | null
  ) {
    if (!row || !row.id || !meRef.current) return;
    if (row.sender_id === meRef.current.id) return;
    if (handledMessageIdsRef.current.has(row.id)) return;
    handledMessageIdsRef.current.add(row.id);
    if (handledMessageIdsRef.current.size > 300) {
      const first = handledMessageIdsRef.current.values().next().value;
      if (first) handledMessageIdsRef.current.delete(first);
    }

    if (row.sent_at && row.sent_at > lastCheckedIsoRef.current) {
      lastCheckedIsoRef.current = row.sent_at;
    }

    if (senderProfile?.display_name && row.sender_id) {
      profilesByIdRef.current.set(row.sender_id, {
        display_name: senderProfile.display_name,
        username: senderProfile.username || '',
      });
    }
    if (hintChatType && row.chat_id) {
      chatsByIdRef.current.set(row.chat_id, {
        type: hintChatType,
        title: hintChatTitle ?? null,
      });
    }

    // Прокидываем событие для списка чатов, чтобы ChatListPanel не создавал дублирующий канал
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('pixchats:realtime_message', {
          detail: {
            row,
            sender: senderProfile,
            chatType: hintChatType,
            chatTitle: hintChatTitle,
          },
        })
      );
    }

    const prefs = getNotificationPrefs();
    if (!prefs.enabled) return;

    // Если мы точно знаем список наших чатов и этот чат не наш — проверяем членство в кэше/БД
    if (
      myMembershipSetRef.current.size > 0 &&
      !myMembershipSetRef.current.has(row.chat_id) &&
      !hintChatType
    ) {
      try {
        const supabase = getSupabaseClient();
        const { data: memberRow } = await supabase
          .from('chat_members')
          .select('chat_id')
          .eq('chat_id', row.chat_id)
          .eq('user_id', meRef.current.id)
          .maybeSingle();
        if (!memberRow) return;
        myMembershipSetRef.current.add(row.chat_id);
      } catch {
        return;
      }
    }

    try {
      const mutes = await getMuteStates([row.chat_id], meRef.current.id);
      if (mutes[row.chat_id]?.muted) return;
    } catch {
      // ignore
    }

    // Проверяем, открыт ли именно этот чат прямо сейчас в активном видимом окне
    const isActivelyViewingThisChat =
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      (window.location.pathname === '/chat' || window.location.pathname === '/chat/') &&
      new URLSearchParams(window.location.search).get('id') === String(row.chat_id);

    if (isActivelyViewingThisChat) {
      if (prefs.sound) {
        playChime();
      }
      return;
    }

    const supabase = getSupabaseClient();
    const cachedSender = senderProfile || profilesByIdRef.current.get(row.sender_id);
    const cachedChat =
      (hintChatType ? { type: hintChatType, title: hintChatTitle ?? null } : null) ||
      chatsByIdRef.current.get(row.chat_id);

    const [{ data: sender }, { data: chatRow }] = await Promise.all([
      cachedSender
        ? Promise.resolve({ data: cachedSender })
        : supabase
            .from('profiles')
            .select('display_name, username')
            .eq('id', row.sender_id)
            .maybeSingle(),
      cachedChat
        ? Promise.resolve({ data: cachedChat })
        : supabase
            .from('chats')
            .select('type, title')
            .eq('id', row.chat_id)
            .maybeSingle(),
    ]);

    if (sender && row.sender_id) {
      profilesByIdRef.current.set(row.sender_id, {
        display_name: sender.display_name || 'Пользователь',
        username: sender.username || '',
      });
    }
    if (chatRow && row.chat_id) {
      chatsByIdRef.current.set(row.chat_id, {
        type: chatRow.type || 'direct',
        title: chatRow.title ?? null,
      });
    }

    const rawDecrypted = row.ciphertext
      ? await decryptMessageE2EE(row.chat_id, row.ciphertext)
      : row.text || '';
    const isSilentMsg = rawDecrypted.startsWith('__SILENT__:');
    const decrypted = isSilentMsg ? rawDecrypted.slice('__SILENT__:'.length) : rawDecrypted;
    const text =
      row.message_type !== 'text' && MEDIA_LABELS[row.message_type]
        ? MEDIA_LABELS[row.message_type]
        : decrypted;

    const me = meRef.current;
    const isMention = Boolean(me?.username && text.includes(`@${me.username}`));
    const isDirect = !chatRow || chatRow.type === 'direct';

    if (isMention) {
      if (!prefs.mentions && !(isDirect ? prefs.directMessages : prefs.groupMessages)) {
        return;
      }
    } else if (isDirect) {
      if (!prefs.directMessages) return;
    } else {
      if (!prefs.groupMessages) return;
    }

    const title = isMention
      ? `📣 ${sender?.display_name ?? 'Кто-то'} упомянул вас`
      : isDirect
        ? `${isSilentMsg ? '🔇 ' : ''}${sender?.display_name ?? 'Новое сообщение'}`
        : `${chatRow?.title ?? 'Группа'}: ${sender?.display_name ?? 'Сообщение'}`;

    pushAlert(title, text, `/chat/?id=${row.chat_id}`, isSilentMsg ? '🔇' : '💬', isSilentMsg);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Автоматически запрашиваем разрешение на уведомления и регистрируем Service Worker везде (Android APK, Windows EXE, Web)
    ensureNotificationPermissionEverywhere();

    // Подписка на переход по клику на нативное уведомление в Windows (.exe)
    let unsubscribeDesktopNav: (() => void) | void | undefined;
    if (window.pixchatsDesktop?.onNavigate) {
      unsubscribeDesktopNav = window.pixchatsDesktop.onNavigate((targetUrl: string) => {
        if (targetUrl) router.push(targetUrl);
      });
    }

    // Подписка на переход по клику на нативное уведомление в Android (.apk) или Service Worker
    const onAndroidNavigate = (e: Event) => {
      const custom = e as CustomEvent<{ url?: string }>;
      if (custom.detail?.url) {
        router.push(custom.detail.url);
      }
    };
    window.addEventListener('pixchats:native_navigate', onAndroidNavigate);

    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    let globalMsgChannel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    let personalChannel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    let adminAlertsChannel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;
    let stopDeviceMonitor: (() => void) | null = null;
    let wakeupInterval: ReturnType<typeof setInterval> | null = null;
    let checkingMissed = false;

    const checkMissedMessages = async () => {
      const me = meRef.current;
      if (!me || checkingMissed) return;
      const chatIds = Array.from(myMembershipSetRef.current);
      if (chatIds.length === 0) return;

      checkingMissed = true;
      try {
        const sinceIso = lastCheckedIsoRef.current;
        const nowIso = new Date().toISOString();
        const supabase = getSupabaseClient();
        const { data: missedRows } = await supabase
          .from('messages')
          .select('id, chat_id, sender_id, text, ciphertext, message_type, media_path, caption, sent_at, is_deleted')
          .in('chat_id', chatIds.slice(0, 60))
          .gt('sent_at', sinceIso)
          .neq('sender_id', me.id)
          .eq('is_deleted', false)
          .order('sent_at', { ascending: true })
          .limit(10);

        lastCheckedIsoRef.current = nowIso;
        if (missedRows && missedRows.length > 0) {
          for (const row of missedRows) {
            await handleIncomingMessage(row);
          }
        }
      } catch {
        // ignore network hiccup
      } finally {
        checkingMissed = false;
      }
    };

    const onVisibilityOrWakeup = () => {
      if (document.visibilityState === 'visible') {
        void checkMissedMessages();
      }
    };
    const onOnline = () => {
      void checkMissedMessages();
    };

    window.addEventListener('visibilitychange', onVisibilityOrWakeup);
    window.addEventListener('focus', onVisibilityOrWakeup);
    window.addEventListener('online', onOnline);

    (async () => {
      const me = await getCurrentProfile();
      if (!me) return;
      meRef.current = me;

      stopDeviceMonitor = startDeviceSessionMonitor(me.id, () => {
        router.push('/login/');
      });

      const supabase = getSupabaseClient();

      // Предзагружаем список чатов пользователя в память один раз, чтобы уведомления срабатывали мгновенно без запросов к БД
      try {
        const { data: memberRows } = await supabase
          .from('chat_members')
          .select('chat_id')
          .eq('user_id', me.id);
        const ids = (memberRows ?? []).map((r: any) => r.chat_id);
        myMembershipSetRef.current = new Set(ids);
        if (ids.length > 0) {
          const { data: chatRows } = await supabase
            .from('chats')
            .select('id, type, title')
            .in('id', ids);
          for (const c of chatRows ?? []) {
            chatsByIdRef.current.set(c.id, { type: c.type, title: c.title });
          }
        }
      } catch {
        // ignore
      }

      // 1. Личный канал уведомлений пользователя (доходит мгновенно на телефоны и ПК)
      personalChannel = supabase
        .channel(`pixchats-user-notifications:${me.id}`)
        .on('broadcast', { event: 'new-message' }, (data: any) => {
          const payload = data?.payload;
          const msg = payload?.message || payload;
          const sender = payload?.sender;
          if (msg) {
            void handleIncomingMessage(msg, sender, payload?.chatType, payload?.chatTitle);
          }
        })
        .subscribe();

      // 2. Единый глобальный канал сообщений (переиспользуется sendMessage и ChatListPanel без коллизий!)
      globalMsgChannel = supabase
        .channel('pixchats-messages-global')
        .on('broadcast', { event: 'new-message' }, (data: any) => {
          const payload = data?.payload;
          const msg = payload?.message || payload;
          const sender = payload?.sender;
          const targetIds = payload?.targetUserIds;
          if (
            msg &&
            (!targetIds ||
              targetIds.length === 0 ||
              targetIds.includes(me.id) ||
              myMembershipSetRef.current.has(msg.chat_id))
          ) {
            void handleIncomingMessage(msg, sender, payload?.chatType, payload?.chatTitle);
          }
        })
        .subscribe();

      (window as any).__pixchatsGlobalMsgChannel = globalMsgChannel;

      channel = supabase
        .channel('pixchats-omniscient-notifications')
        // 1. Новые входящие сообщения (Postgres changes)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          (payload: any) => {
            void handleIncomingMessage(payload.new);
          }
        )
        .on('broadcast', { event: 'new-message' }, (data: any) => {
          const payload = data?.payload;
          const msg = payload?.message || payload;
          const sender = payload?.sender;
          if (msg) void handleIncomingMessage(msg, sender, payload?.chatType, payload?.chatTitle);
        })
        // 2. Дружба: новые входящие заявки и принятые запросы
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'friendships' },
          async (payload: any) => {
            const row = payload.new;
            if (!row) return;

            const prefs = getNotificationPrefs();
            if (!prefs.enabled || !prefs.friendRequests) return;

            if (row.addressee_id === me.id && row.status === 'pending') {
              const { data: sender } = await supabase
                .from('profiles')
                .select('display_name')
                .eq('id', row.requester_id)
                .maybeSingle();
              pushAlert(
                '👤 Заявка в друзья',
                `${sender?.display_name ?? 'Пользователь'} хочет добавить вас в друзья`,
                '/friends',
                '👤'
              );
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'friendships' },
          async (payload: any) => {
            const row = payload.new;
            if (!row) return;

            const prefs = getNotificationPrefs();
            if (!prefs.enabled || !prefs.friendRequests) return;

            if (row.requester_id === me.id && row.status === 'accepted') {
              const { data: friend } = await supabase
                .from('profiles')
                .select('display_name')
                .eq('id', row.addressee_id)
                .maybeSingle();
              pushAlert(
                '🤝 Заявка принята',
                `${friend?.display_name ?? 'Пользователь'} принял(а) вашу заявку в друзья`,
                '/friends',
                '🤝'
              );
            }
          }
        )
        // 3. Добавление в группы и каналы
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'chat_members' },
          async (payload: any) => {
            const row = payload.new;
            if (!row || row.user_id !== me.id) return;
            myMembershipSetRef.current.add(row.chat_id);

            const prefs = getNotificationPrefs();
            if (!prefs.enabled || !prefs.chatInvites) return;

            const { data: chatRow } = await supabase
              .from('chats')
              .select('title, type')
              .eq('id', row.chat_id)
              .maybeSingle();

            if (chatRow) {
              chatsByIdRef.current.set(row.chat_id, { type: chatRow.type, title: chatRow.title });
            }

            if (chatRow && chatRow.type !== 'direct') {
              const typeLabel = chatRow.type === 'channel' ? 'канал' : 'группу';
              pushAlert(
                '👥 Добавление в чат',
                `Вас добавили в ${typeLabel} "${chatRow.title}"`,
                `/chat/?id=${row.chat_id}`,
                '👥'
              );
            }
          }
        )
        // 4. Обновление статуса своего профиля (роль, верификация, бейдж)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'profiles' },
          (payload: any) => {
            const row = payload.new;
            if (!row || row.id !== me.id) return;

            const old = meRef.current;
            meRef.current = row;
            if (!old) return;

            const prefs = getNotificationPrefs();
            if (!prefs.enabled || !prefs.accountEvents) return;

            if (row.role !== old.role) {
              pushAlert('⭐ Новая роль', `Ваша роль изменена на: ${row.role}`, '/profile', '⭐');
            } else if (row.is_verified && !old.is_verified) {
              pushAlert('✓ Верификация', 'Ваш аккаунт получил официальную галочку верификации!', '/profile', '✓');
            } else if (row.is_pixset_employee && !old.is_pixset_employee) {
              pushAlert('🛡️ Сотрудник Pixset Studio', 'Вам присвоен бейдж сотрудника Pixset Studio!', '/profile', '🛡️');
            } else if (row.frozen && !old.frozen) {
              pushAlert('❄️ Заморозка', 'Ваш аккаунт был временно заморожен администратором', '/chats', '❄️');
            }
          }
        )
        .subscribe();

      // 0. Канал экстренных уведомлений для модераторов и администраторов
      if (me.role === 'admin' || me.role === 'developer' || me.role === 'moderator') {
        adminAlertsChannel = supabase
          .channel('pixchats-admin-alerts')
          .on('broadcast', { event: 'account-frozen-alert' }, (data: any) => {
            const payload = data?.payload;
            if (payload?.userName && payload?.reason) {
              pushAlert(
                '🚨 Автозаморозка аккаунта',
                `Пользователь @${payload.userName} был заморожен. Причина: ${payload.reason}`,
                '/admin',
                '🚨'
              );
            }
          })
          .subscribe();
      }

      // Проверка дней рождения друзей (1 раз в сутки)
      try {
        await syncExtendedProfilesFromCloud(false);
        const todayKey = new Date().toISOString().slice(0, 10);
        const notifiedKey = `pixchats:birthday_notified:${me.id}:${todayKey}`;
        if (!localStorage.getItem(notifiedKey)) {
          const friendsList = await getFriends(me.id);
          const birthdayFriends = friendsList.filter((f) => {
            const ext = getExtendedProfile(f.friend_profile.id, f.friend_profile.username);
            return isBirthdayToday(ext.birthDate);
          });
          if (birthdayFriends.length > 0) {
            localStorage.setItem(notifiedKey, '1');
            for (const bf of birthdayFriends) {
              pushAlert(
                '🎂 День рождения друга!',
                `Сегодня день рождения у ${bf.friend_profile.display_name} (@${bf.friend_profile.username})! Нажмите, чтобы отправить поздравление 🎉`,
                `/user/?id=${bf.friend_profile.id}`,
                '🎂'
              );
            }
          }
        }
      } catch {}

      // Фоновая подстраховка для телефонов и ПК + автоотправка отложенных сообщений
      wakeupInterval = setInterval(() => {
        void checkMissedMessages();
        const due = popDueScheduledMessages();
        if (due.length > 0) {
          for (const item of due) {
            const payloadText = item.silent ? `__SILENT__:${item.text}` : item.text;
            void sendMessage(item.chatId, payloadText).catch(() => {});
          }
        }
      }, 15000);
    })();

    return () => {
      if (unsubscribeDesktopNav) unsubscribeDesktopNav();
      if (stopDeviceMonitor) stopDeviceMonitor();
      if (wakeupInterval) clearInterval(wakeupInterval);
      window.removeEventListener('pixchats:native_navigate', onAndroidNavigate);
      window.removeEventListener('visibilitychange', onVisibilityOrWakeup);
      window.removeEventListener('focus', onVisibilityOrWakeup);
      window.removeEventListener('online', onOnline);
      if ((window as any).__pixchatsGlobalMsgChannel === globalMsgChannel) {
        delete (window as any).__pixchatsGlobalMsgChannel;
      }
      if (channel) getSupabaseClient().removeChannel(channel);
      if (globalMsgChannel) getSupabaseClient().removeChannel(globalMsgChannel);
      if (personalChannel) getSupabaseClient().removeChannel(personalChannel);
      if (adminAlertsChannel) getSupabaseClient().removeChannel(adminAlertsChannel);
    };
  }, [router]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        left: 'auto',
        maxWidth: 360,
        width: 'calc(100% - 32px)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          onClick={() => {
            if (toast.url) router.push(toast.url);
          }}
          style={{
            pointerEvents: 'auto',
            background: 'var(--surface-raised)',
            border: '1px solid var(--accent)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            borderRadius: 10,
            padding: '12px 14px',
            color: 'var(--text)',
            cursor: toast.url ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            animation: 'fadeInUp 0.25s ease both',
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            {toast.badge || '🔔'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>{toast.title}</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {toast.body}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setToasts((prev) => prev.filter((t) => t.id !== toast.id));
            }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: 4,
              fontSize: 14,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
