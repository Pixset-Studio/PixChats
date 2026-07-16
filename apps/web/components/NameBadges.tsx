import type { UserRole } from '@pixchats/core';

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
 * - синюю галочку верификации (is_verified) — может быть у кого угодно
 * - иконку роли (role) — только у staff (developer/admin/moderator)
 */
export function NameBadges({ role, isVerified }: NameBadgesProps) {
  const roleIcon = ROLE_ICON[role];

  return (
    <span style={{ display: 'inline-flex', gap: 5, marginLeft: 6, verticalAlign: 'middle' }}>
      {isVerified && (
        <span title="Верифицирован" className="badge-check">
          ✔
        </span>
      )}
      {roleIcon && <span title={ROLE_TITLE[role]}>{roleIcon}</span>}
    </span>
  );
}
