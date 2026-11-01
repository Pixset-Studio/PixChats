'use client';

export type WallpaperPresetId =
  | 'default'
  | 'pixset-grid'
  | 'starfield'
  | 'carbon'
  | 'oled'
  | 'golden-glow'
  | 'custom';

export interface ChatAppearanceSettings {
  wallpaper: WallpaperPresetId;
  customWallpaperDataUrl?: string;
  wallpaperDimming: number; // 0 .. 85 (%)
  fontSize: 13 | 14 | 16;
  bubbleRadius: 8 | 14 | 20;
}

const STORAGE_KEY = 'pixchats:chat_appearance_v1';

export const DEFAULT_CHAT_APPEARANCE: ChatAppearanceSettings = {
  wallpaper: 'default',
  customWallpaperDataUrl: '',
  wallpaperDimming: 45,
  fontSize: 14,
  bubbleRadius: 14,
};

export const WALLPAPER_PRESETS: Array<{
  id: WallpaperPresetId;
  name: string;
  desc: string;
  previewCss: string;
}> = [
  {
    id: 'default',
    name: 'Классический PixChats',
    desc: 'Стандартный фон выбранной темы',
    previewCss: 'linear-gradient(135deg, #0b0b0c 0%, #151519 100%)',
  },
  {
    id: 'pixset-grid',
    name: 'Кибер-сетка Pixset',
    desc: 'Тёмное полотно с тонкой геометрической сеткой',
    previewCss:
      'radial-gradient(circle at 50% 20%, rgba(255, 212, 0, 0.08), transparent 65%), repeating-linear-gradient(0deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 28px), repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0px, rgba(255,255,255,0.03) 1px, transparent 1px, transparent 28px), #09090b',
  },
  {
    id: 'starfield',
    name: 'Звёздная пыль',
    desc: 'Глубокий космос с мягким точечным узором',
    previewCss:
      'radial-gradient(rgba(255, 212, 0, 0.16) 1px, transparent 1px), radial-gradient(rgba(255, 255, 255, 0.08) 1px, #070709 1px)',
  },
  {
    id: 'carbon',
    name: 'Карбон',
    desc: 'Диагональная техно-текстура',
    previewCss:
      'repeating-linear-gradient(45deg, rgba(255,255,255,0.025) 0px, rgba(255,255,255,0.025) 6px, transparent 6px, transparent 12px), #0a0a0d',
  },
  {
    id: 'oled',
    name: 'Чистый OLED (#000)',
    desc: 'Абсолютно чёрный фон для максимального контраста и экономии заряда',
    previewCss: '#000000',
  },
  {
    id: 'golden-glow',
    name: 'Золотое сияние',
    desc: 'Мягкий тёмно-янтарный градиент в стиле PixChats',
    previewCss:
      'radial-gradient(circle at 80% 15%, rgba(255, 200, 0, 0.14), transparent 50%), radial-gradient(circle at 20% 85%, rgba(255, 160, 0, 0.09), transparent 55%), #09090b',
  },
];

export function getChatAppearance(): ChatAppearanceSettings {
  if (typeof window === 'undefined') return DEFAULT_CHAT_APPEARANCE;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CHAT_APPEARANCE;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CHAT_APPEARANCE,
      ...parsed,
    };
  } catch {
    return DEFAULT_CHAT_APPEARANCE;
  }
}

export function saveChatAppearance(next: Partial<ChatAppearanceSettings>): ChatAppearanceSettings {
  const merged: ChatAppearanceSettings = {
    ...getChatAppearance(),
    ...next,
  };
  if (typeof window !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {}
    applyChatAppearance(merged);
    window.dispatchEvent(new CustomEvent('pixchats:appearance_changed', { detail: merged }));
  }
  return merged;
}

export function applyChatAppearance(settings?: ChatAppearanceSettings): void {
  if (typeof document === 'undefined') return;
  const cfg = settings ?? getChatAppearance();
  const root = document.documentElement;

  root.style.setProperty('--chat-msg-font-size', `${cfg.fontSize}px`);
  root.style.setProperty('--chat-bubble-radius', `${cfg.bubbleRadius}px`);

  if (cfg.wallpaper === 'custom' && cfg.customWallpaperDataUrl) {
    const dim = Math.min(85, Math.max(0, cfg.wallpaperDimming ?? 45)) / 100;
    root.style.setProperty(
      '--chat-custom-wallpaper',
      `linear-gradient(rgba(9, 9, 11, ${dim}), rgba(9, 9, 11, ${dim})), url("${cfg.customWallpaperDataUrl}") center / cover no-repeat`
    );
    root.style.setProperty('--chat-custom-wallpaper-size', 'cover');
  } else if (cfg.wallpaper === 'default') {
    root.style.removeProperty('--chat-custom-wallpaper');
    root.style.removeProperty('--chat-custom-wallpaper-size');
  } else {
    const preset = WALLPAPER_PRESETS.find((p) => p.id === cfg.wallpaper);
    if (preset) {
      root.style.setProperty('--chat-custom-wallpaper', preset.previewCss);
      root.style.setProperty(
        '--chat-custom-wallpaper-size',
        cfg.wallpaper === 'starfield' ? '26px 26px' : 'auto'
      );
    }
  }
}
