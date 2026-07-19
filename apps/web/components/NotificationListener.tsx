'use client';

import { useEffect } from 'react';
import { getCurrentProfile, getSupabaseClient, getMuteStates } from '@pixchats/core';

const MEDIA_LABELS: Record<string, string> = {
  image: '📷 Фото',
  video: '🎥 Видео',
  audio: '🎵 Аудио',
  voice: '🎤 Голосовое сообщение',
  file: '📎 Файл',
};

function decodeText(ciphertext: string): string {
  try {
    return decodeURIComponent(escape(atob(ciphertext)));
  } catch {
    return 'Новое сообщение';
  }
}

/**
 * Монтируется один раз в корневом layout — живёт поверх всей навигации.
 * Просит разрешение на уведомления и слушает INSERT по messages без фильтра:
 * Supabase Realtime сам не пришлёт строки, к которым нет доступа по RLS,
 * поэтому фактически долетают только сообщения из чатов, где пользователь состоит.
 */
export function NotificationListener() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    let channel: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null;

    (async () => {
      if (Notification.permission === 'default') {
        try {
          await Notification.requestPermission();
        } catch {
          // пользователь мог закрыть диалог — не страшно
        }
      }

      const me = await getCurrentProfile();
      if (!me) return;

      const supabase = getSupabaseClient();
      channel = supabase
        .channel('global-notifications')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          async (payload: any) => {
            const row = payload.new;
            if (!row || row.sender_id === me.id) return;
            if (Notification.permission !== 'granted') return;

            try {
              const mutes = await getMuteStates([row.chat_id], me.id);
              if (mutes[row.chat_id]?.muted) return;
            } catch {
              return;
            }

            // Не дублировать уведомление, если человек прямо сейчас смотрит именно этот чат
            if (
              window.location.pathname.includes('/chat/') &&
              window.location.search.includes(String(row.chat_id))
            ) {
              return;
            }

            const { data: sender } = await supabase
              .from('profiles')
              .select('display_name')
              .eq('id', row.sender_id)
              .maybeSingle();

            const body = row.message_type !== 'text' && MEDIA_LABELS[row.message_type]
              ? MEDIA_LABELS[row.message_type]
              : decodeText(row.ciphertext);

            const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
            new Notification(sender?.display_name ?? 'PixChats', {
              body,
              icon: `${basePath}/logo/icon.png`,
            });
          }
        )
        .subscribe();
    })();

    return () => {
      if (channel) getSupabaseClient().removeChannel(channel);
    };
  }, []);

  return null;
}
