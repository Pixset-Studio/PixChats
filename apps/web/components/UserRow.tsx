import type { Profile } from '@pixchats/core';
import { NameBadges } from './NameBadges';
import { formatLastSeen } from '../lib/lastSeen';

interface UserRowProps {
  profile: Profile;
  action?: React.ReactNode;
}

/** Аватар слева, отображаемое имя + (username) сверху, время последнего захода снизу — как в Telegram. */
export function UserRow({ profile, action }: UserRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div
        className="avatar"
        style={{
          width: 44,
          height: 44,
          fontSize: 16,
          flexShrink: 0,
          backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {profile.display_name} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(@{profile.username})</span>
          <NameBadges role={profile.role} isVerified={profile.is_verified} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatLastSeen(profile)}</div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}
