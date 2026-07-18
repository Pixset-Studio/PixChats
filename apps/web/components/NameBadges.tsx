import type { UserRole } from '@pixchats/core';
import { VerifiedBadge } from './VerifiedBadge';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

const ROLE_ICON: Record<UserRole, string | null> = {
  developer: `${BASE_PATH}/badges/developer.png`, // зелёный значок кода
  admin: `${BASE_PATH}/badges/shield.png`,
  moderator: `${BASE_PATH}/badges/shield.png`,
  partner: `${BASE_PATH}/badges/partner.png`,
  user: null,
};

const ROLE_TITLE: Record<UserRole, string> = {
  developer: 'Разработчик PixChats',
  admin: 'Администратор',
  moderator: 'Модератор',
  partner: 'Партнёр',
  user: '',
};

interface NameBadgesProps {
  role: UserRole;
  isVerified: boolean;
}

/**
 * Рисует справа от display_name две независимые пометки:
 * - кастомную галочку верификации (is_verified) — может быть у кого угодно
 * - иконку роли (role) — только у developer/admin/moderator/partner
 */
export function NameBadges({ role, isVerified }: NameBadgesProps) {
  const roleIcon = ROLE_ICON[role];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4, verticalAlign: 'middle' }}>
      {isVerified && <VerifiedBadge size={15} />}
      {roleIcon && (
        <img src={roleIcon} alt={ROLE_TITLE[role]} title={ROLE_TITLE[role]} width={15} height={15} style={{ display: 'inline-block' }} />
      )}
    </span>
  );
}
