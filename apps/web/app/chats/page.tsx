'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getSupabaseClient,
  getCurrentProfile,
  hasActiveSession,
  ensureKeyBundle,
  getLastMessagesForChats,
  getDirectChatPartners,
} from '@pixchats/core';
import type { Chat, Profile, Message } from '@pixchats/core';
import { NameBadges } from '../../components/NameBadges';
import { BottomNav } from '../../components/BottomNav';

const TYPE_LABEL: Record<Chat['type'], string> = {
  direct: 'Личный чат',
  group: 'Группа',
  channel: 'Канал',
};

type Folder = 'all' | 'direct' | 'group' | 'channel';

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

export default function ChatsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [previews, setPreviews] = useState<Record<string, Message>>({});
  const [partners, setPartners] = useState<Record<string, Profile>>({});
  const [folder, setFolder] = useState<Folder>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login');
        return;
      }
      const me = await getCurrentProfile();
      if (!me) {
        router.push('/complete-profile');
        return;
      }
      setProfile(me);
      await ensureKeyBundle(me);
      if (typeof window !== 'undefined') {
        localStorage.setItem('pixchats:theme', me.theme);
        document.documentElement.setAttribute('data-theme', me.theme);
      }

      const supabase = getSupabaseClient();
      const { data: memberRows } = await supabase.from('chat_members').select('chat_id').eq('user_id', me.id);
      const chatIds = (memberRows ?? []).map((r) => r.chat_id);

      if (chatIds.length > 0) {
        const { data: chatRows } = await supabase.from('chats').select('*').in('id', chatIds);
        setChats(chatRows ?? []);
        setPreviews(await getLastMessagesForChats(chatIds));

        const directIds = (chatRows ?? []).filter((c) => c.type === 'direct').map((c) => c.id);
        setPartners(await getDirectChatPartners(directIds, me.id));
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;
  if (!profile) return null;

  const filtered = chats.filter((c) => folder === 'all' || c.type === folder);
  const sorted = [...filtered].sort((a, b) => {
    const ta = previews[a.id]?.sent_at ?? a.created_at;
    const tb = previews[b.id]?.sent_at ?? b.created_at;
    return new Date(tb).getTime() - new Date(ta).getTime();
  });

  return (
    <>
      <main className="container-wide with-bottom-nav">
        <header className="app-header">
          <span className="brand" style={{ fontSize: 18 }}>
            PixChats<span className="brand-dot" />
          </span>
          <Link href="/chats/new" className="btn btn-primary" style={{ width: 'auto', padding: '8px 16px' }}>
            + Создать
          </Link>
        </header>

        <div className="folder-tabs">
          <button className={`folder-tab ${folder === 'all' ? 'active' : ''}`} onClick={() => setFolder('all')}>
            Все
          </button>
          <button className={`folder-tab ${folder === 'direct' ? 'active' : ''}`} onClick={() => setFolder('direct')}>
            Личные
          </button>
          <button className={`folder-tab ${folder === 'group' ? 'active' : ''}`} onClick={() => setFolder('group')}>
            Группы
          </button>
          <button className={`folder-tab ${folder === 'channel' ? 'active' : ''}`} onClick={() => setFolder('channel')}>
            Каналы
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="empty-state">Пока пусто в этой папке.</div>
        ) : (
          <div>
            {sorted.map((chat) => {
              const preview = previews[chat.id];
              const partner = chat.type === 'direct' ? partners[chat.id] : null;
              const displayName = partner ? partner.display_name : chat.title ?? TYPE_LABEL[chat.type];
              const avatarUrl = partner ? partner.avatar_url : chat.avatar_url;
              const isVerified = partner ? partner.is_verified : chat.is_verified;

              return (
                <Link key={chat.id} href={`/chat/?id=${chat.id}`} className="chat-item-preview">
                  <div
                    className="avatar"
                    style={{
                      backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                  >
                    {!avatarUrl && displayName.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="chat-item-body">
                    <div className="chat-item-top-row">
                      <span className="chat-item-name">
                        {displayName}
                        {isVerified && <span className="badge-check" style={{ marginLeft: 4 }}>✔</span>}
                      </span>
                      {preview && <span className="chat-item-time">{formatTime(preview.sent_at)}</span>}
                    </div>
                    <div className="chat-item-preview-text">
                      {preview ? preview.text : `${TYPE_LABEL[chat.type]}${chat.visibility ? ` · ${chat.visibility === 'public' ? 'публичный' : 'приватный'}` : ''}`}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>
      <BottomNav />
    </>
  );
}
