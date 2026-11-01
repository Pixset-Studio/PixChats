'use client';

import React, { useEffect, useState } from 'react';
import {
  getAppLockConfig,
  isSessionUnlocked,
  verifyAndUnlockSession,
  lockSessionNow,
} from '../lib/appLock';

export function AppLockGuard() {
  const [locked, setLocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [errorShake, setErrorShake] = useState(false);

  useEffect(() => {
    const syncLockState = () => {
      const cfg = getAppLockConfig();
      if (!cfg.enabled || !cfg.pinCode) {
        setLocked(false);
        return;
      }
      setLocked(!isSessionUnlocked());
    };

    syncLockState();
    window.addEventListener('pixchats:applock_changed', syncLockState);
    window.addEventListener('storage', syncLockState);

    return () => {
      window.removeEventListener('pixchats:applock_changed', syncLockState);
      window.removeEventListener('storage', syncLockState);
    };
  }, []);

  // Автоблокировка при бездействии (если задан таймер autoLockMinutes > 0)
  useEffect(() => {
    const cfg = getAppLockConfig();
    if (!cfg.enabled || !cfg.pinCode || !cfg.autoLockMinutes || locked) return;

    let idleTimer: any = null;
    const resetTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        lockSessionNow();
      }, cfg.autoLockMinutes * 60 * 1000);
    };

    resetTimer();
    const events = ['pointerdown', 'keydown', 'touchstart', 'mousemove'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [locked]);

  function handleAppendDigit(digit: string) {
    const cfg = getAppLockConfig();
    const next = (pinInput + digit).slice(0, 8);
    setPinInput(next);

    if (next.length >= cfg.pinCode.length) {
      if (verifyAndUnlockSession(next)) {
        setPinInput('');
        setLocked(false);
      } else if (next.length >= cfg.pinCode.length) {
        setErrorShake(true);
        setTimeout(() => {
          setPinInput('');
          setErrorShake(false);
        }, 450);
      }
    }
  }

  function handleSubmitForm(e: React.FormEvent) {
    e.preventDefault();
    if (verifyAndUnlockSession(pinInput)) {
      setPinInput('');
      setLocked(false);
    } else {
      setErrorShake(true);
      setTimeout(() => {
        setPinInput('');
        setErrorShake(false);
      }, 450);
    }
  }

  if (!locked) return null;

  const cfg = getAppLockConfig();
  const targetLen = Math.max(4, cfg.pinCode.length || 4);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        background: 'rgba(9, 9, 11, 0.98)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: 340,
          width: '100%',
          textAlign: 'center',
          padding: '28px 24px',
          border: `1.5px solid ${errorShake ? 'var(--danger)' : 'var(--accent)'}`,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: 'var(--accent)',
              color: '#000',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 26,
              fontWeight: 800,
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}
          >
            🔒
          </div>
        </div>

        <h3 style={{ margin: '0 0 6px', fontSize: 19, fontFamily: 'var(--font-display)' }}>
          🔐 PixChats защищён
        </h3>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--text-muted)' }}>
          Введите ваш PIN-код для доступа к чатам
        </p>

        {/* Точки введённого PIN */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 20 }}>
          {Array.from({ length: targetLen }).map((_, idx) => {
            const filled = idx < pinInput.length;
            return (
              <span
                key={idx}
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: filled ? (errorShake ? 'var(--danger)' : 'var(--accent)') : 'transparent',
                  border: `2px solid ${
                    errorShake ? 'var(--danger)' : filled ? 'var(--accent)' : 'var(--border)'
                  }`,
                  transition: 'all 0.15s ease',
                }}
              />
            );
          })}
        </div>

        <form onSubmit={handleSubmitForm} style={{ marginBottom: 14 }}>
          <input
            type="password"
            className="input"
            value={pinInput}
            onChange={(e) => {
              const val = e.target.value;
              setPinInput(val);
              if (val.length >= targetLen && verifyAndUnlockSession(val)) {
                setPinInput('');
                setLocked(false);
              }
            }}
            placeholder="Введите PIN-код…"
            style={{ textAlign: 'center', letterSpacing: 6, fontSize: 16 }}
            autoFocus
          />
        </form>

        {/* Цифровая клавиатура */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
          }}
        >
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <button
              key={digit}
              type="button"
              className="btn"
              style={{
                height: 46,
                fontSize: 18,
                fontWeight: 700,
                justifyContent: 'center',
              }}
              onClick={() => handleAppendDigit(digit)}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className="btn"
            style={{ height: 46, fontSize: 13, justifyContent: 'center', color: 'var(--text-muted)' }}
            onClick={() => setPinInput('')}
          >
            Сброс
          </button>
          <button
            type="button"
            className="btn"
            style={{ height: 46, fontSize: 18, fontWeight: 700, justifyContent: 'center' }}
            onClick={() => handleAppendDigit('0')}
          >
            0
          </button>
          <button
            type="button"
            className="btn"
            style={{ height: 46, fontSize: 16, justifyContent: 'center' }}
            onClick={() => setPinInput((p) => p.slice(0, -1))}
          >
            ⌫
          </button>
        </div>
      </div>
    </div>
  );
}
