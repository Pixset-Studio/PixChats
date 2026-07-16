'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient, getCurrentProfile, hasActiveSession, signOut } from '@pixchats/core';
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

  if (loading) return <p style={{ padding: 24 }}>Загрузка...</p>;
  if (!profile) return null;

  return (
    <main style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>
          @{profile.username}
          <NameBadges role={profile.role} isVerified={profile.is_verified} />
        </h1>
        <button onClick={async () => { await signOut(); router.push('/login'); }}>Выйти</button>
      </header>

      <p>{profile.display_name}</p>

      {(profile.role === 'admin' || profile.role === 'developer' || profile.role === 'moderator') && (
        <a href="/admin" style={{ display: 'inline-block', margin: '12px 0' }}>
          ⚙️ Панель управления
        </a>
      )}

      <h2>Ваши чаты</h2>
      <a href="/chats/new" style={{ display: 'inline-block', margin: '8px 0' }}>+ Новая группа/канал</a>
      {chats.length === 0 && <p>Пока нет ни одного чата, группы или канала.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {chats.map((chat) => (
          <li key={chat.id} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
            <a href={`/chats/${chat.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
              <strong>{chat.title ?? TYPE_LABEL[chat.type]}</strong>
              {chat.is_verified && <span style={{ color: '#2b8aef', marginLeft: 4 }}>✔️</span>}
              <span style={{ color: '#888', marginLeft: 8, fontSize: 12 }}>
                {TYPE_LABEL[chat.type]}
                {chat.visibility ? ` · ${chat.visibility === 'public' ? 'публичный' : 'приватный'}` : ''}
                {chat.username ? ` · @${chat.username}` : ''}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
