'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCurrentProfile, hasActiveSession, signOut } from '@pixchats/core';
import { isBanned } from '../../lib/ban';

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0с';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (days) parts.push(`${days}д`);
  if (hours || days) parts.push(`${hours}ч`);
  if (minutes || hours || days) parts.push(`${minutes}м`);
  parts.push(`${seconds}с`);
  return parts.join(' ');
}

export default function BannedPage() {
  const router = useRouter();
  const [permanent, setPermanent] = useState(false);
  const [bannedUntil, setBannedUntil] = useState<Date | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login');
        return;
      }
      const profile = await getCurrentProfile();
      if (!profile) {
        router.push('/login');
        return;
      }
      // Если бана нет (или его уже сняли) — на эту страницу заходить нельзя, отправляем обратно.
      if (!isBanned(profile)) {
        router.push('/chats');
        return;
      }
      setPermanent(profile.banned_permanently);
      setBannedUntil(profile.banned_until ? new Date(profile.banned_until) : null);
      setChecked(true);
    })();
  }, [router]);

  // Обратный отсчёт + периодическая проверка на случай досрочного снятия бана администратором
  useEffect(() => {
    if (!checked || permanent || !bannedUntil) return;

    const tick = setInterval(() => {
      const diff = bannedUntil.getTime() - Date.now();
      setRemaining(diff);
      if (diff <= 0) {
        clearInterval(tick);
        router.push('/chats');
      }
    }, 1000);

    // Досрочная проверка на сервере раз в 15 секунд — вдруг администратор снял бан вручную раньше срока
    const recheck = setInterval(async () => {
      const profile = await getCurrentProfile();
      if (profile && !isBanned(profile)) {
        router.push('/chats');
      }
    }, 15000);

    return () => {
      clearInterval(tick);
      clearInterval(recheck);
    };
  }, [checked, permanent, bannedUntil, router]);

  if (!checked) return null;

  return (
    <main className="page-center">
      <div className="container-narrow card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--danger)' }}>Аккаунт заблокирован</h1>

        {permanent ? (
          <p style={{ color: 'var(--text-muted)' }}>
            Ваш аккаунт заблокирован администрацией PixChats навсегда. Если считаете, что это ошибка — обратитесь в
            поддержку.
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)' }}>Ваш аккаунт временно заблокирован. Осталось:</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--accent)', margin: '12px 0' }}>
              {formatRemaining(remaining)}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              По истечении срока вы будете автоматически возвращены в приложение.
            </p>
          </>
        )}

        <button
          className="btn"
          style={{ width: 'auto', marginTop: 16 }}
          onClick={async () => {
            await signOut();
            router.push('/login');
          }}
        >
          Выйти из аккаунта
        </button>
      </div>
    </main>
  );
}
