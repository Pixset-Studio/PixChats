'use client';

import React, { useEffect, useState } from 'react';
import {
  getUserCustomRolesSync,
  syncCustomRolesFromCloud,
  type UserRole,
  type CustomRoleDefinition,
} from '@pixchats/core';
import { getUserEmojiStatus, syncAllEmojiStatusesFromCloud } from '../lib/emojiStatus';
import { EmojiOrFlag } from './EmojiOrFlag';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

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

interface RoleBadgeConfig {
  label: string;
  badgeFile: string;
  className: string;
}

const ROLE_BADGE_MAP: Record<Exclude<UserRole, 'user'>, RoleBadgeConfig> = {
  developer: { label: 'Разработчик Pixset Studio', badgeFile: 'developer.png', className: 'role-badge-img role-developer' },
  partner: { label: 'Официальный партнёр', badgeFile: 'partner.png', className: 'role-badge-img role-partner' },
  admin: { label: 'Администратор', badgeFile: 'shield.png', className: 'role-badge-img role-admin' },
  moderator: { label: 'Модератор', badgeFile: 'shield.png', className: 'role-badge-img role-moderator' },
};

function isImageIconSource(icon: string): boolean {
  if (!icon) return false;
  return (
    icon.startsWith('data:image/') ||
    icon.startsWith('http://') ||
    icon.startsWith('https://') ||
    icon.startsWith('/') ||
    icon.endsWith('.png') ||
    icon.endsWith('.svg') ||
    icon.endsWith('.webp')
  );
}

function resolveBadgeImageUrl(icon: string): string {
  if (
    icon.startsWith('data:image/') ||
    icon.startsWith('http://') ||
    icon.startsWith('https://') ||
    icon.startsWith('/')
  ) {
    return icon;
  }
  return `${BASE_PATH}/badges/${icon}`;
}

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
  const [customRoles, setCustomRoles] = useState<CustomRoleDefinition[]>(() =>
    getUserCustomRolesSync(userId, username)
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

  useEffect(() => {
    if (!userId && !username) return;
    const updateCustomRoles = () => {
      setCustomRoles(getUserCustomRolesSync(userId, username));
    };
    updateCustomRoles();
    syncCustomRolesFromCloud(false).then(updateCustomRoles).catch(() => {});
    if (typeof window !== 'undefined') {
      window.addEventListener('pixchats-custom-roles-changed', updateCustomRoles);
      return () => window.removeEventListener('pixchats-custom-roles-changed', updateCustomRoles);
    }
  }, [userId, username]);

  const roleMeta = role !== 'user' ? ROLE_BADGE_MAP[role] : null;

  function toggleTip(nextTip: string) {
    if (!isInteractive) return;
    setTip((prev) => (prev === nextTip ? null : nextTip));
  }

  return (
    <span className="name-with-badges" style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 3, position: 'relative' }}>
      <span>{name}</span>

      {resolvedEmoji && (
        <span
          className="emoji-status-badge"
          title={`Эмодзи-статус: ${resolvedEmoji}`}
          onClick={
            isInteractive
              ? (e) => {
                  e.stopPropagation();
                  toggleTip(`Эмодзи-статус: ${resolvedEmoji}`);
                }
              : undefined
          }
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: 2,
            padding: '1px 4px',
            borderRadius: 6,
            background: 'rgba(255, 212, 0, 0.12)',
            border: '1px solid rgba(255, 212, 0, 0.28)',
            cursor: isInteractive ? 'pointer' : 'default',
            userSelect: 'none',
          }}
        >
          <EmojiOrFlag char={resolvedEmoji} size={15} />
        </span>
      )}

      {isPixsetEmployee && (
        <img
          src={`${BASE_PATH}/badges/employee.png`}
          alt="Сотрудник Pixset Studio"
          title="Сотрудник Pixset Studio"
          className="role-badge-png employee-badge-png"
          onClick={isInteractive ? () => toggleTip('Сотрудник Pixset Studio') : undefined}
          style={{
            width: 17,
            height: 17,
            objectFit: 'contain',
            verticalAlign: 'middle',
            cursor: isInteractive ? 'pointer' : 'default',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
          }}
        />
      )}

      {roleMeta && (
        <img
          src={`${BASE_PATH}/badges/${roleMeta.badgeFile}`}
          alt={roleMeta.label}
          title={roleMeta.label}
          className={`role-badge-png ${roleMeta.className}`}
          onClick={isInteractive ? () => toggleTip(roleMeta.label) : undefined}
          style={{
            width: 17,
            height: 17,
            objectFit: 'contain',
            verticalAlign: 'middle',
            cursor: isInteractive ? 'pointer' : 'default',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
          }}
        />
      )}

      {customRoles.map((cr) => {
        const isImg = isImageIconSource(cr.icon);
        return (
          <span
            key={cr.id}
            title={`Роль: ${cr.name}${cr.description ? ` — ${cr.description}` : ''}`}
            onClick={
              isInteractive
                ? (e) => {
                    e.stopPropagation();
                    toggleTip(cr.name);
                  }
                : undefined
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              padding: isImg ? '1px 3px' : '1px 5px',
              borderRadius: 6,
              background: `${cr.color || '#ffd400'}22`,
              border: `1px solid ${cr.color || '#ffd400'}66`,
              color: cr.color || 'var(--accent)',
              fontSize: 11,
              fontWeight: 700,
              cursor: isInteractive ? 'pointer' : 'default',
              lineHeight: 1.1,
            }}
          >
            {isImg ? (
              <img
                src={resolveBadgeImageUrl(cr.icon)}
                alt={cr.name}
                style={{ width: 15, height: 15, objectFit: 'contain' }}
              />
            ) : (
              <span style={{ fontSize: 13 }}>{cr.icon}</span>
            )}
          </span>
        );
      })}

      {isVerified && (
        <img
          src={`${BASE_PATH}/badges/verified.png`}
          alt="Верифицирован"
          title="Верифицированный профиль PixChats"
          className="role-badge-png verified-badge-png"
          onClick={isInteractive ? () => toggleTip('Верифицированный профиль') : undefined}
          style={{
            width: 16,
            height: 16,
            objectFit: 'contain',
            verticalAlign: 'middle',
            cursor: isInteractive ? 'pointer' : 'default',
            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.25))',
          }}
        />
      )}

      {isFrozen && (
        <span
          className="frozen-badge"
          title="Аккаунт временно заморожен"
          style={{ fontSize: 13, verticalAlign: 'middle' }}
        >
          ❄️
        </span>
      )}

      {isInteractive && tip && <span className="badge-popover">{tip}</span>}
    </span>
  );
}
