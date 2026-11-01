'use client';

import React from 'react';

/**
 * Извлекает 2-буквенный ISO-код страны из Unicode-эмодзи флага (пары региональных индикаторов).
 * Например: '🇷🇺' -> 'ru', '🇰🇿' -> 'kz', '🇺🇸' -> 'us'.
 */
export function getCountryCodeFromFlagEmoji(emoji: string): string | null {
  if (!emoji) return null;
  const codePoints: number[] = [];
  for (let i = 0; i < emoji.length; i++) {
    const cp = emoji.codePointAt(i);
    if (!cp) continue;
    if (cp > 0xffff) i++;
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
      codePoints.push(cp);
    }
  }
  if (codePoints.length === 2) {
    const c1 = String.fromCharCode(codePoints[0] - 0x1f1e6 + 65).toLowerCase();
    const c2 = String.fromCharCode(codePoints[1] - 0x1f1e6 + 65).toLowerCase();
    return `${c1}${c2}`;
  }
  return null;
}

const SPECIAL_FLAG_SVGS: Record<string, string> = {
  '🏳️‍🌈': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f3-fe0f-200d-1f308.svg',
  '🏳️‍⚧️': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f3-fe0f-200d-26a7-fe0f.svg',
  '🏴‍☠️': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f4-200d-2620.svg',
  '🏁': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3c1.svg',
  '🚩': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f6a9.svg',
  '🏳️': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f3-fe0f.svg',
  '🏴': 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f3f4.svg',
  '🇺🇳': 'https://flagcdn.com/un.svg',
  '🇪🇺': 'https://flagcdn.com/eu.svg',
};

/**
 * Возвращает URL векторного SVG-изображения для флага, чтобы флаги на Windows PC
 * и других системах никогда не отображались как текст «RU», «KZ», «US».
 */
export function getFlagSvgUrl(emoji: string): string | null {
  if (!emoji) return null;
  const clean = emoji.trim();
  if (SPECIAL_FLAG_SVGS[clean]) {
    return SPECIAL_FLAG_SVGS[clean];
  }
  const countryCode = getCountryCodeFromFlagEmoji(clean);
  if (countryCode) {
    return `https://flagcdn.com/${countryCode}.svg`;
  }
  return null;
}

export function isFlagEmoji(emoji: string): boolean {
  return Boolean(getFlagSvgUrl(emoji));
}

interface EmojiOrFlagProps {
  char: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Универсальный компонент для отображения эмодзи и флагов.
 * Если передан флаг — отображает чёткий цветной SVG флаг вместо текстовых букв «RU» на Windows.
 */
export function EmojiOrFlag({ char, size = 18, className, style }: EmojiOrFlagProps) {
  const flagUrl = getFlagSvgUrl(char);

  if (flagUrl) {
    return (
      <img
        src={flagUrl}
        alt={char}
        title={char}
        className={className}
        loading="lazy"
        draggable={false}
        style={{
          width: Math.round(size * 1.35),
          height: size,
          objectFit: 'cover',
          borderRadius: 3,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.14)',
          display: 'inline-block',
          verticalAlign: 'middle',
          userSelect: 'none',
          ...style,
        }}
        onError={(e) => {
          // Фолбэк на Twemoji если flagcdn временно недоступен
          const cc = getCountryCodeFromFlagEmoji(char);
          if (cc) {
            const hex1 = (0x1f1e6 + (cc.charCodeAt(0) - 97)).toString(16);
            const hex2 = (0x1f1e6 + (cc.charCodeAt(1) - 97)).toString(16);
            const fallbackUrl = `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${hex1}-${hex2}.svg`;
            if ((e.currentTarget as HTMLImageElement).src !== fallbackUrl) {
              (e.currentTarget as HTMLImageElement).src = fallbackUrl;
            }
          }
        }}
      />
    );
  }

  return (
    <span
      className={className}
      style={{
        fontSize: size,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      {char}
    </span>
  );
}
