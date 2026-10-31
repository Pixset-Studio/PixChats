export interface CustomChatFolder {
  id: string;
  name: string;
  chatIds: string[];
}

const ARCHIVED_CHATS_KEY = 'pixchats:archived_chats_v1';
const CUSTOM_FOLDERS_KEY = 'pixchats:custom_folders_v1';

export function getArchivedChatIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(ARCHIVED_CHATS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isChatArchived(chatId: string): boolean {
  return getArchivedChatIds().includes(chatId);
}

export function toggleArchiveChat(chatId: string): boolean {
  if (typeof window === 'undefined') return false;
  const current = getArchivedChatIds();
  const exists = current.includes(chatId);
  const next = exists ? current.filter((id) => id !== chatId) : [chatId, ...current];
  localStorage.setItem(ARCHIVED_CHATS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('pixchats:folders_changed'));
  return !exists;
}

export function getCustomFolders(): CustomChatFolder[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_FOLDERS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCustomFolders(folders: CustomChatFolder[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CUSTOM_FOLDERS_KEY, JSON.stringify(folders));
  window.dispatchEvent(new CustomEvent('pixchats:folders_changed'));
}

export function createCustomFolder(name: string, initialChatIds: string[] = []): CustomChatFolder {
  const cleanName = name.trim() || 'Папка';
  const folder: CustomChatFolder = {
    id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    chatIds: Array.from(new Set(initialChatIds)),
  };
  const current = getCustomFolders();
  saveCustomFolders([...current, folder]);
  return folder;
}

export function deleteCustomFolder(folderId: string): void {
  const current = getCustomFolders().filter((f) => f.id !== folderId);
  saveCustomFolders(current);
}

export function toggleChatInCustomFolder(folderId: string, chatId: string): boolean {
  const current = getCustomFolders();
  let added = false;
  const next = current.map((f) => {
    if (f.id !== folderId) return f;
    const has = f.chatIds.includes(chatId);
    added = !has;
    return {
      ...f,
      chatIds: has ? f.chatIds.filter((id) => id !== chatId) : [...f.chatIds, chatId],
    };
  });
  saveCustomFolders(next);
  return added;
}
