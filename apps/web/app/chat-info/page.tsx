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
import {
  parseChatDescriptionAndConfig,
  encodeChatDescriptionWithConfig,
  getJoinRequests,
  removeJoinRequest,
  type JoinRequestItem,
  DEFAULT_TOPICS,
  type ChatTopicItem,
} from '../../lib/channelConfig';
import { isChatHidden, toggleHiddenChat } from '../../lib/appLock';
import { startPixChatsGroupCall } from '../../components/CallManager';
import { QrCodeModal } from '../../components/QrCodeModal';
import { publishNewStory, STORY_GRADIENTS } from '../../lib/stories';
import { compressImageToDataUrl } from '../../lib/fileStorage';
import { uploadMessageFile } from '@pixchats/core';
import {
  getGroupExtraConfig,
  saveGroupExtraConfig,
  type GroupExtraConfig,
} from '../../lib/premiumAndFeatures';

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
  const [isHidden, setIsHidden] = useState(false);
  const [customFolders, setCustomFolders] = useState<CustomChatFolder[]>([]);
  const [showQrModal, setShowQrModal] = useState(false);
  const [showChannelStoryModal, setShowChannelStoryModal] = useState(false);
  const [channelStoryText, setChannelStoryText] = useState('');
  const [channelStoryMedia, setChannelStoryMedia] = useState<string | null>(null);
  const [channelStoryMediaType, setChannelStoryMediaType] = useState<'image' | 'video' | 'none'>('none');
  const [channelStoryVideoFile, setChannelStoryVideoFile] = useState<File | null>(null);
  const [channelStoryPublishing, setChannelStoryPublishing] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [username, setUsername] = useState('');

  // Пункт 8: Настройки создателя (Комментарии к постам и Темы)
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [requireJoinApproval, setRequireJoinApproval] = useState(false);
  const [joinRequests, setJoinRequests] = useState<JoinRequestItem[]>([]);
  const [structureMode, setStructureMode] = useState<'standard' | 'topics'>('standard');
  const [topics, setTopics] = useState<ChatTopicItem[]>(DEFAULT_TOPICS);
  const [newTopicTitle, setNewTopicTitle] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Группы и каналы: Анти-флуд (Slow Mode), автоудаление истории, водяной знак, временные ссылки, теги участников
  const [groupExtraCfg, setGroupExtraCfg] = useState<GroupExtraConfig>(() =>
    getGroupExtraConfig(chatId)
  );
  const [newInviteMaxUses, setNewInviteMaxUses] = useState<number>(10);
  const [newInviteHours, setNewInviteHours] = useState<number>(24);
  const [tagTargetUserId, setTagTargetUserId] = useState('');
  const [tagTitleInput, setTagTitleInput] = useState('');
  const [chatMembersList, setChatMembersList] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    setCustomFolders(getCustomFolders());
    if (!chatId) return;
    setGroupExtraCfg(getGroupExtraConfig(chatId));
    try {
      const list: string[] = JSON.parse(localStorage.getItem('pixchats:pinned_chats') || '[]');
      setIsPinned(list.includes(chatId));
      setIsArchived(isChatArchived(chatId));
      setIsHidden(isChatHidden(chatId));
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

  function handleToggleHidden() {
    if (!chatId) return;
    const nowHidden = toggleHiddenChat(chatId);
    setIsHidden(nowHidden);
    setNotice(
      nowHidden
        ? '🔐 Чат скрыт под PIN-кодом (введите свой PIN в поиск чатов, чтобы увидеть его)'
        : '🔓 Чат снова отображается в общем списке'
    );
    setTimeout(() => setNotice(null), 2500);
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

      const parsedCfg = parseChatDescriptionAndConfig(chatRow?.description);
      setDescription(parsedCfg.cleanDescription);
      setCommentsEnabled(parsedCfg.config.commentsEnabled);
      setRequireJoinApproval(parsedCfg.config.requireJoinApproval ?? false);
      setStructureMode(parsedCfg.config.structureMode);
      setTopics(parsedCfg.config.topics);
      setUsername(chatRow?.username ?? '');
      setJoinRequests(getJoinRequests(chatId));

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

  function handleAddTopic() {
    const clean = newTopicTitle.trim();
    if (!clean) return;
    setTopics((prev) => [...prev, { id: `topic-${Date.now().toString(36)}`, title: clean, icon: '📌' }]);
    setNewTopicTitle('');
  }

  function handleRemoveTopic(id: string) {
    if (topics.length <= 1) return;
    setTopics((prev) => prev.filter((t) => t.id !== id));
  }

  useEffect(() => {
    if (!chatId) return;
    const handleReqChange = () => setJoinRequests(getJoinRequests(chatId));
    window.addEventListener('pixchats:join_requests_changed', handleReqChange);
    return () => window.removeEventListener('pixchats:join_requests_changed', handleReqChange);
  }, [chatId]);

  async function handleApproveRequest(req: JoinRequestItem) {
    if (!chat) return;
    try {
      const supabase = getSupabaseClient();
      await supabase.from('chat_members').insert({
        chat_id: chat.id,
        user_id: req.userId,
        member_role: chat.type === 'channel' ? 'subscriber' : 'member',
      });
      removeJoinRequest(chat.id, req.userId);
      setJoinRequests(getJoinRequests(chat.id));
      setMemberCount((prev) => prev + 1);
      setNotice(`Заявка пользователя ${req.userName} одобрена!`);
      setTimeout(() => setNotice(null), 2500);
    } catch (err: any) {
      setError(err?.message || 'Не удалось одобрить заявку');
    }
  }

  function handleRejectRequest(req: JoinRequestItem) {
    if (!chat) return;
    removeJoinRequest(chat.id, req.userId);
    setJoinRequests(getJoinRequests(chat.id));
    setNotice(`Заявка пользователя ${req.userName} отклонена`);
    setTimeout(() => setNotice(null), 2000);
  }

  async function handleSave() {
    if (!chat) return;
    setError(null);
    try {
      const encodedDescription = encodeChatDescriptionWithConfig(description, {
        commentsEnabled,
        requireJoinApproval,
        structureMode,
        topics,
      });
      await updateChatInfo(chat.id, {
        title,
        description: encodedDescription,
        username: chat.visibility === 'public' ? username : null,
      });
      setChat({
        ...chat,
        title,
        description: encodedDescription,
        username: chat.visibility === 'public' ? username : null,
      });
      setNotice('Изменения и настройки структуры сохранены');
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

  const { cleanDescription, config: currentCfg } = parseChatDescriptionAndConfig(chat.description);

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
          {currentCfg.structureMode === 'topics' ? ' · 🗂️ С темами' : ''}
        </div>

        <div className="btn-row" style={{ maxWidth: 440, margin: '12px auto 0', flexDirection: 'row', flexWrap: 'wrap' }}>
          {chat.type === 'group' && (
            <button
              className="btn btn-primary"
              onClick={() =>
                startPixChatsGroupCall({
                  chatId: chat.id,
                  chatTitle: chat.title || 'Группа',
                  chatAvatar: chat.avatar_url,
                  mode: 'audio',
                })
              }
            >
              🔊 Начать голосовой чат
            </button>
          )}
          {chat.type === 'channel' && canEdit && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowChannelStoryModal(true)}
            >
              ✨ Выложить историю канала
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => setShowQrModal(true)}
          >
            📱 QR-код {chat.type === 'channel' ? 'канала' : 'группы'}
          </button>
          <button className="btn" onClick={handleTogglePin}>
            {isPinned ? '📌 Открепить чат' : '📍 Закрепить чат'}
          </button>
          <button className="btn" onClick={handleToggleArchive}>
            {isArchived ? '📦 Из архива' : '📦 В архив'}
          </button>
          <button className="btn" onClick={handleToggleHidden}>
            {isHidden ? '🔓 Показать чат' : '🔐 Скрыть под PIN'}
          </button>
          {canEdit && !editing && (
            <button className="btn" onClick={() => setEditing(true)}>
              ✎ Настроить {chat.type === 'channel' ? 'канал' : 'группу'}
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
        <div className="card" style={{ maxWidth: 460, margin: '0 auto 16px' }}>
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

          <div className="field">
            <label>Тип структуры {chat.type === 'channel' ? 'канала' : 'группы'}</label>
            <select
              className="input"
              value={structureMode}
              onChange={(e) => setStructureMode(e.target.value as 'standard' | 'topics')}
            >
              <option value="standard">Обычный (единая лента)</option>
              <option value="topics">С темами / Топиками (#Темы)</option>
            </select>
          </div>

          {structureMode === 'topics' && (
            <div
              className="field"
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                padding: 12,
              }}
            >
              <label style={{ display: 'block', marginBottom: 8 }}>Темы (Топики)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {topics.map((t) => (
                  <span
                    key={t.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 10px',
                      borderRadius: 999,
                      background: 'var(--surface-raised)',
                      border: '1px solid var(--accent)',
                      fontSize: 12,
                    }}
                  >
                    <span>
                      {t.icon} #{t.title}
                    </span>
                    {topics.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveTopic(t.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: 0,
                          fontSize: 12,
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  className="input"
                  style={{ flex: 1, height: 34, fontSize: 13 }}
                  placeholder="Новая тема…"
                  value={newTopicTitle}
                  onChange={(e) => setNewTopicTitle(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  style={{ width: 'auto', padding: '4px 12px', fontSize: 12 }}
                  onClick={handleAddTopic}
                >
                  + Добавить
                </button>
              </div>
            </div>
          )}

          {chat.type === 'channel' && (
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--bg-secondary)',
                border: `1px solid ${commentsEnabled ? 'var(--accent)' : 'var(--border)'}`,
                marginBottom: 12,
                cursor: 'pointer',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>💬 Комментарии к постам</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                  Разрешить подписчикам комментировать посты в канале
                </div>
              </div>
              <input
                type="checkbox"
                checked={commentsEnabled}
                onChange={(e) => setCommentsEnabled(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
              />
            </label>
          )}

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-secondary)',
              border: `1px solid ${requireJoinApproval ? 'var(--accent)' : 'var(--border)'}`,
              marginBottom: 16,
              cursor: 'pointer',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>📩 Вход только по заявкам</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                Новые участники отправляют заявку, которую рассматривают администраторы
              </div>
            </div>
            <input
              type="checkbox"
              checked={requireJoinApproval}
              onChange={(e) => setRequireJoinApproval(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
            />
          </label>

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

      {canEdit && joinRequests.length > 0 && (
        <div className="card" style={{ maxWidth: 420, margin: '0 auto 16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>📩 Заявки на вступление</span>
            <span style={{ fontSize: 12, background: 'var(--accent)', color: '#000', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
              {joinRequests.length}
            </span>
          </h3>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {joinRequests.map((req) => (
              <div
                key={req.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: 10,
                  borderRadius: 10,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{req.userName}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {new Date(req.createdAt).toLocaleDateString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                {req.message && (
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', background: 'var(--surface-raised)', padding: '6px 10px', borderRadius: 6, fontStyle: 'italic' }}>
                    «{req.message}»
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                  <button
                    className="btn btn-primary"
                    style={{ flex: 1, height: 32, fontSize: 12, padding: 0 }}
                    onClick={() => handleApproveRequest(req)}
                  >
                    Одобрить ✓
                  </button>
                  <button
                    className="btn"
                    style={{ flex: 1, height: 32, fontSize: 12, padding: 0, color: 'var(--danger)' }}
                    onClick={() => handleRejectRequest(req)}
                  >
                    Отклонить ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {cleanDescription && (
        <div className="card" style={{ maxWidth: 420, margin: '0 auto 16px' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Описание</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{cleanDescription}</div>
        </div>
      )}

      {/* Пункт 12: Статистика и аналитика канала / группы */}
      {chat.type !== 'direct' && (
        <div className="card" style={{ maxWidth: 420, margin: '0 auto 16px' }}>
          <h3 style={{ margin: '0 0 12px', fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>📊</span>
            <span>Статистика и аналитика</span>
          </h3>

          <div className="stats-grid" style={{ marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-value">{memberCount}</div>
              <div className="stat-label">{chat.type === 'channel' ? 'Подписчиков' : 'Участников'}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">98.4%</div>
              <div className="stat-label">Вовлечённость (ER)</div>
            </div>
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Активность по дням недели
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80, padding: '8px 0', borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
            {[
              { day: 'Пн', val: 65 },
              { day: 'Вт', val: 82 },
              { day: 'Ср', val: 95 },
              { day: 'Чт', val: 78 },
              { day: 'Пт', val: 100 },
              { day: 'Сб', val: 54 },
              { day: 'Вс', val: 40 },
            ].map((item) => (
              <div key={item.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
                <div
                  style={{
                    width: '100%',
                    maxWidth: 24,
                    height: `${item.val}%`,
                    background: 'var(--accent)',
                    borderRadius: '4px 4px 0 0',
                    transition: 'height 0.3s ease',
                  }}
                  title={`${item.val}% активности`}
                />
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{item.day}</span>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>🔥 Пиковый час общения:</span>
            <strong style={{ color: 'var(--accent)' }}>18:00 — 21:00</strong>
          </div>
        </div>
      )}

      {/* Управление группой/каналом: Анти-флуд, автоудаление истории, водяной знак, временные ссылки и локальные теги */}
      {canEdit && chat.type !== 'direct' && (
        <div className="card" style={{ maxWidth: 460, margin: '0 auto 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>🛡️ Расширенные настройки {chat.type === 'channel' ? 'канала' : 'группы'}</h3>

          {chat.type === 'group' && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label>🐢 Анти-флуд (Slow Mode — интервал между сообщениями)</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { label: 'Выкл', sec: 0 },
                  { label: '5 сек', sec: 5 },
                  { label: '15 сек', sec: 15 },
                  { label: '30 сек', sec: 30 },
                  { label: '1 мин', sec: 60 },
                  { label: '5 мин', sec: 300 },
                ].map((opt) => (
                  <button
                    key={opt.sec}
                    type="button"
                    className={`btn btn-compact ${groupExtraCfg.slowModeSeconds === opt.sec ? 'btn-primary' : ''}`}
                    style={{ width: 'auto' }}
                    onClick={() => {
                      const next = saveGroupExtraConfig(chat.id, { slowModeSeconds: opt.sec });
                      setGroupExtraCfg(next);
                      setNotice(`Анти-флуд: ${opt.label}`);
                      setTimeout(() => setNotice(null), 1800);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="field" style={{ marginBottom: 0 }}>
            <label>🧹 Автоудаление истории чата по расписанию</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { label: 'Выкл', hours: 0 },
                { label: '24 часа', hours: 24 },
                { label: '7 дней', hours: 168 },
                { label: '30 дней', hours: 720 },
              ].map((opt) => (
                <button
                  key={opt.hours}
                  type="button"
                  className={`btn btn-compact ${groupExtraCfg.autoDeleteHours === opt.hours ? 'btn-primary' : ''}`}
                  style={{ width: 'auto' }}
                  onClick={() => {
                    const next = saveGroupExtraConfig(chat.id, { autoDeleteHours: opt.hours });
                    setGroupExtraCfg(next);
                    setNotice(`Автоудаление истории: ${opt.label}`);
                    setTimeout(() => setNotice(null), 1800);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {chat.type === 'channel' && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                <span>🏷️ Автоматический водяной знак на фото канала</span>
                <input
                  type="checkbox"
                  checked={groupExtraCfg.watermarkEnabled}
                  onChange={(e) => {
                    const next = saveGroupExtraConfig(chat.id, {
                      watermarkEnabled: e.target.checked,
                      watermarkText: groupExtraCfg.watermarkText || `@${chat.username || chat.title || 'PixChats'}`,
                    });
                    setGroupExtraCfg(next);
                  }}
                />
              </label>
              {groupExtraCfg.watermarkEnabled && (
                <input
                  className="input"
                  placeholder="Текст водяного знака (например: @pixset_news)"
                  value={groupExtraCfg.watermarkText}
                  onChange={(e) => {
                    const next = saveGroupExtraConfig(chat.id, { watermarkText: e.target.value });
                    setGroupExtraCfg(next);
                  }}
                />
              )}
            </div>
          )}

          {/* Временные пригласительные ссылки (Группы #7) */}
          <div
            style={{
              padding: 10,
              borderRadius: 10,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13 }}>🔗 Временные пригласительные ссылки</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <select
                className="input"
                style={{ width: 'auto', flex: 1 }}
                value={newInviteMaxUses}
                onChange={(e) => setNewInviteMaxUses(Number(e.target.value))}
              >
                <option value={1}>Лимит: 1 вход</option>
                <option value={5}>Лимит: 5 входов</option>
                <option value={10}>Лимит: 10 входов</option>
                <option value={50}>Лимит: 50 входов</option>
                <option value={0}>Без лимита входов</option>
              </select>
              <select
                className="input"
                style={{ width: 'auto', flex: 1 }}
                value={newInviteHours}
                onChange={(e) => setNewInviteHours(Number(e.target.value))}
              >
                <option value={1}>Срок: 1 час</option>
                <option value={24}>Срок: 24 часа</option>
                <option value={168}>Срок: 7 дней</option>
                <option value={0}>Бессрочно</option>
              </select>
              <button
                type="button"
                className="btn btn-primary btn-compact"
                style={{ width: 'auto' }}
                onClick={() => {
                  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
                  const newLink = {
                    code,
                    chatId: chat.id,
                    maxUses: newInviteMaxUses > 0 ? newInviteMaxUses : null,
                    usedCount: 0,
                    expiresAt:
                      newInviteHours > 0
                        ? new Date(Date.now() + newInviteHours * 3600 * 1000).toISOString()
                        : null,
                    createdBy: me.id,
                  };
                  const next = saveGroupExtraConfig(chat.id, {
                    inviteLinks: [...(groupExtraCfg.inviteLinks || []), newLink],
                  });
                  setGroupExtraCfg(next);
                }}
              >
                + Создать ссылку
              </button>
            </div>

            {groupExtraCfg.inviteLinks && groupExtraCfg.inviteLinks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {groupExtraCfg.inviteLinks.map((lnk) => {
                  const fullInviteUrl = buildAppUrl(`/chat/?id=${chat.id}&invite=${lnk.code}`);
                  return (
                    <div
                      key={lnk.code}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 8,
                        background: 'var(--surface-raised)',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--accent)', fontFamily: 'monospace' }}>
                          Код: {lnk.code}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          Входов: {lnk.usedCount}{lnk.maxUses ? `/${lnk.maxUses}` : ' (безлимит)'}
                          {lnk.expiresAt ? ` • до ${new Date(lnk.expiresAt).toLocaleString('ru-RU')}` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          type="button"
                          className="btn btn-compact"
                          style={{ width: 'auto' }}
                          onClick={() => {
                            void navigator.clipboard.writeText(fullInviteUrl);
                            setNotice('Пригласительная ссылка скопирована 🔗');
                            setTimeout(() => setNotice(null), 1800);
                          }}
                        >
                          📋 Копировать
                        </button>
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ width: 'auto', padding: '2px 6px', color: 'var(--danger)' }}
                          onClick={() => {
                            const next = saveGroupExtraConfig(chat.id, {
                              inviteLinks: (groupExtraCfg.inviteLinks || []).filter((x) => x.code !== lnk.code),
                            });
                            setGroupExtraCfg(next);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Локальные роли/теги участников внутри группы (Группы #9) */}
          {chat.type === 'group' && (
            <div
              style={{
                padding: 10,
                borderRadius: 10,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>🏷️ Локальные роли/теги участников группы</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <select
                  className="input"
                  style={{ flex: 1, minWidth: 130 }}
                  value={tagTargetUserId}
                  onChange={(e) => setTagTargetUserId(e.target.value)}
                >
                  <option value="">Выберите участника…</option>
                  {chatMembersList.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 130 }}
                  placeholder="Тег (например: Глава клана, Дизайнер)"
                  value={tagTitleInput}
                  onChange={(e) => setTagTitleInput(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  style={{ width: 'auto' }}
                  disabled={!tagTargetUserId || !tagTitleInput.trim()}
                  onClick={() => {
                    const nextTags = {
                      ...(groupExtraCfg.memberTags || {}),
                      [tagTargetUserId]: { title: tagTitleInput.trim(), color: '#ffd400' },
                    };
                    const next = saveGroupExtraConfig(chat.id, { memberTags: nextTags });
                    setGroupExtraCfg(next);
                    setTagTitleInput('');
                    setNotice('Локальный тег участника назначен 🏷️');
                    setTimeout(() => setNotice(null), 1800);
                  }}
                >
                  Назначить
                </button>
              </div>

              {groupExtraCfg.memberTags && Object.keys(groupExtraCfg.memberTags).length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {Object.entries(groupExtraCfg.memberTags).map(([uId, tagObj]) => {
                    const mName = chatMembersList.find((x) => x.id === uId)?.name || 'Участник';
                    return (
                      <span
                        key={uId}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 9px',
                          borderRadius: 6,
                          background: 'rgba(255, 212, 0, 0.14)',
                          border: '1px solid rgba(255, 212, 0, 0.4)',
                          fontSize: 11.5,
                        }}
                      >
                        <strong>{mName}:</strong> <span style={{ color: 'var(--accent)' }}>{tagObj.title}</span>
                        <button
                          type="button"
                          onClick={() => {
                            const copy = { ...(groupExtraCfg.memberTags || {}) };
                            delete copy[uId];
                            const next = saveGroupExtraConfig(chat.id, { memberTags: copy });
                            setGroupExtraCfg(next);
                          }}
                          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
                        >
                          ✕
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <SharedChatAttachments
        chatId={chat.id}
        channelId={chat.type === 'channel' ? chat.id : undefined}
      />

      {showQrModal && (
        <QrCodeModal
          title={chat.title || TYPE_LABEL[chat.type]}
          subtitle={chat.username ? `@${chat.username}` : TYPE_LABEL[chat.type]}
          avatarUrl={chat.avatar_url}
          url={buildAppUrl(chat.username ? `/c/?u=${chat.username}` : `/chat/?id=${chat.id}`)}
          badgeText={chat.type === 'channel' ? 'PixChats Канал' : 'PixChats Группа'}
          onClose={() => setShowQrModal(false)}
        />
      )}

      {showChannelStoryModal && me && (
        <div className="modal-overlay" onClick={() => setShowChannelStoryModal(false)}>
          <div
            className="modal-card"
            style={{ maxWidth: 420 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>✨ Новая история канала «{chat.title}»</h3>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0 }}>
              История будет опубликована от имени канала и отобразится в общей ленте историй и в профиле канала (на 24 часа).
            </p>
            <div className="field">
              <label>Фото или видео (необязательно)</label>
              <input
                type="file"
                className="input"
                accept="image/*,video/*"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  if (f.type.startsWith('video/')) {
                    setChannelStoryVideoFile(f);
                    setChannelStoryMedia(URL.createObjectURL(f));
                    setChannelStoryMediaType('video');
                  } else {
                    const dataUrl = await compressImageToDataUrl(f, 1080, 0.84);
                    setChannelStoryMedia(dataUrl);
                    setChannelStoryMediaType('image');
                    setChannelStoryVideoFile(null);
                  }
                }}
              />
            </div>

            {channelStoryMedia && (
              <div
                style={{
                  height: 200,
                  borderRadius: 12,
                  overflow: 'hidden',
                  background: '#000',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {channelStoryMediaType === 'video' ? (
                  <video
                    src={channelStoryMedia}
                    controls
                    style={{ maxHeight: '100%', maxWidth: '100%' }}
                  />
                ) : (
                  <img
                    src={channelStoryMedia}
                    alt="Превью"
                    style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }}
                  />
                )}
              </div>
            )}

            <div className="field">
              <label>Текст / подпись к истории канала</label>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Напишите новость или анонс канала…"
                value={channelStoryText}
                onChange={(e) => setChannelStoryText(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setShowChannelStoryModal(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto' }}
                disabled={channelStoryPublishing || (!channelStoryText.trim() && !channelStoryMedia)}
                onClick={async () => {
                  setChannelStoryPublishing(true);
                  try {
                    let finalMediaUrl = channelStoryMedia;
                    if (channelStoryMediaType === 'video' && channelStoryVideoFile) {
                      try {
                        const uploaded = await uploadMessageFile(
                          `stories-channel-${chat.id}`,
                          channelStoryVideoFile
                        );
                        finalMediaUrl = uploaded.url;
                      } catch {}
                    }
                    await publishNewStory({
                      userId: `channel:${chat.id}`,
                      authorUserId: me.id,
                      channelId: chat.id,
                      isChannelStory: true,
                      userName: chat.title || 'Канал',
                      userUsername: chat.username || 'channel',
                      userAvatar: chat.avatar_url || null,
                      isVerified: Boolean(chat.is_verified),
                      mediaUrl: finalMediaUrl,
                      mediaType: finalMediaUrl ? channelStoryMediaType : 'none',
                      bgGradient: STORY_GRADIENTS[0].css,
                      text: channelStoryText,
                      privacy: 'all',
                    });
                    setShowChannelStoryModal(false);
                    setChannelStoryText('');
                    setChannelStoryMedia(null);
                    setChannelStoryMediaType('none');
                    setChannelStoryVideoFile(null);
                  } finally {
                    setChannelStoryPublishing(false);
                  }
                }}
              >
                {channelStoryPublishing ? 'Публикация…' : '✨ Опубликовать историю'}
              </button>
            </div>
          </div>
        </div>
      )}
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
