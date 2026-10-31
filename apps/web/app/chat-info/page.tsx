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
  getMuteStates,
  muteChat,
  unmuteChat,
  deleteChat,
} from '@pixchats/core';
import type { Chat, Profile, MuteState, Message } from '@pixchats/core';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { buildAppUrl } from '../../lib/url';
import { isBanned } from '../../lib/ban';
import { MuteControl } from '../../components/MuteControl';
import { Loading } from '../../components/Loading';
import { BackIcon } from '../../components/Icons';

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
  const [chatNotFound, setChatNotFound] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [canEdit, setCanEdit] = useState(false);
  const [myRole, setMyRole] = useState<string | null>(null);
  const [muteState, setMuteState] = useState<MuteState | null>(null);
  const [editing, setEditing] = useState(false);

  const [mediaItems, setMediaItems] = useState<Message[]>([]);
  const [mediaTab, setMediaTab] = useState<'media' | 'files' | 'voice'>('media');

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
      if (isBanned(profile)) {
        router.push('/banned');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();
      if (!chatRow) {
        setChatNotFound(true);
        return;
      }
      setChat(chatRow);
      setTitle(chatRow?.title ?? '');
      setDescription(chatRow?.description ?? '');
      setUsername(chatRow?.username ?? '');

      setMemberCount(await getChatMemberCount(chatId));
      const role = await getMyChatRole(chatId, profile.id);
      setMyRole(role);
      setCanEdit(role === 'owner' || role === 'admin');

      const mutes = await getMuteStates([chatId], profile.id);
      setMuteState(mutes[chatId] ?? { muted: false, mutedForever: false, mutedUntil: null });

      // Загружаем вложения чата (медиа, файлы, голосовые)
      try {
        const { data: mediaRows } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .not('media_path', 'is', null)
          .eq('is_deleted', false)
          .order('sent_at', { ascending: false })
          .limit(100);
        setMediaItems(mediaRows ?? []);
      } catch {}
    })();
  }, [chatId, router]);

  async function handleMute(hours?: number) {
    if (!me) return;
    await muteChat(me.id, chatId, hours);
    const mutes = await getMuteStates([chatId], me.id);
    setMuteState(mutes[chatId] ?? null);
  }

  async function handleUnmute() {
    if (!me) return;
    await unmuteChat(me.id, chatId);
    setMuteState({ muted: false, mutedForever: false, mutedUntil: null });
  }

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

  async function handleDeleteChat() {
    if (!chat) return;
    const label = chat.type === 'channel' ? 'канал' : 'группу';
    if (!confirm(`Удалить ${label} "${chat.title}" безвозвратно вместе со всеми сообщениями? Это действие нельзя отменить.`)) return;
    await deleteChat(chat.id);
    router.push('/chats');
  }

  if (chatNotFound) {
    return (
      <main className="page-center">
        <div className="container-narrow card" style={{ textAlign: 'center' }}>
          <h2 style={{ fontFamily: 'var(--font-display)' }}>Этот чат не существует</h2>
          <p style={{ color: 'var(--text-muted)' }}>Возможно, он был удалён владельцем.</p>
          <Link href="/chats" className="btn btn-primary" style={{ marginTop: 12 }}>
            К списку чатов
          </Link>
        </div>
      </main>
    );
  }

  if (!chat || !me) return <Loading />;

  const photosAndVideos = mediaItems.filter((m) => m.message_type === 'image' || m.message_type === 'video');
  const filesList = mediaItems.filter((m) => m.message_type === 'file');
  const voiceNotes = mediaItems.filter((m) => m.message_type === 'voice' || m.message_type === 'audio');

  return (
    <main className="container-wide">
      <Link
        href={`/chat/?id=${chat.id}`}
        style={{ color: 'var(--text-muted)', fontSize: 13, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <BackIcon size={16} />
        <span>Назад в чат</span>
      </Link>

      <div className="profile-hero">
        <div
          className={`avatar ${!chat.avatar_url ? 'avatar-fallback' : ''}`}
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
          <MuteControl muteState={muteState} onMute={handleMute} onUnmute={handleUnmute} />
          {myRole === 'owner' && (
            <button className="btn" style={{ color: 'var(--danger)' }} onClick={handleDeleteChat}>
              🗑 Удалить {chat.type === 'channel' ? 'канал' : 'группу'}
            </button>
          )}
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
      ) : null}

      {chat.description && (
        <div className="card" style={{ maxWidth: 420, margin: '0 auto 16px' }}>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--text-muted)' }}>{chat.description}</p>
        </div>
      )}

      <div className="card media-gallery-section" style={{ maxWidth: 420, margin: '0 auto 24px' }}>
        <div className="section-title" style={{ marginTop: 0, marginBottom: 12 }}>Вложения чата</div>
        <div className="media-tabs">
          <button
            type="button"
            className={`media-tab ${mediaTab === 'media' ? 'active' : ''}`}
            onClick={() => setMediaTab('media')}
          >
            Медиа ({photosAndVideos.length})
          </button>
          <button
            type="button"
            className={`media-tab ${mediaTab === 'files' ? 'active' : ''}`}
            onClick={() => setMediaTab('files')}
          >
            Файлы ({filesList.length})
          </button>
          <button
            type="button"
            className={`media-tab ${mediaTab === 'voice' ? 'active' : ''}`}
            onClick={() => setMediaTab('voice')}
          >
            Голосовые ({voiceNotes.length})
          </button>
        </div>

        {mediaTab === 'media' && (
          photosAndVideos.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', margin: '16px 0' }}>Нет фото и видео</p>
          ) : (
            <div className="media-grid">
              {photosAndVideos.map((m) => (
                <div key={m.id} className="media-grid-item">
                  {m.message_type === 'image' ? (
                    <a href={m.media_path!} target="_blank" rel="noopener noreferrer">
                      <img src={m.media_path!} alt={m.text || 'Фото'} loading="lazy" />
                    </a>
                  ) : (
                    <video src={m.media_path!} controls preload="metadata" />
                  )}
                </div>
              ))}
            </div>
          )
        )}

        {mediaTab === 'files' && (
          filesList.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', margin: '16px 0' }}>Нет файлов</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {filesList.map((m) => (
                <a
                  key={m.id}
                  href={m.media_path!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="file-list-item"
                  download
                >
                  <span style={{ fontSize: 18 }}>📎</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.text || 'Документ'}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {new Date(m.sent_at).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--accent)' }}>Скачать</span>
                </a>
              ))}
            </div>
          )
        )}

        {mediaTab === 'voice' && (
          voiceNotes.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', margin: '16px 0' }}>Нет голосовых сообщений</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
              {voiceNotes.map((m) => (
                <div key={m.id} className="voice-list-item">
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    🎤 Голосовое от {new Date(m.sent_at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <audio src={m.media_path!} controls style={{ width: '100%', height: 36 }} />
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </main>
  );
}

export default function ChatInfoPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ChatInfoInner />
    </Suspense>
  );
}
