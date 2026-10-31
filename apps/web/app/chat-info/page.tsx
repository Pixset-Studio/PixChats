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
  joinPublicChat,
  leaveChat,
  getMuteStates,
  muteChat,
  unmuteChat,
  deleteChat,
} from '@pixchats/core';
import type { Chat, Profile, MuteState } from '@pixchats/core';
import { VerifiedBadge } from '../../components/VerifiedBadge';
import { buildAppUrl } from '../../lib/url';
import { isBanned } from '../../lib/ban';
import { MuteControl } from '../../components/MuteControl';
import { Loading } from '../../components/Loading';
import { BackIcon } from '../../components/Icons';
import { DesktopShell } from '../../components/DesktopShell';
import { fileToBase64Image } from '../../lib/imageUtils';
import { SharedChatAttachments } from '../../components/SharedChatAttachments';
import {
  isChatArchived,
  toggleArchiveChat,
  getCustomFolders,
  toggleChatInCustomFolder,
  type CustomChatFolder,
} from '../../lib/chatFolders';

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

  const [isPinned, setIsPinned] = useState(false);
  const [isArchived, setIsArchived] = useState(false);
  const [customFolders, setCustomFolders] = useState<CustomChatFolder[]>([]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setCustomFolders(getCustomFolders());
    if (!chatId) return;
    try {
      const list: string[] = JSON.parse(localStorage.getItem('pixchats:pinned_chats') || '[]');
      setIsPinned(list.includes(chatId));
      setIsArchived(isChatArchived(chatId));
    } catch {}
  }, [chatId]);

  function handleTogglePin() {
    if (!chatId) return;
    try {
      const list: string[] = JSON.parse(localStorage.getItem('pixchats:pinned_chats') || '[]');
      const next = list.includes(chatId) ? list.filter((id) => id !== chatId) : [chatId, ...list];
      localStorage.setItem('pixchats:pinned_chats', JSON.stringify(next));
      setIsPinned(next.includes(chatId));
      window.dispatchEvent(new CustomEvent('pixchats:pinned_changed'));
      setNotice(next.includes(chatId) ? 'Чат закреплён 📌' : 'Чат откреплён');
      setTimeout(() => setNotice(null), 1500);
    } catch {}
  }

  function handleToggleArchive() {
    if (!chatId) return;
    const nowArchived = toggleArchiveChat(chatId);
    setIsArchived(nowArchived);
    setNotice(nowArchived ? 'Чат перемещён в Архив 📦' : 'Чат возвращён из Архива');
    setTimeout(() => setNotice(null), 1500);
  }

  function handleToggleFolder(folderId: string) {
    if (!chatId) return;
    toggleChatInCustomFolder(folderId, chatId);
    setCustomFolders(getCustomFolders());
  }

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
      const base64Url = await fileToBase64Image(e.target.files[0], 256, 0.85);
      await updateChatInfo(chat.id, { avatarUrl: base64Url });
      setChat({ ...chat, avatar_url: base64Url });
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

        <div className="btn-row" style={{ maxWidth: 380, margin: '12px auto 0', flexDirection: 'row', flexWrap: 'wrap' }}>
          <button className="btn" onClick={handleTogglePin}>
            {isPinned ? '📌 Открепить чат' : '📍 Закрепить чат'}
          </button>
          <button className="btn" onClick={handleToggleArchive}>
            {isArchived ? '📦 Из архива' : '📦 В архив'}
          </button>
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

        {customFolders.length > 0 && (
          <div style={{ maxWidth: 380, margin: '12px auto 0', display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
            {customFolders.map((f) => {
              const inFolder = f.chatIds.includes(chat.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className="btn"
                  style={{
                    width: 'auto',
                    padding: '5px 10px',
                    fontSize: 12,
                    borderColor: inFolder ? 'var(--accent)' : undefined,
                    color: inFolder ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => handleToggleFolder(f.id)}
                >
                  📁 {f.name} {inFolder ? '✓' : '+'}
                </button>
              );
            })}
          </div>
        )}
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
        <div className="card" style={{ maxWidth: 420, margin: '0 auto 16px' }}>
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

      <SharedChatAttachments chatId={chat.id} />
    </main>
  );
}

export default function ChatInfoPage() {
  return (
    <DesktopShell>
      <Suspense fallback={<Loading />}>
        <ChatInfoInner />
      </Suspense>
    </DesktopShell>
  );
}
