'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getSupabaseClient, getCurrentProfile, hasActiveSession, signOut, ensureKeyBundle } from '@pixchats/core';
import type { Chat, Profile } from '@pixchats/core';
import { NameBadges } from '../../components/NameBadges';

const TYPE_LABEL: Record<Chat['type'], string> = {
  direct: 'Личный чат',
  group: 'Группа',
  channel: 'Канал',
};

export default function ChatsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
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

      const supabase = getSupabaseClient();
      const { data: memberRows } = await supabase
        .from('chat_members')
        .select('chat_id')
        .eq('user_id', me.id);

      const chatIds = (memberRows ?? []).map((r) => r.chat_id);
      if (chatIds.length > 0) {
        const { data: chatRows } = await supabase.from('chats').select('*').in('id', chatIds);
        setChats(chatRows ?? []);
      }
      setLoading(false);
    })();
  }, [router]);

  if (loading) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;
  if (!profile) return null;

  return (
    <main className="container-wide">
      <header className="app-header">
        <div className="profile-line">
          <div className="avatar">{profile.display_name.slice(0, 1).toUpperCase()}</div>
          <div>
            <div style={{ fontWeight: 600 }}>
              @{profile.username}
              <NameBadges role={profile.role} isVerified={profile.is_verified} />
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{profile.display_name}</div>
          </div>
        </div>
        <button
          className="btn btn-ghost"
          style={{ width: 'auto' }}
          onClick={async () => {
            await signOut();
            router.push('/login');
          }}
        >
          Выйти
        </button>
      </header>

      {(profile.role === 'admin' || profile.role === 'developer' || profile.role === 'moderator') && (
        <Link href="/admin" className="btn" style={{ width: 'auto', display: 'inline-flex', marginBottom: 12 }}>
          ⚙ Панель управления
        </Link>
      )}

      <div className="section-title">Ваши чаты</div>
      <Link href="/chats/new" className="btn btn-primary" style={{ width: 'auto', display: 'inline-flex', marginBottom: 16 }}>
        + Новая группа / канал
      </Link>

      {chats.length === 0 ? (
        <div className="empty-state">Пока нет ни одного чата, группы или канала.</div>
      ) : (
        <ul className="chat-list">
          {chats.map((chat) => (
            <li key={chat.id}>
              <Link href={`/chat/?id=${chat.id}`} className="chat-item">
                <div className="avatar">{(chat.title ?? '#').slice(0, 1).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div>
                    <strong>{chat.title ?? TYPE_LABEL[chat.type]}</strong>
                    {chat.is_verified && <span className="badge-check" style={{ marginLeft: 4 }}>✔</span>}
                  </div>
                  <div className="chat-item-meta">
                    {TYPE_LABEL[chat.type]}
                    {chat.visibility ? ` · ${chat.visibility === 'public' ? 'публичный' : 'приватный'}` : ''}
                    {chat.username ? ` · @${chat.username}` : ''}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
