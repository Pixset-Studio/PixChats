'use client';

import React from 'react';

export interface ReadStatusTicksProps {
  status: 'sent' | 'read'; // 'sent' = 1 tick, 'read' = 2 ticks
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  color?: string;
}

/**
 * Векторные стилизованные галочки статуса прочтения (Telegram / WhatsApp style).
 * Одинарная галочка для доставленных ('sent') и двойная параллельная для прочитанных ('read').
 */
export function ReadStatusTicks({
  status,
  size = 14,
  className = '',
  style,
  color,
}: ReadStatusTicksProps) {
  const isRead = status === 'read';
  const strokeColor = color ?? (isRead ? 'var(--accent)' : 'var(--text-muted)');

  if (!isRead) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
        aria-label="Отправлено"
      >
        <path
          d="M3.2 8.2L6.2 11.2L12.8 4.6"
          stroke={strokeColor}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg
      width={Math.round(size * 1.35)}
      height={size}
      viewBox="0 0 21 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style }}
      aria-label="Прочитано"
    >
      <path
        d="M2.2 8.2L5.2 11.2L11.8 4.6"
        stroke={strokeColor}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M7.2 8.2L10.2 11.2L16.8 4.6"
        stroke={strokeColor}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
