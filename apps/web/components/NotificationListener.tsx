'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, getSupabaseClient, getMuteStates, decryptMessageE2EE } from '@pixchats/core';
import type { Profile } from '@pixchats/core';
import { getNotificationPrefs } from '../lib/notificationPrefs';
import {
  ensureNotificationPermissionEverywhere,
  sendNativeOrWebNotification,
} from '../lib/nativePlatform';
import { startDeviceSessionMonitor } from '../lib/deviceSessions';

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

  function pushAlert(title: string, body: string, url?: string, badge?: string) {
    const prefs = getNotificationPrefs();
    if (!prefs.enabled) return;

    if (prefs.sound) {
      playChime();
    }

    // Отправляем нативное уведомление ОС (.exe Windows Toast / .apk Android NotificationManager / Web Push)
    void sendNativeOrWebNotification({
      title,
      body,
      url,
      silent: !prefs.sound,
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

  async function handleIncomingMessage(row: any, senderProfile?: any) {
    if (!row || !row.id || !meRef.current) return;
    if (row.sender_id === meRef.current.id) return;
    if (handledMessageIdsRef.current.has(row.id)) return;
    handledMessageIdsRef.current.add(row.id);
    if (handledMessageIdsRef.current.size > 200) {
      const first = handledMessageIdsRef.current.values().next().value;
      if (first) handledMessageIdsRef.current.delete(first);
    }

    const prefs = getNotificationPrefs();
    if (!prefs.enabled) return;

    try {
      const mutes = await getMuteStates([row.chat_id], meRef.current.id);
      if (mutes[row.chat_id]?.muted) return;
    } catch {
      // ignore
    }

    // Проверяем, открыт ли именно этот чат прямо сейчас в активном окне
    const isActivelyViewingThisChat =
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      (window.location.pathname === '/chat' || window.location.pathname === '/chat/') &&
      new URLSearchParams(window.location.search).get('id') === String(row.chat_id);

    if (isActivelyViewingThisChat) {
      // Пользователь уже в этом чате: не перекрываем экран баннером, но воспроизводим звук сообщения!
      if (prefs.sound) {
        playChime();
      }
      return;
    }

    const supabase = getSupabaseClient();
    const [{ data: sender }, { data: chatRow }] = await Promise.all([
      senderProfile
        ? Promise.resolve({ data: senderProfile })
        : supabase
            .from('profiles')
            .select('display_name, username')
            .eq('id', row.sender_id)
            .maybeSingle(),
      supabase
        .from('chats')
        .select('type, title')
        .eq('id', row.chat_id)
        .maybeSingle(),
    ]);

    const decrypted = row.ciphertext
      ? await decryptMessageE2EE(row.chat_id, row.ciphertext)
      : row.text || '';
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
        ? (sender?.display_name ?? 'Новое сообщение')
        : `${chatRow?.title ?? 'Группа'}: ${sender?.display_name ?? 'Сообщение'}`;

    pushAlert(title, text, `/chat/?id=${row.chat_id}`, '💬');
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Автоматически запрашиваем разрешение на уведомления сразу везде (Android APK, Windows EXE, Web)
    ensureNotificationPermissionEverywhere();

    // Подписка на переход по клику на нативное уведомление в Windows (.exe)
    let unsubscribeDesktopNav: (() => void) | undefined;
    if (window.pixchatsDesktop?.onNavigate) {
      unsubscribeDesktopNav = window.pixchatsDesktop.onNavigate((targetUrl: string) => {
        if (targetUrl) router.push(targetUrl);
      });
    }

    // Подписка на переход по клику на нативное уведомление в Android (.apk)
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

    (async () => {
      const me = await getCurrentProfile();
      if (!me) return;
      meRef.current = me;

      stopDeviceMonitor = startDeviceSessionMonitor(me.id, () => {
        router.push('/login/');
      });

      const supabase = getSupabaseClient();

      // 1. Личный канал уведомлений пользователя (как в звонках — доходит 100% на любое устройство)
      personalChannel = supabase
        .channel(`pixchats-user-notifications:${me.id}`)
        .on('broadcast', { event: 'new-message' }, (data: any) => {
          const msg = data?.payload?.message || data?.payload;
          const sender = data?.payload?.sender;
          if (msg) void handleIncomingMessage(msg, sender);
        })
        .subscribe();

      // 2. Глобальный канал сообщений для групп и каналов
      globalMsgChannel = supabase
        .channel('pixchats-messages-global')
        .on('broadcast', { event: 'new-message' }, (data: any) => {
          const payload = data?.payload;
          const msg = payload?.message || payload;
          const sender = payload?.sender;
          const targetIds = payload?.targetUserIds;
          if (msg && (!targetIds || targetIds.length === 0 || targetIds.includes(me.id))) {
            void handleIncomingMessage(msg, sender);
          }
        })
        .subscribe();

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
          const msg = data?.payload?.message || data?.payload;
          const sender = data?.payload?.sender;
          if (msg) void handleIncomingMessage(msg, sender);
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

            const prefs = getNotificationPrefs();
            if (!prefs.enabled || !prefs.chatInvites) return;

            const { data: chatRow } = await supabase
              .from('chats')
              .select('title, type')
              .eq('id', row.chat_id)
              .maybeSingle();

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
              pushAlert('🛡️ Сотрудник Pixset', 'Вам присвоен бейдж сотрудника Pixset Studio!', '/profile', '🛡️');
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
    })();

    return () => {
      if (unsubscribeDesktopNav) unsubscribeDesktopNav();
      if (stopDeviceMonitor) stopDeviceMonitor();
      window.removeEventListener('pixchats:native_navigate', onAndroidNavigate);
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
