'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, getSupabaseClient, getMuteStates, decryptMessageE2EE } from '@pixchats/core';
import type { Profile } from '@pixchats/core';

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

/**
 * Проигрывает мягкий звуковой сигнал через Web Audio API (без внешних аудио-файлов).
 */
function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch {
    // аудио-контекст может быть заблокирован политикой браузера до первого клика
  }
}

/**
 * Универсальный слушатель push-уведомлений:
 * 1. Новые сообщения и упоминания (@username)
 * 2. Входящие заявки в друзья и принятые заявки
 * 3. Добавление в группы и каналы
 * 4. Изменение статуса профиля и бейджей
 * 5. Интерактивный запрос разрешения на системные Push-уведомления браузера
 */
export function NotificationListener() {
  const router = useRouter();
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const [permState, setPermState] = useState<NotificationPermission | 'unsupported'>('granted');
  const [promptDismissed, setPromptDismissed] = useState(false);
  const meRef = useRef<Profile | null>(null);

  function pushAlert(title: string, body: string, url?: string, badge?: string) {
    playChime();

    // Системное браузерное уведомление (OS Push Notification)
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
      try {
        const notif = new Notification(title, {
          body,
          icon: `${basePath}/logo/icon.png`,
          badge: `${basePath}/logo/icon.png`,
        });
        if (url) {
          notif.onclick = () => {
            window.focus();
            router.push(url);
          };
        }
      } catch {
        // браузерные ограничения
      }
    }

    // Всплывающее уведомление внутри приложения (In-App Toast)
    const toastId = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev.slice(-3), { id: toastId, title, body, url, badge }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 5000);
  }

  async function handleRequestPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const res = await Notification.requestPermission();
      setPermState(res);
      if (res === 'granted') {
        setPromptDismissed(true);
        pushAlert('🔔 Push-уведомления включены', 'Теперь вы будете получать мгновенные уведомления обо всём!', undefined, '🔔');
      }
    } catch {
      // если браузер блокирует в iframe
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!('Notification' in window)) {
      setPermState('unsupported');
    } else {
      setPermState(Notification.permission);
      if (Notification.permission === 'default') {
        // Пробуем запросить сразу и также подписываемся на первый жест пользователя
        Notification.requestPermission()
          .then((res) => setPermState(res))
          .catch(() => {});

        const onFirstGesture = () => {
          if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission()
              .then((res) => setPermState(res))
              .catch(() => {});
          }
          window.removeEventListener('click', onFirstGesture);
        };
        window.addEventListener('click', onFirstGesture, { once: true });
      }
    }

    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;

    (async () => {
      const me = await getCurrentProfile();
      if (!me) return;
      meRef.current = me;

      const supabase = getSupabaseClient();
      channel = supabase
        .channel('pixchats-omniscient-notifications')
        // 1. Новые входящие сообщения
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload: any) => {
            const row = payload.new;
            if (!row || row.sender_id === me.id) return;

            try {
              const mutes = await getMuteStates([row.chat_id], me.id);
              if (mutes[row.chat_id]?.muted) return;
            } catch {
              return;
            }

            // Не показывать, если пользователь прямо сейчас смотрит этот чат
            if (
              window.location.pathname.includes('/chat') &&
              window.location.search.includes(String(row.chat_id))
            ) {
              return;
            }

            const { data: sender } = await supabase
              .from('profiles')
              .select('display_name, username')
              .eq('id', row.sender_id)
              .maybeSingle();

            const decrypted = await decryptMessageE2EE(row.chat_id, row.ciphertext);
            const text = row.message_type !== 'text' && MEDIA_LABELS[row.message_type]
              ? MEDIA_LABELS[row.message_type]
              : decrypted;

            // Проверяем, упоминают ли пользователя
            const isMention = text.includes(`@${me.username}`);
            const title = isMention
              ? `📣 ${sender?.display_name ?? 'Кто-то'} упомянул вас`
              : (sender?.display_name ?? 'Новое сообщение');

            pushAlert(title, text, `/chat/?id=${row.chat_id}`, '💬');
          }
        )
        // 2. Дружба: новые входящие заявки и принятые запросы
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'friendships' },
          async (payload: any) => {
            const row = payload.new;
            if (!row) return;

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

            const { data: chatRow } = await supabase
              .from('chats')
              .select('title, type')
              .eq('id', row.chat_id)
              .maybeSingle();

            if (chatRow) {
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
            if (!old) return;

            if (row.role !== old.role) {
              pushAlert('⭐ Новая роль', `Ваша роль изменена на: ${row.role}`, '/profile', '⭐');
            } else if (row.is_verified && !old.is_verified) {
              pushAlert('✓ Верификация', 'Ваш аккаунт получил официальную галочку верификации!', '/profile', '✓');
            } else if (row.is_pixset_employee && !old.is_pixset_employee) {
              pushAlert('🛡️ Сотрудник Pixset', 'Вам присвоен бейдж сотрудника Pixset Studio!', '/profile', '🛡️');
            } else if (row.frozen && !old.frozen) {
              pushAlert('❄️ Заморозка', 'Ваш аккаунт был временно заморожен администратором', '/chats', '❄️');
            }
            meRef.current = row;
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) getSupabaseClient().removeChannel(channel);
    };
  }, [router]);

  const showPermissionBanner = permState === 'default' && !promptDismissed;

  if (toasts.length === 0 && !showPermissionBanner) return null;

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
      {showPermissionBanner && (
        <div
          style={{
            pointerEvents: 'auto',
            background: 'var(--surface-raised)',
            border: '1.5px solid var(--accent)',
            boxShadow: '0 8px 28px rgba(0, 0, 0, 0.55)',
            borderRadius: 10,
            padding: '12px 14px',
            color: 'var(--text)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
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
              🔔
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--accent)' }}>
                Включить Push-уведомления
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.35 }}>
                Разрешите доступ к уведомлениям, чтобы получать сообщения и заявки в реальном времени.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPromptDismissed(true)}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                fontSize: 14,
                lineHeight: 1,
              }}
              title="Скрыть"
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto', padding: '6px 14px', fontSize: 12 }}
              onClick={handleRequestPermission}
            >
              Разрешить доступ
            </button>
          </div>
        </div>
      )}
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
