'use client';

import React from 'react';

export interface AvatarWithStatusProps {
  avatarUrl?: string | null;
  name: string;
  size?: number;
  isSaved?: boolean;
  statusType?: 'online' | 'live' | 'incall' | 'none';
  style?: React.CSSProperties;
  className?: string;
}

export function AvatarWithStatus({
  avatarUrl,
  name,
  size = 40,
  isSaved = false,
  statusType = 'none',
  style,
  className = '',
}: AvatarWithStatusProps) {
  const fallbackChar = isSaved ? '⭐' : (name || '?').replace('🔊 ', '').slice(0, 1).toUpperCase();

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-block',
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    >
      <div
        className={`avatar ${!avatarUrl ? 'avatar-fallback' : ''} ${className}`}
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.42),
          backgroundImage: avatarUrl ? `url(${avatarUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          borderRadius: '50%',
        }}
      >
        {!avatarUrl && fallbackChar}
      </div>

      {/* 1. Синий кружок с трубкой "В звонке" */}
      {statusType === 'incall' && (
        <span
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: Math.max(14, Math.round(size * 0.38)),
            height: Math.max(14, Math.round(size * 0.38)),
            borderRadius: '50%',
            background: '#2563eb',
            color: '#ffffff',
            fontSize: Math.max(9, Math.round(size * 0.22)),
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '2px solid var(--surface)',
            boxShadow: '0 2px 6px rgba(0,0,0,0.5)',
            zIndex: 10,
          }}
          title="В звонке с вами 📞"
        >
          📞
        </span>
      )}

      {/* 2. Красный пульсирующий кружок "Прямой эфир" для каналов */}
      {statusType === 'live' && (
        <span
          className="online-dot-glow"
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: Math.max(11, Math.round(size * 0.3)),
            height: Math.max(11, Math.round(size * 0.3)),
            borderRadius: '50%',
            background: 'var(--danger)',
            border: '2px solid var(--surface)',
            boxShadow: '0 0 10px var(--danger)',
            zIndex: 10,
          }}
          title="Идёт прямой эфир 🔴"
        />
      )}

      {/* 3. Зеленый кружок "В сети" для пользователей */}
      {statusType === 'online' && (
        <span
          style={{
            position: 'absolute',
            bottom: 0,
            right: 0,
            width: Math.max(11, Math.round(size * 0.3)),
            height: Math.max(11, Math.round(size * 0.3)),
            borderRadius: '50%',
            background: 'var(--success)',
            border: '2px solid var(--surface)',
            boxShadow: '0 0 8px rgba(34, 197, 94, 0.4)',
            zIndex: 10,
          }}
          title="В сети 🟢"
        />
      )}
    </div>
  );
}
