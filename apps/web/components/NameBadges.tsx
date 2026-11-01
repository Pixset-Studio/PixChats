'use client';

import React, { useEffect, useState } from 'react';
import type { UserRole } from '@pixchats/core';
import { getUserEmojiStatus, syncAllEmojiStatusesFromCloud } from '../lib/emojiStatus';

interface NameWithBadgesProps {
  name: string;
  role?: UserRole;
  isVerified?: boolean;
  isPixsetEmployee?: boolean;
  isFrozen?: boolean;
  isInteractive?: boolean;
  userId?: string | null;
  username?: string | null;
  emojiStatus?: string | null;
}

const ROLE_META: Record<Exclude<UserRole, 'user'>, { label: string; icon: string; className: string }> = {
  moderator: { label: 'Модератор', icon: '🛡️', className: 'role-badge role-moderator' },
  admin: { label: 'Админ', icon: '⚡', className: 'role-badge role-admin' },
  developer: { label: 'Разработчик', icon: '👑', className: 'role-badge role-developer' },
  partner: { label: 'Партнёр', icon: '🤝', className: 'role-badge role-partner' },
};

export function NameWithBadges({
  name,
  role = 'user',
  isVerified = false,
  isPixsetEmployee = false,
  isFrozen = false,
  isInteractive = true,
  userId,
  username,
  emojiStatus,
}: NameWithBadgesProps) {
  const [tip, setTip] = useState<string | null>(null);
  const [resolvedEmoji, setResolvedEmoji] = useState<string | null>(() =>
    emojiStatus !== undefined ? emojiStatus : getUserEmojiStatus(userId, username || name)
  );

  useEffect(() => {
    if (emojiStatus !== undefined) {
      setResolvedEmoji(emojiStatus);
      return;
    }
    const update = () => {
      setResolvedEmoji(getUserEmojiStatus(userId, username || name));
    };
    update();
    syncAllEmojiStatusesFromCloud().then(update).catch(() => {});
    if (typeof window !== 'undefined') {
      window.addEventListener('pixchats-emoji-status-changed', update);
      return () => window.removeEventListener('pixchats-emoji-status-changed', update);
    }
  }, [userId, username, name, emojiStatus]);

  const roleMeta = role !== 'user' ? ROLE_META[role] : null;

  function toggleTip(nextTip: string) {
    if (!isInteractive) return;
    setTip((prev) => (prev === nextTip ? null : nextTip));
  }

  return (
    <span className="name-with-badges">
      <span>{name}</span>

      {resolvedEmoji && (
        <span
          className="emoji-status-badge"
          title={`Эмодзи-статус: ${resolvedEmoji}`}
          onClick={
            isInteractive
              ? (e) => {
                  e.stopPropagation();
                  toggleTip(`Эмодзи-статус ${resolvedEmoji}`);
                }
              : undefined
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.02em',
            lineHeight: 1,
            marginLeft: 3,
            padding: '1px 4px',
            borderRadius: 6,
            background: 'rgba(255, 212, 0, 0.1)',
            border: '1px solid rgba(255, 212, 0, 0.24)',
            cursor: isInteractive ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          {resolvedEmoji}
        </span>
      )}

      {isVerified && (
        <span
          className="verified-badge"
          role={isInteractive ? 'button' : undefined}
          tabIndex={isInteractive ? 0 : undefined}
          onClick={isInteractive ? () => toggleTip('Верифицированный аккаунт') : undefined}
          title="Верифицированный аккаунт"
        >
          ✓
        </span>
      )}

      {roleMeta && (
        <span
          className={roleMeta.className}
          role={isInteractive ? 'button' : undefined}
          tabIndex={isInteractive ? 0 : undefined}
          onClick={isInteractive ? () => toggleTip(roleMeta.label) : undefined}
          title={roleMeta.label}
        >
          {roleMeta.icon}
        </span>
      )}

      {isInteractive && tip && <span className="badge-popover">{tip}</span>}
    </span>
  );
}
