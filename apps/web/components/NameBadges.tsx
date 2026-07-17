import type { UserRole } from '@pixchats/core';
import { VerifiedBadge } from './VerifiedBadge';

const ROLE_ICON: Record<UserRole, string | null> = {
  developer: '⚙',
  admin: '🛡',
  moderator: '🔧',
  user: null,
};

const ROLE_TITLE: Record<UserRole, string> = {
  developer: 'Разработчик PixChats',
  admin: 'Администратор',
  moderator: 'Модератор',
  user: '',
};

interface NameBadgesProps {
  role: UserRole;
  isVerified: boolean;
}

/**
 * Рисует справа от display_name две независимые пометки:
 * - кастомную галочку верификации (is_verified) — может быть у кого угодно
 * - иконку роли (role) — только у staff (developer/admin/moderator)
 */
export function NameBadges({ role, isVerified }: NameBadgesProps) {
  const roleIcon = ROLE_ICON[role];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4, verticalAlign: 'middle' }}>
      {isVerified && <VerifiedBadge size={15} />}
      {roleIcon && <span title={ROLE_TITLE[role]}>{roleIcon}</span>}
    </span>
  );
}
