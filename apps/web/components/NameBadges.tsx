import type { UserRole } from '@pixchats/core';
import { VerifiedBadge } from './VerifiedBadge';

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || '';

const ROLE_ICON: Record<UserRole, string | null> = {
  developer: `${BASE_PATH}/badges/developer.png`,
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

interface NameWithBadgesProps {
  name: string;
  role: UserRole;
  isVerified: boolean;
  isPixsetEmployee?: boolean;
}

/**
 * Порядок пометок: [значок роли] [значок сотрудника Pixset] Имя [галочка верификации].
 * Значок роли и "сотрудник" — ВСЕГДА спереди, если применимо; галочка — всегда в конце.
 */
export function NameWithBadges({ name, role, isVerified, isPixsetEmployee }: NameWithBadgesProps) {
  const roleIcon = ROLE_ICON[role];

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, verticalAlign: 'middle' }}>
      {roleIcon && (
        <img src={roleIcon} alt={ROLE_TITLE[role]} title={ROLE_TITLE[role]} width={15} height={15} />
      )}
      {isPixsetEmployee && (
        <img
          src={`${BASE_PATH}/badges/employee.png`}
          alt="Сотрудник Pixset Studio"
          title="Сотрудник Pixset Studio"
          width={15}
          height={15}
        />
      )}
      <span>{name}</span>
      {isVerified && <VerifiedBadge size={15} style={{ marginLeft: 0 }} />}
    </span>
  );
}

/** @deprecated используйте NameWithBadges — оставлено для обратной совместимости старых мест вызова. */
export function NameBadges({ role, isVerified }: { role: UserRole; isVerified: boolean }) {
  const roleIcon = ROLE_ICON[role];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 4, verticalAlign: 'middle' }}>
      {isVerified && <VerifiedBadge size={15} />}
      {roleIcon && <img src={roleIcon} alt={ROLE_TITLE[role]} title={ROLE_TITLE[role]} width={15} height={15} />}
    </span>
  );
}
