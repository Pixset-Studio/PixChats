'use client';

import { useState } from 'react';
import type { MuteState } from '@pixchats/core';

interface MuteControlProps {
  muteState: MuteState | null;
  onMute: (hours?: number) => void;
  onUnmute: () => void;
}

/** Кнопка "Отключить уведомления" — при клике раскрывает выбор длительности. */
export function MuteControl({ muteState, onMute, onUnmute }: MuteControlProps) {
  const [expanded, setExpanded] = useState(false);

  if (muteState?.muted) {
    return (
      <button className="btn" onClick={onUnmute}>
        🔔 Включить уведомления
      </button>
    );
  }

  if (!expanded) {
    return (
      <button className="btn" onClick={() => setExpanded(true)}>
        🔕 Отключить уведомления
      </button>
    );
  }

  return (
    <>
      <button className="btn" onClick={() => onMute(1)}>
        На 1 час
      </button>
      <button className="btn" onClick={() => onMute(8)}>
        На 8 часов
      </button>
      <button className="btn" onClick={() => onMute()}>
        Навсегда
      </button>
      <button className="btn-ghost" onClick={() => setExpanded(false)}>
        Отмена
      </button>
    </>
  );
}
