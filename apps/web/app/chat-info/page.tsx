'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getSupabaseClient,
  getCurrentProfile,
  getChatMemberCount,
  getMyChatRole,
  updateChatInfo,
  uploadChatAvatar,
  joinPublicChat,
  leaveChat,
} from '@pixchats/core';
import type { Chat, Profile } from '@pixchats/core';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { buildAppUrl } from '../../lib/url';

const TYPE_LABEL: Record<Chat['type'], string> = {
  direct: 'Личный чат',
  group: 'Группа',
  channel: 'Канал',
};

function ChatInfoInner() {
  const searchParams = useSearchParams();
  const chatId = searchParams.get('id') ?? '';
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [me, setMe] = useState<Profile | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!chatId) {
      router.push('/chats');
      return;
    }
    (async () => {
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).single();
      setChat(chatRow);
      setTitle(chatRow?.title ?? '');
      setDescription(chatRow?.description ?? '');
      setUsername(chatRow?.username ?? '');

      setMemberCount(await getChatMemberCount(chatId));
      const role = await getMyChatRole(chatId, profile.id);
      setMyRole(role);
      setCanEdit(role === 'owner' || role === 'admin');
    })();
  }, [chatId, router]);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!chat || !e.target.files?.[0]) return;
    setUploading(true);
    setError(null);
    try {
      const url = await uploadChatAvatar(chat.id, e.target.files[0]);
      setChat({ ...chat, avatar_url: url });
    } catch (err: any) {
      setError(err.message ?? 'Не удалось загрузить аватар');
    } finally {
      setUploading(false);
    }
  }

  async function handleSave() {
    if (!chat) return;
    setError(null);
    try {
      await updateChatInfo(chat.id, {
        title,
        description,
        username: chat.visibility === 'public' ? username : null,
      });
      setChat({ ...chat, title, description, username: chat.visibility === 'public' ? username : null });
      setNotice('Изменения сохранены');
      setEditing(false);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить');
    }
  }

  async function handleJoin() {
    if (!chat) return;
    await joinPublicChat(chat);
    setMyRole(chat.type === 'channel' ? 'subscriber' : 'member');
    setMemberCount((c) => c + 1);
  }

  async function handleLeave() {
    if (!chat || !me) return;
    await leaveChat(chat.id, me.id);
    setMyRole(null);
    setMemberCount((c) => Math.max(0, c - 1));
    router.push('/chats');
  }

  if (!chat || !me) return <p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>;

  return (
    <main className="container-wide">
      <Link href={`/chat/?id=${chat.id}`} style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none' }}>
        ← Назад в чат
      </Link>

      <div className="profile-hero">
        <div
          className="avatar"
          style={{
            backgroundImage: chat.avatar_url ? `url(${chat.avatar_url})` : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!chat.avatar_url && (chat.title ?? '#').slice(0, 1).toUpperCase()}
        </div>
        <h2>
          {chat.title}
          {chat.is_verified && <VerifiedBadge size={18} />}
        </h2>
        <div className="username">
          {TYPE_LABEL[chat.type]} · {memberCount} {chat.type === 'channel' ? 'подписчиков' : 'участников'}
          {chat.username ? ` · @${chat.username}` : ''}
        </div>

        <div className="btn-row" style={{ maxWidth: 320, margin: '12px auto 0', flexDirection: 'row', flexWrap: 'wrap' }}>
          {canEdit && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              ✎ Редактировать
            </button>
          )}
          {canEdit && (
            <Link href={`/chat-members/?id=${chat.id}`} className="btn">
              {chat.type === 'channel' ? 'Подписчики' : 'Участники'} ({memberCount})
            </Link>
          )}
          {chat.type !== 'direct' &&
            (myRole ? (
              <button className="btn" onClick={handleLeave} style={{ color: 'var(--danger)' }}>
                {chat.type === 'channel' ? 'Отписаться' : 'Покинуть группу'}
              </button>
            ) : (
              chat.visibility === 'public' && (
                <button className="btn btn-primary" onClick={handleJoin}>
                  {chat.type === 'channel' ? 'Подписаться' : 'Вступить'}
                </button>
              )
            ))}
        </div>
      </div>

      {chat.visibility === 'public' && chat.username && (
        <div className="card" style={{ maxWidth: 420, margin: '0 auto 12px', textAlign: 'center', fontSize: 13 }}>
          <span style={{ color: 'var(--text-muted)' }}>Ссылка: </span>
          <a href={buildAppUrl(`/chat/?id=${chat.id}`)} style={{ color: 'var(--accent)' }}>
            {buildAppUrl(`/chat/?id=${chat.id}`).replace(/^https?:\/\//, '')}
          </a>
        </div>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {editing ? (
        <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <button className="btn" style={{ width: 'auto' }} onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? 'Загружаем…' : '📷 Сменить аватар'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarChange} />
          </div>

          <div className="field">
            <label>Название</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label>Описание</label>
            <textarea
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {chat.visibility === 'public' && (
            <div className="field">
              <label>Юзернейм</label>
              <div className="input-prefix">
                <span>@</span>
                <input className="input" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} />
              </div>
            </div>
          )}

          <div className="btn-row" style={{ flexDirection: 'row' }}>
            <button className="btn btn-primary" onClick={handleSave}>
              Сохранить
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        chat.description && (
          <div className="card" style={{ maxWidth: 420, margin: '0 auto' }}>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{chat.description}</p>
          </div>
        )
      )}
    </main>
  );
}

export default function ChatInfoPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24, color: 'var(--text-muted)' }}>Загрузка…</p>}>
      <ChatInfoInner />
    </Suspense>
  );
}
