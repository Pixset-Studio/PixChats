'use client';

import React, { useState } from 'react';

export interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  wrapperStyle?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
  defaultVisible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}

export function EyeIcon({ open, size = 18 }: { open: boolean; size?: number }) {
  if (open) {
    // Глаз открыт (текст виден)
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  // Глаз перечёркнут (скрыто под точками)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

/**
 * Поле ввода пароля / PIN-кода / секретного ключа с кнопкой-глазиком
 * для переключения видимости символов, скрытых под точками.
 */
export function PasswordInput({
  className = 'input',
  style,
  wrapperStyle,
  buttonStyle,
  defaultVisible = false,
  onVisibilityChange,
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(defaultVisible);

  const toggle = () => {
    const next = !visible;
    setVisible(next);
    onVisibilityChange?.(next);
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        ...wrapperStyle,
      }}
    >
      <input
        {...rest}
        type={visible ? 'text' : 'password'}
        className={className}
        style={{
          width: '100%',
          paddingRight: 42,
          ...style,
        }}
      />
      <button
        type="button"
        onClick={toggle}
        tabIndex={-1}
        title={visible ? 'Скрыть под точками' : 'Показать скрытый текст'}
        aria-label={visible ? 'Скрыть под точками' : 'Показать скрытый текст'}
        style={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 30,
          height: 30,
          borderRadius: 8,
          border: 'none',
          background: 'transparent',
          color: visible ? 'var(--accent)' : 'var(--text-muted)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: 0,
          transition: 'color 0.15s ease, background 0.15s ease',
          ...buttonStyle,
        }}
      >
        <EyeIcon open={visible} size={18} />
      </button>
    </div>
  );
}
