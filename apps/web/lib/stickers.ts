import { fileToBase64Image } from './imageUtils';

export interface StickerItem {
  id: string;
  title: string;
  pack: string;
  dataUrl: string; // Base64 Data URL (data:image/...;base64,...)
  createdAt?: string;
}

const CUSTOM_STICKERS_STORAGE_KEY = 'pixchats:custom_stickers_v1';

/**
 * Список стикеров по умолчанию пуст — все стикеры добавляются вручную через Админ-панель (/admin) в формате Base64.
 */
export const BUILTIN_STICKERS: StickerItem[] = [];

/** Получить пользовательские стикеры (добавленные через админку в Base64). */
export function getCustomStickers(): StickerItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CUSTOM_STICKERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Сохранить список кастомных Base64-стикеров и уведомить открытые компоненты. */
function saveCustomStickers(list: StickerItem[]): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(CUSTOM_STICKERS_STORAGE_KEY, JSON.stringify(list));
  window.dispatchEvent(new CustomEvent('pixchats:stickers_updated'));
}

/** Получить все стикеры (только добавленные пользователем/администратором в Base64). */
export function getAllStickers(): StickerItem[] {
  return getCustomStickers();
}

/** Добавить стикер из файла изображения (конвертируется в Base64 Data URL с сохранением прозрачности). */
export async function addCustomStickerFromFile(
  file: File,
  title: string,
  pack = 'Pixset Custom'
): Promise<StickerItem> {
  const dataUrl = await fileToBase64Image(file, 220, 0.86, {
    cropSquare: false,
    preserveAlpha: true,
  });
  return addCustomStickerFromBase64(dataUrl, title, pack);
}

/** Добавить стикер напрямую из Base64 Data URL строки. */
export function addCustomStickerFromBase64(
  dataUrl: string,
  title: string,
  pack = 'Pixset Custom'
): StickerItem {
  const cleanUrl = dataUrl.trim();
  if (!cleanUrl.startsWith('data:image/')) {
    throw new Error('Строка должна начинаться с data:image/...;base64,...');
  }
  const item: StickerItem = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim() || 'Стикер',
    pack: pack.trim() || 'Pixset Custom',
    dataUrl: cleanUrl,
    createdAt: new Date().toISOString(),
  };
  const current = getCustomStickers();
  saveCustomStickers([item, ...current]);
  return item;
}

/** Удалить кастомный стикер по ID. */
export function removeCustomSticker(id: string): void {
  const current = getCustomStickers().filter((s) => s.id !== id);
  saveCustomStickers(current);
}

/**
 * Дедупликация стикеров по ID (Пункт 10):
 * Вместо повторной записи длинного Base64 в каждое сообщение БД, в текст сообщения
 * записывается компактный тег `[STICKER:<id>]` (около 30 байт вместо 30 КБ!).
 */
const STICKER_TAG_REGEX = /^\[STICKER:([a-zA-Z0-9_-]+)\]/;

export function encodeStickerTag(stickerId: string, title = 'Стикер'): string {
  return `[STICKER:${stickerId}]${title}`;
}

export function resolveStickerFromText(rawText?: string | null): StickerItem | null {
  if (!rawText) return null;
  const match = rawText.match(STICKER_TAG_REGEX);
  if (!match) return null;
  const stickerId = match[1];
  const all = getAllStickers();
  return all.find((s) => s.id === stickerId) ?? null;
}

export function isStickerTagText(rawText?: string | null): boolean {
  return Boolean(rawText && STICKER_TAG_REGEX.test(rawText));
}
