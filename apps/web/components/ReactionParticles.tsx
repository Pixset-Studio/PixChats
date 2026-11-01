'use client';

import React, { useEffect, useState } from 'react';

export interface ParticleItem {
  id: string;
  emoji: string;
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

export function ReactionParticles({
  emoji,
  active,
  onComplete,
}: {
  emoji: string;
  active: boolean;
  onComplete?: () => void;
}) {
  const [particles, setParticles] = useState<ParticleItem[]>([]);

  useEffect(() => {
    if (!active || !emoji) return;

    const list: ParticleItem[] = [];
    const count = 7;

    for (let i = 0; i < count; i++) {
      list.push({
        id: `p-${i}-${Math.random()}`,
        emoji,
        x: (Math.random() - 0.5) * 60,
        y: -20 - Math.random() * 50,
        rotation: (Math.random() - 0.5) * 45,
        scale: 0.8 + Math.random() * 0.5,
      });
    }

    setParticles(list);

    const timer = setTimeout(() => {
      setParticles([]);
      onComplete?.();
    }, 900);

    return () => clearTimeout(timer);
  }, [active, emoji]);

  if (particles.length === 0) return null;

  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1000, overflow: 'visible' }}>
      {particles.map((p) => (
        <span
          key={p.id}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            fontSize: 20,
            transform: `translate(${p.x}px, ${p.y}px) rotate(${p.rotation}deg) scale(${p.scale})`,
            animation: 'particleBurst 0.9s cubic-bezier(0.16, 1, 0.3, 1) forwards',
            userSelect: 'none',
          }}
        >
          {p.emoji}
        </span>
      ))}
    </div>
  );
}
