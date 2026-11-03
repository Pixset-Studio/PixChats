'use client';

import React, { useState, useEffect } from 'react';
import { parseChecklistMessage, parseLocationMessage } from './ChatInteractiveTools';
import {
  parseTableMessage,
  parseAlbumMessage,
  parseTimecodeSeconds,
} from '../lib/premiumAndFeatures';
import { seekGlobalAudio } from '../lib/audioPlayerStore';

export interface PollPayload {
  question: string;
  options: string[];
  multi?: boolean;
  isQuiz?: boolean;
  correctIndex?: number;
  explanation?: string;
  closesAt?: number | null;
}

const POLL_PREFIX = '__PIXPOLL__:';
const TTL_REGEX = /^\[🔥TTL:(\d+)\]\n?/;
const SILENT_PREFIX = '__SILENT__:';

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
  isSilent: boolean;
  cleanText: string;
} {
  if (!text) return { expiresAt: null, isSilent: false, cleanText: '' };
  let working = text;
  let isSilent = false;
  if (working.startsWith(SILENT_PREFIX)) {
    isSilent = true;
    working = working.slice(SILENT_PREFIX.length);
  }
  const match = working.match(TTL_REGEX);
  if (!match) {
    if (working.startsWith(SILENT_PREFIX)) {
      isSilent = true;
      working = working.slice(SILENT_PREFIX.length);
    }
    return { expiresAt: null, isSilent, cleanText: working };
  }
  const expiresAt = parseInt(match[1], 10);
  let cleanText = working.replace(TTL_REGEX, '');
  if (cleanText.startsWith(SILENT_PREFIX)) {
    isSilent = true;
    cleanText = cleanText.slice(SILENT_PREFIX.length);
  }
  return {
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
    isSilent,
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
      className={`spoiler-text ${revealed ? 'revealed' : ''}`}
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
 * - 01:25 таймкоды с перемоткой
 * - https://... ссылки
 * - @username упоминания
 * - #хэштеги
 */
function renderInlineTokens(text: string, messageId?: string): React.ReactNode[] {
  const tokenRegex =
    /(`[^`\n]+`|\|\|[^|\n]+\|\||\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|https?:\/\/[^\s<>"')]+|@[a-zA-Z0-9_]{2,32}|#[a-zA-Z0-9_а-яА-ЯёЁ]{2,32}|\b\d{1,2}:\d{2}(?::\d{2})?\b)/g;

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

    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(part)) {
      const sec = parseTimecodeSeconds(part);
      if (sec !== null) {
        return (
          <button
            key={idx}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              seekGlobalAudio(sec);
              if (typeof window !== 'undefined') {
                window.dispatchEvent(
                  new CustomEvent('pixchats:seek_media_timecode', {
                    detail: { seconds: sec, messageId },
                  })
                );
              }
            }}
            title={`Перемотать аудио/видео на ${part}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '0 5px',
              borderRadius: 4,
              border: '1px solid rgba(255, 212, 0, 0.35)',
              background: 'rgba(255, 212, 0, 0.14)',
              color: 'var(--accent)',
              fontSize: '0.9em',
              fontWeight: 700,
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
          >
            ⏱ {part}
          </button>
        );
      }
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
            textDecoration: 'none',
            fontWeight: 600,
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
  onToggleChecklistItem?: (itemIndex: number) => void;
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
  onToggleChecklistItem,
  onSelfDestructExpired,
}: FormattedMessageTextProps) {
  const { expiresAt, isSilent, cleanText } = extractSelfDestructInfo(rawText);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(() => {
    if (!expiresAt) return null;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  });
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [albumRevealed, setAlbumRevealed] = useState(false);
  const [albumLightboxIndex, setAlbumLightboxIndex] = useState<number | null>(null);

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

  // 1. Проверяем, не является ли сообщение интерактивным опросом или викториной
  const poll = parsePollMessage(cleanText);
  if (poll && !isDeleted) {
    const optionVotes = poll.options.map((_, idx) => {
      const key = `📊${idx + 1}`;
      return reactions[key] || [];
    });
    const totalVotes = optionVotes.reduce((acc, list) => acc + list.length, 0);
    const hasVotedAny = Boolean(myUserId && optionVotes.some((voters) => voters.includes(myUserId)));
    const isClosedByTimer = Boolean(poll.closesAt && poll.closesAt <= Date.now());
    const closeRemSec =
      poll.closesAt && poll.closesAt > Date.now()
        ? Math.max(0, Math.ceil((poll.closesAt - Date.now()) / 1000))
        : null;

    return (
      <div
        className="bubble poll-bubble-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minWidth: 255,
          maxWidth: 370,
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
            {poll.isQuiz
              ? '🧠 Викторина · Выберите правильный ответ'
              : `📊 Опрос ${poll.multi ? '· Несколько ответов' : '· Голосование'}`}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {closeRemSec !== null && (
              <span style={{ fontSize: 10.5, color: '#38bdf8', fontWeight: 700 }}>
                ⏱ {closeRemSec >= 60 ? `${Math.ceil(closeRemSec / 60)}м` : `${closeRemSec}с`}
              </span>
            )}
            {isClosedByTimer && (
              <span style={{ fontSize: 10.5, color: '#ef4444', fontWeight: 700 }}>
                🔒 Завершён
              </span>
            )}
            {secondsRemaining !== null && (
              <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
                🔥 {secondsRemaining}с
              </span>
            )}
          </div>
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
            const isCorrectQuizOption = poll.isQuiz && typeof poll.correctIndex === 'number' && poll.correctIndex === idx;
            const showQuizResult = Boolean(poll.isQuiz && (hasVotedAny || isClosedByTimer));

            let borderCol = votedByMe ? 'var(--accent)' : 'var(--border)';
            let barBg = votedByMe ? 'rgba(255, 212, 0, 0.22)' : 'rgba(255, 255, 255, 0.07)';
            if (showQuizResult) {
              if (isCorrectQuizOption) {
                borderCol = '#22c55e';
                barBg = 'rgba(34, 197, 94, 0.25)';
              } else if (votedByMe) {
                borderCol = '#ef4444';
                barBg = 'rgba(239, 68, 68, 0.22)';
              }
            }

            return (
              <button
                key={idx}
                type="button"
                disabled={isClosedByTimer}
                onClick={() => {
                  if (isClosedByTimer) return;
                  onVotePollOption?.(idx);
                }}
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
                  border: `1px solid ${borderCol}`,
                  color: 'var(--text)',
                  cursor: isClosedByTimer ? 'default' : 'pointer',
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
                    background: barBg,
                    transition: 'width 0.25s ease',
                    pointerEvents: 'none',
                  }}
                />
                <span style={{ position: 'relative', zIndex: 1, fontWeight: votedByMe ? 700 : 500 }}>
                  {showQuizResult
                    ? isCorrectQuizOption
                      ? '✅ '
                      : votedByMe
                      ? '❌ '
                      : ''
                    : votedByMe
                    ? '✓ '
                    : ''}
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

        {poll.isQuiz && (hasVotedAny || isClosedByTimer) && poll.explanation && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255, 212, 0, 0.1)',
              border: '1px solid rgba(255, 212, 0, 0.35)',
              fontSize: 12,
              color: 'var(--text)',
              lineHeight: 1.4,
            }}
          >
            💡 <strong>Объяснение:</strong> {poll.explanation}
          </div>
        )}

        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Всего голосов: {totalVotes} · {isClosedByTimer ? 'Опрос закрыт по таймеру' : 'Нажмите на вариант, чтобы проголосовать'}
        </div>
      </div>
    );
  }

  // 1b. Встроенная таблица (__TABLE__:...)
  const tableData = parseTableMessage(cleanText);
  if (tableData && !isDeleted) {
    return (
      <div
        className="bubble poll-bubble-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: '100%',
          overflowX: 'auto',
          padding: '10px 12px',
        }}
      >
        <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--accent)', textTransform: 'uppercase' }}>
          📊 Таблица
        </div>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            minWidth: 220,
            fontSize: 12.5,
          }}
        >
          <thead>
            <tr>
              {tableData.headers.map((h, i) => (
                <th
                  key={i}
                  style={{
                    border: '1px solid var(--border)',
                    padding: '6px 10px',
                    background: 'rgba(255, 212, 0, 0.15)',
                    color: 'var(--accent)',
                    fontWeight: 800,
                    textAlign: 'left',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableData.rows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td
                    key={cIdx}
                    style={{
                      border: '1px solid var(--border)',
                      padding: '6px 10px',
                      background: rIdx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.2)',
                      color: 'var(--text)',
                    }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 1c. Сетка фотоальбома / карусель (__ALBUM__:...)
  const albumData = parseAlbumMessage(cleanText);
  if (albumData && !isDeleted) {
    const isSpoilerHidden = Boolean(albumData.spoiler && !albumRevealed);
    const cols = albumData.images.length === 1 ? 1 : albumData.images.length <= 4 ? 2 : 3;

    return (
      <div
        className="bubble poll-bubble-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          maxWidth: 360,
          padding: 8,
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 4,
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {albumData.images.map((src, idx) => (
            <div
              key={idx}
              onClick={() => {
                if (isSpoilerHidden) {
                  setAlbumRevealed(true);
                } else {
                  setAlbumLightboxIndex(idx);
                }
              }}
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                overflow: 'hidden',
                cursor: 'pointer',
                background: '#111',
              }}
            >
              <img
                src={src}
                alt={`Фото ${idx + 1}`}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: isSpoilerHidden ? 'blur(18px) brightness(0.7)' : 'none',
                  transition: 'filter 0.25s ease',
                }}
              />
            </div>
          ))}
          {isSpoilerHidden && (
            <button
              type="button"
              onClick={() => setAlbumRevealed(true)}
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.35)',
                color: '#fff',
                border: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                cursor: 'pointer',
                fontWeight: 800,
                fontSize: 13,
              }}
            >
              <span>✨ СПОЙЛЕР ({albumData.images.length} фото)</span>
              <span style={{ fontSize: 11, opacity: 0.85 }}>Нажмите, чтобы открыть</span>
            </button>
          )}
        </div>

        {albumData.caption && (
          <div style={{ fontSize: 13, color: 'var(--text)', padding: '2px 4px' }}>
            {renderInlineTokens(albumData.caption, messageId)}
          </div>
        )}

        {albumLightboxIndex !== null && (
          <div
            className="modal-overlay"
            onClick={() => setAlbumLightboxIndex(null)}
            style={{ zIndex: 9999 }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                maxWidth: '92vw',
              }}
            >
              <img
                src={albumData.images[albumLightboxIndex]}
                alt="Просмотр альбома"
                style={{
                  maxWidth: '88vw',
                  maxHeight: '78vh',
                  borderRadius: 12,
                  objectFit: 'contain',
                  border: '1px solid var(--border)',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ width: 'auto' }}
                  onClick={() =>
                    setAlbumLightboxIndex(
                      (albumLightboxIndex - 1 + albumData.images.length) % albumData.images.length
                    )
                  }
                >
                  ◀ Пред.
                </button>
                <span style={{ color: '#fff', fontWeight: 700, fontSize: 13 }}>
                  {albumLightboxIndex + 1} / {albumData.images.length}
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ width: 'auto' }}
                  onClick={() =>
                    setAlbumLightboxIndex((albumLightboxIndex + 1) % albumData.images.length)
                  }
                >
                  След. ▶
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                  onClick={() => setAlbumLightboxIndex(null)}
                >
                  Закрыть ✕
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // 1d. Совместный чек-лист
  const checklist = parseChecklistMessage(cleanText);
  if (checklist && !isDeleted) {
    const itemChecks = checklist.items.map((_, idx) => {
      const key = `☑️${idx + 1}`;
      return reactions[key] || [];
    });
    const completedCount = itemChecks.filter((users) => users.length > 0).length;
    const totalItems = checklist.items.length;
    const progressPct = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

    return (
      <div
        className="bubble poll-bubble-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          minWidth: 260,
          maxWidth: 370,
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
            ☑️ Чек-лист · {completedCount}/{totalItems} ({progressPct}%)
          </span>
          {secondsRemaining !== null && (
            <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>
              🔥 {secondsRemaining}с
            </span>
          )}
        </div>

        <div style={{ fontWeight: 700, fontSize: 14.5, lineHeight: 1.35, color: 'var(--text)' }}>
          {checklist.title}
        </div>

        <div
          style={{
            height: 6,
            borderRadius: 99,
            background: 'rgba(255,255,255,0.1)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPct}%`,
              background: progressPct === 100 ? '#22c55e' : 'var(--accent)',
              transition: 'width 0.25s ease',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {checklist.items.map((itemText, idx) => {
            const checkUsers = itemChecks[idx];
            const isChecked = checkUsers.length > 0;
            const checkedByMe = Boolean(myUserId && checkUsers.includes(myUserId));

            return (
              <button
                key={idx}
                type="button"
                onClick={() => onToggleChecklistItem?.(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: isChecked ? 'rgba(34, 197, 94, 0.12)' : 'rgba(0, 0, 0, 0.28)',
                  border: `1px solid ${checkedByMe ? '#22c55e' : isChecked ? 'rgba(34, 197, 94, 0.4)' : 'var(--border)'}`,
                  color: 'var(--text)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 13,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      border: `2px solid ${isChecked ? '#22c55e' : 'var(--text-muted)'}`,
                      background: isChecked ? '#22c55e' : 'transparent',
                      color: '#000',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      fontWeight: 900,
                      flexShrink: 0,
                    }}
                  >
                    {isChecked ? '✓' : ''}
                  </span>
                  <span
                    style={{
                      textDecoration: isChecked ? 'line-through' : 'none',
                      opacity: isChecked ? 0.72 : 1,
                      fontWeight: isChecked ? 500 : 600,
                    }}
                  >
                    {itemText}
                  </span>
                </span>
                {checkUsers.length > 0 && (
                  <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 700, flexShrink: 0 }}>
                    ✓ {checkUsers.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Нажмите на пункт, чтобы отметить выполненным или снять галочку
        </div>
      </div>
    );
  }

  // 1e. Карточка геопозиции
  const loc = parseLocationMessage(cleanText);
  if (loc && !isDeleted) {
    const bbox = `${(loc.lon - 0.008).toFixed(5)}%2C${(loc.lat - 0.005).toFixed(5)}%2C${(loc.lon + 0.008).toFixed(5)}%2C${(loc.lat + 0.005).toFixed(5)}`;
    const osmUrl = `https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lon}#map=16/${loc.lat}/${loc.lon}`;

    return (
      <div
        className="bubble poll-bubble-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 265,
          maxWidth: 360,
          padding: 10,
        }}
      >
        <div
          style={{
            width: '100%',
            height: 165,
            borderRadius: 10,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: '#111',
          }}
        >
          <iframe
            title={loc.title || 'Карта'}
            width="100%"
            height="165"
            style={{ border: 0, display: 'block' }}
            loading="lazy"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${loc.lat}%2C${loc.lon}`}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '0 2px' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>📍</span>
            <span>{loc.title || 'Геопозиция на карте'}</span>
          </div>
          {loc.address && (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.35 }}>
              {loc.address}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: 2 }}>
            {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <a
            href={osmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary"
            style={{ flex: 1, fontSize: 11.5, padding: '6px 10px', textDecoration: 'none', textAlign: 'center' }}
          >
            🗺️ Открыть карту
          </a>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', fontSize: 11.5, padding: '6px 10px' }}
            onClick={() => {
              void navigator.clipboard.writeText(`${loc.lat.toFixed(6)}, ${loc.lon.toFixed(6)}`);
              setCopiedCoords(true);
              setTimeout(() => setCopiedCoords(false), 1800);
            }}
          >
            {copiedCoords ? '✓ Скопировано' : '📋 Координаты'}
          </button>
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
        {isSilent && !isDeleted && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: 10,
              opacity: 0.75,
              marginRight: 5,
            }}
            title="Тихое сообщение (отправлено без звука уведомления)"
          >
            🔇
          </span>
        )}
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
        {isDeleted ? cleanText : renderInlineTokens(cleanText, messageId)}
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
