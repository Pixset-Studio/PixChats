import { fileToBase64Image } from './imageUtils';

export interface StickerItem {
  id: string;
  title: string;
  pack: string;
  dataUrl: string; // Base64 Data URL (data:image/...;base64,...)
  createdAt?: string;
}

const CUSTOM_STICKERS_STORAGE_KEY = 'pixchats:custom_stickers_v1';

function svgToBase64DataUrl(svg: string): string {
  const utf8 = encodeURIComponent(svg.trim()).replace(/%([0-9A-F]{2})/g, (_, p1) =>
    String.fromCharCode(parseInt(p1, 16))
  );
  const b64 = typeof btoa !== 'undefined' ? btoa(utf8) : Buffer.from(svg.trim(), 'utf-8').toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

/**
 * Базовый набор графических стикеров Pixset Studio в формате Base64 (без эмодзи и без Supabase Storage).
 */
export const BUILTIN_STICKERS: StickerItem[] = [
  {
    id: 'builtin-pix-blaster',
    title: 'Byte Blaster',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <defs>
          <radialGradient id="g1" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#00ffff" stop-opacity="0.35"/>
            <stop offset="100%" stop-color="#04040f" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <circle cx="80" cy="80" r="74" fill="#080820" stroke="#00ffff" stroke-width="4"/>
        <circle cx="80" cy="80" r="68" fill="url(#g1)"/>
        <!-- Pixel Spaceship -->
        <polygon points="80,26 112,98 92,90 80,114 68,90 48,98" fill="#00ffff" stroke="#ff00ff" stroke-width="4" stroke-linejoin="round"/>
        <circle cx="80" cy="68" r="10" fill="#ff00ff"/>
        <!-- Thruster flames -->
        <polygon points="72,110 80,134 88,110" fill="#ffd400"/>
        <text x="80" y="148" text-anchor="middle" fill="#00ffff" font-family="monospace" font-weight="900" font-size="13">BYTE BLASTER</text>
      </svg>
    `),
  },
  {
    id: 'builtin-pix-cat',
    title: 'Кибер Кот',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <rect x="14" y="14" width="132" height="132" rx="28" fill="#121110" stroke="#ffd400" stroke-width="4"/>
        <!-- Cat Ears & Head -->
        <polygon points="40,68 48,30 72,54" fill="#ffd400"/>
        <polygon points="120,68 112,30 88,54" fill="#ffd400"/>
        <ellipse cx="80" cy="86" rx="44" ry="36" fill="#1c1917" stroke="#ffd400" stroke-width="4"/>
        <!-- Cyber Visor -->
        <rect x="48" y="70" width="64" height="16" rx="8" fill="#ffd400"/>
        <rect x="56" y="74" width="16" height="8" rx="4" fill="#09090b"/>
        <rect x="88" y="74" width="16" height="8" rx="4" fill="#09090b"/>
        <!-- Smile -->
        <path d="M68,100 Q80,110 92,100" fill="none" stroke="#ffd400" stroke-width="4" stroke-linecap="round"/>
        <text x="80" y="138" text-anchor="middle" fill="#ffd400" font-family="sans-serif" font-weight="800" font-size="13">PIXCAT</text>
      </svg>
    `),
  },
  {
    id: 'builtin-pix-ggwp',
    title: 'GG WP',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <polygon points="80,10 146,46 146,114 80,150 14,114 14,46" fill="#101012" stroke="#facc15" stroke-width="5"/>
        <!-- Trophy Icon -->
        <path d="M56,42 H104 V68 C104,84 92,94 80,94 C68,94 56,84 56,68 Z" fill="#facc15"/>
        <rect x="74" y="94" width="12" height="16" fill="#eab308"/>
        <rect x="58" y="108" width="44" height="8" rx="4" fill="#facc15"/>
        <text x="80" y="136" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-weight="900" font-size="22" letter-spacing="2">GG WP</text>
      </svg>
    `),
  },
  {
    id: 'builtin-pix-fire',
    title: 'Огонь!',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="70" fill="#18120b" stroke="#f59e0b" stroke-width="4"/>
        <path d="M80,22 C105,52 124,74 116,104 C110,126 92,136 80,136 C68,136 50,126 44,104 C36,74 55,52 80,22 Z" fill="#f59e0b"/>
        <path d="M80,54 C94,74 104,88 98,108 C94,120 86,126 80,126 C74,126 66,120 62,108 C56,88 66,74 80,54 Z" fill="#facc15"/>
        <circle cx="80" cy="108" r="12" fill="#fffbeb"/>
      </svg>
    `),
  },
  {
    id: 'builtin-pix-rocket',
    title: 'В космос',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <rect x="12" y="12" width="136" height="136" rx="34" fill="#0b0d14" stroke="#facc15" stroke-width="4"/>
        <path d="M80,24 C98,44 102,74 100,98 L60,98 C58,74 62,44 80,24 Z" fill="#facc15"/>
        <polygon points="60,82 42,106 60,102" fill="#eab308"/>
        <polygon points="100,82 118,106 100,102" fill="#eab308"/>
        <circle cx="80" cy="64" r="11" fill="#0b0d14" stroke="#ffffff" stroke-width="3"/>
        <polygon points="68,102 80,132 92,102" fill="#ef4444"/>
        <text x="80" y="144" text-anchor="middle" fill="#facc15" font-family="sans-serif" font-weight="800" font-size="12">LAUNCH</text>
      </svg>
    `),
  },
  {
    id: 'builtin-pix-heart',
    title: 'Золотое сердце',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="70" fill="#141109" stroke="#facc15" stroke-width="4"/>
        <path d="M80,126 L38,84 C22,68 24,42 44,34 C58,28 72,36 80,48 C88,36 102,28 116,34 C136,42 138,68 122,84 Z" fill="#facc15" stroke="#fde047" stroke-width="3"/>
        <text x="80" y="144" text-anchor="middle" fill="#fde047" font-family="sans-serif" font-weight="800" font-size="12">PIXSET LOVE</text>
      </svg>
    `),
  },
  {
    id: 'builtin-pix-code',
    title: 'Dev Mode',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <rect x="14" y="22" width="132" height="116" rx="16" fill="#0a0a12" stroke="#ffd400" stroke-width="4"/>
        <circle cx="32" cy="38" r="5" fill="#ef4444"/>
        <circle cx="48" cy="38" r="5" fill="#facc15"/>
        <circle cx="64" cy="38" r="5" fill="#22c55e"/>
        <path d="M58,72 L40,88 L58,104" fill="none" stroke="#ffd400" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M102,72 L120,88 L102,104" fill="none" stroke="#ffd400" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="86" y1="66" x2="74" y2="110" stroke="#00ffff" stroke-width="5" stroke-linecap="round"/>
      </svg>
    `),
  },
  {
    id: 'builtin-pix-approve',
    title: 'Одобрено!',
    pack: 'Pixset Official',
    dataUrl: svgToBase64DataUrl(`
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="68" fill="#0d1510" stroke="#22c55e" stroke-width="5"/>
        <path d="M50,82 L72,104 L112,58" fill="none" stroke="#facc15" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
        <text x="80" y="134" text-anchor="middle" fill="#22c55e" font-family="sans-serif" font-weight="900" font-size="13">APPROVED</text>
      </svg>
    `),
  },
];

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

/** Получить все стикеры (кастомные из админки + базовые графические Base64). */
export function getAllStickers(): StickerItem[] {
  return [...getCustomStickers(), ...BUILTIN_STICKERS];
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
