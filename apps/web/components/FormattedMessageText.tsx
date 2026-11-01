'use client';

import React, { useState, useEffect } from 'react';

export interface PollPayload {
  question: string;
  options: string[];
  multi?: boolean;
}

const POLL_PREFIX = '__PIXPOLL__:';
const TTL_REGEX = /^\[🔥TTL:(\d+)\]\n?/;

export function encodePollMessage(payload: PollPayload): string {
  return `${POLL_PREFIX}${JSON.stringify(payload)}`;
}

export function isPollMessage(text: string): boolean {
  return Boolean(text && text.startsWith(POLL_PREFIX));
}

export function parsePollMessage(text: string): PollPayload | null {
  if (!isPollMessage(text)) return null;
  try {
    const parsed = JSON.parse(text.slice(POLL_PREFIX.length));
    if (
      parsed &&
      typeof parsed.question === 'string' &&
      Array.isArray(parsed.options) &&
      parsed.options.length >= 2
    ) {
      return parsed as PollPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export function encodeSelfDestructPrefix(ttlSeconds: number, text: string): string {
  if (!ttlSeconds || ttlSeconds <= 0) return text;
  const expiresAt = Date.now() + ttlSeconds * 1000;
  return `[🔥TTL:${expiresAt}]\n${text}`;
}

export function extractSelfDestructInfo(text: string): {
  expiresAt: number | null;
  cleanText: string;
} {
  if (!text) return { expiresAt: null, cleanText: '' };
  const match = text.match(TTL_REGEX);
  if (!match) return { expiresAt: null, cleanText: text };
  const expiresAt = parseInt(match[1], 10);
  const cleanText = text.replace(TTL_REGEX, '');
  return {
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    cleanText,
  };
}

export function extractUrlsFromText(text: string): string[] {
  if (!text) return [];
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi);
  return matches ? Array.from(new Set(matches)) : [];
}

function getLinkPreviewMeta(rawUrl: string): {
  domain: string;
  title: string;
  subtitle: string;
  badge: string;
} {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.replace(/^www\./, '');

    if (host.includes('pixset-studio.github.io')) {
      const nick = u.searchParams.get('n');
      if (u.pathname.includes('/u') && nick) {
        return {
          domain: 'pixset-studio.github.io',
          title: `Профиль игрока @${nick} — Pixset Studio`,
          subtitle: 'Официальный портал Pixset Studio · Статистика, бейджи и игры',
          badge: '⚡ PIXSET STUDIO',
        };
      }
      if (u.pathname.includes('byte-blaster')) {
        return {
          domain: 'pixset-studio.github.io',
          title: 'Byte Blaster — Pixset Studio',
          subtitle: 'Аркадный кибер-шутер от Pixset Studio',
          badge: '🎮 BYTE BLASTER',
        };
      }
      return {
        domain: 'pixset-studio.github.io',
        title: 'Pixset Studio — Официальный сайт',
        subtitle: u.pathname && u.pathname !== '/' ? `Раздел: ${u.pathname}` : 'Игры, экосистема и сообщество Pixset Studio',
        badge: '⚡ PIXSET STUDIO',
      };
    }

    if (host === 'github.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      const repoLabel = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : u.pathname;
      return {
        domain: 'github.com',
        title: `GitHub: ${repoLabel || 'Репозиторий'}`,
        subtitle: rawUrl,
        badge: '💻 GITHUB',
      };
    }

    if (host.includes('youtube.com') || host === 'youtu.be') {
      return {
        domain: host,
        title: 'Видео на YouTube',
        subtitle: rawUrl,
        badge: '▶️ YOUTUBE',
      };
    }

    return {
      domain: host,
      title: host,
      subtitle: u.pathname && u.pathname !== '/' ? u.pathname : rawUrl,
      badge: '🔗 ССЫЛКА',
    };
  } catch {
    return {
      domain: 'Ссылка',
      title: rawUrl,
      subtitle: 'Перейти по внешней ссылке',
      badge: '🔗 ССЫЛКА',
    };
  }
}

function SpoilerSpan({ content }: { content: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        setRevealed((v) => !v);
      }}
      title={revealed ? 'Нажмите, чтобы скрыть спойлер' : 'Спойлер — нажмите, чтобы показать'}
      style={{
        display: 'inline',
        padding: '1px 5px',
        borderRadius: 4,
        cursor: 'pointer',
        background: revealed ? 'rgba(255, 212, 0, 0.14)' : 'rgba(255, 255, 255, 0.18)',
        color: revealed ? 'inherit' : 'transparent',
        filter: revealed ? 'none' : 'blur(4px)',
        userSelect: revealed ? 'text' : 'none',
        transition: 'all 0.2s ease',
      }}
    >
      {content}
    </span>
  );
}

/**
 * Разбирает инлайн-разметку:
 * - `код`
 * - ||спойлер||
 * - **жирный**
 * - *курсив*
 * - ~~зачёркнутый~~
 * - https://... ссылки
 * - @username упоминания
 */
function renderInlineTokens(text: string): React.ReactNode[] {
  const tokenRegex =
    /(`[^`\n]+`|\|\|[^|\n]+\|\||\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|https?:\/\/[^\s<>"')]+|@[a-zA-Z0-9_]{2,32}|#[a-zA-Z0-9_а-яА-ЯёЁ]{2,32})/g;

  const parts = text.split(tokenRegex);
  return parts.map((part, idx) => {
    if (!part) return null;

    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.9em',
            background: 'rgba(0, 0, 0, 0.35)',
            border: '1px solid var(--border)',
            padding: '1px 5px',
            borderRadius: 4,
            color: 'var(--accent)',
          }}
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith('||') && part.endsWith('||') && part.length > 4) {
      return <SpoilerSpan key={idx} content={part.slice(2, -2)} />;
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith('~~') && part.endsWith('~~') && part.length > 4) {
      return <del key={idx}>{part.slice(2, -2)}</del>;
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={idx}>{part.slice(1, -1)}</em>;
    }

    if (/^https?:\/\//i.test(part)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            color: 'var(--accent)',
            textDecoration: 'underline',
            wordBreak: 'break-all',
          }}
        >
          {part}
        </a>
      );
    }

    if (part.startsWith('@') && part.length > 2) {
      return (
        <span
          key={idx}
          style={{
            color: 'var(--accent)',
            fontWeight: 600,
          }}
        >
          {part}
        </span>
      );
    }

    if (part.startsWith('#') && part.length > 1) {
      return (
        <span
          key={idx}
          style={{
            color: 'var(--accent)',
            fontWeight: 700,
            cursor: 'pointer',
            padding: '1px 4px',
            borderRadius: 4,
            background: 'rgba(245, 158, 11, 0.12)',
            display: 'inline-block',
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('pixchats:hashtag_click', { detail: part }));
            }
          }}
          title={`Искать по хэштегу ${part}`}
        >
          {part}
        </span>
      );
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export interface FormattedMessageTextProps {
  messageId: string;
  rawText: string;
  editedAt?: string | null;
  isDeleted?: boolean;
  myUserId?: string;
  reactions?: Record<string, string[]>;
  onVotePollOption?: (optionIndex: number) => void;
  onSelfDestructExpired?: (messageId: string) => void;
}

export function FormattedMessageText({
  messageId,
  rawText,
  editedAt,
  isDeleted,
  myUserId,
  reactions = {},
  onVotePollOption,
  onSelfDestructExpired,
}: FormattedMessageTextProps) {
  const { expiresAt, cleanText } = extractSelfDestructInfo(rawText);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(() => {
    if (!expiresAt) return null;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  });

  useEffect(() => {
    if (!expiresAt || isDeleted) return;
    const updateTimer = () => {
      const rem = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
      setSecondsRemaining(rem);
      if (rem <= 0 && onSelfDestructExpired) {
        onSelfDestructExpired(messageId);
      }
    };
    updateTimer();
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, isDeleted, messageId, onSelfDestructExpired]);

  // 1. Проверяем, не является ли сообщение интерактивным опросом
  const poll = parsePollMessage(cleanText);
  if (poll && !isDeleted) {
    // Голоса хранятся в реакциях с ключами "📊1", "📊2", ...
    const optionVotes = poll.options.map((_, idx) => {
      const key = `📊${idx + 1}`;
      return reactions[key] || [];
    });
    const totalVotes = optionVotes.reduce((acc, list) => acc + list.length, 0);

    return (
      <div
        className="bubble poll-bubble-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minWidth: 250,
          maxWidth: 360,
          padding: '12px 14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--accent)',
            }}
          >
            📊 Опрос {poll.multi ? '· Несколько ответов' : '· Голосование'}
          </span>
          {secondsRemaining !== null && (
            <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
              🔥 {secondsRemaining}с
            </span>
          )}
        </div>

        <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.35, color: 'var(--text)' }}>
          {poll.question}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {poll.options.map((opt, idx) => {
            const voters = optionVotes[idx];
            const count = voters.length;
            const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
            const votedByMe = Boolean(myUserId && voters.includes(myUserId));

            return (
              <button
                key={idx}
                type="button"
                onClick={() => onVotePollOption?.(idx)}
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(0, 0, 0, 0.28)',
                  border: `1px solid ${votedByMe ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${pct}%`,
                    background: votedByMe
                      ? 'rgba(255, 212, 0, 0.22)'
                      : 'rgba(255, 255, 255, 0.07)',
                    transition: 'width 0.25s ease',
                    pointerEvents: 'none',
                  }}
                />
                <span style={{ position: 'relative', zIndex: 1, fontWeight: votedByMe ? 700 : 500 }}>
                  {votedByMe ? '✓ ' : ''}
                  {opt}
                </span>
                <span
                  style={{
                    position: 'relative',
                    zIndex: 1,
                    fontSize: 11.5,
                    color: votedByMe ? 'var(--accent)' : 'var(--text-muted)',
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {pct}% ({count})
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Всего голосов: {totalVotes} · Нажмите на вариант, чтобы проголосовать
        </div>
      </div>
    );
  }

  // 2. Обычное или отформатированное текстовое сообщение + авто-превью ссылок
  const urls = isDeleted ? [] : extractUrlsFromText(cleanText);
  const firstUrl = urls[0];
  const previewMeta = firstUrl ? getLinkPreviewMeta(firstUrl) : null;

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 6, maxWidth: '100%' }}>
      <span className="bubble message-text" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {secondsRemaining !== null && !isDeleted && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 10.5,
              fontWeight: 700,
              background: 'rgba(245, 158, 11, 0.18)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.4)',
              borderRadius: 5,
              padding: '1px 6px',
              marginRight: 6,
            }}
            title="Исчезающее сообщение — удалится автоматически по таймеру"
          >
            🔥 {secondsRemaining >= 60 ? `${Math.ceil(secondsRemaining / 60)}м` : `${secondsRemaining}с`}
          </span>
        )}
        {isDeleted ? cleanText : renderInlineTokens(cleanText)}
        {editedAt && !isDeleted && <span className="edited-label"> (изменено)</span>}
      </span>

      {previewMeta && firstUrl && (
        <a
          href={firstUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            padding: '9px 12px',
            borderRadius: 10,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--accent)',
            textDecoration: 'none',
            color: 'var(--text)',
            maxWidth: 340,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.05em' }}>
            {previewMeta.badge} · {previewMeta.domain}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, lineHeight: 1.3 }}>
            {previewMeta.title}
          </span>
          <span
            style={{
              fontSize: 11.5,
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {previewMeta.subtitle}
          </span>
        </a>
      )}
    </div>
  );
}
