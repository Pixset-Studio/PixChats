'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getCurrentProfile, getUserPenaltyDetails, hasActiveSession, signOut, type Profile } from '@pixchats/core';
import { isBanned } from '../../lib/ban';
import { clearChatListCache } from '../../lib/chatListCache';
import { AppealModal } from '../../components/AppealModal';

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
  const [me, setMe] = useState<Profile | null>(null);
  const [permanent, setPermanent] = useState(false);
  const [bannedUntil, setBannedUntil] = useState<Date | null>(null);
  const [banReason, setBanReason] = useState<string | null>(null);
  const [moderatorComment, setModeratorComment] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [checked, setChecked] = useState(false);
  const [showAppealModal, setShowAppealModal] = useState(false);
  const [appealNotice, setAppealNotice] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login');
        return;
      }
      const profile = await getCurrentProfile(true);
      if (!profile) {
        router.push('/login');
        return;
      }
      if (!isBanned(profile)) {
        router.push('/chats');
        return;
      }
      setMe(profile);
      setPermanent(profile.banned_permanently);
      const untilDate = profile.banned_until ? new Date(profile.banned_until) : null;
      setBannedUntil(untilDate);
      if (untilDate) {
        setRemaining(Math.max(0, untilDate.getTime() - Date.now()));
      }

      const details = await getUserPenaltyDetails(profile.id, profile);
      setBanReason(details.banReason || profile.ban_reason || null);
      setModeratorComment(details.moderatorComment || profile.moderator_comment || null);
      setChecked(true);
    })();
  }, [router]);

  // Обратный отсчёт + экономная проверка раз в 60 секунд
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

    const recheck = setInterval(async () => {
      const profile = await getCurrentProfile(true);
      if (profile && !isBanned(profile)) {
        router.push('/chats');
      }
    }, 60000);

    return () => {
      clearInterval(tick);
      clearInterval(recheck);
    };
  }, [checked, permanent, bannedUntil, router]);

  if (!checked) return null;

  return (
    <main className="page-center">
      <div className="container-narrow card" style={{ textAlign: 'center', maxWidth: 500 }}>
        <h1 style={{ fontFamily: 'var(--font-display)', color: 'var(--danger)', marginBottom: 8 }}>
          ⛔ Аккаунт заблокирован
        </h1>

        {appealNotice && (
          <div className="notice" style={{ marginBottom: 14 }}>
            {appealNotice}
          </div>
        )}

        <div
          style={{
            textAlign: 'left',
            padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            marginBottom: 16,
            fontSize: 13.5,
          }}
        >
          <div style={{ marginBottom: 6 }}>
            <strong>Причина блокировки:</strong>{' '}
            <span style={{ color: 'var(--text)' }}>
              {banReason || 'Нарушение правил сообщества PixChats'}
            </span>
          </div>
          {moderatorComment && (
            <div style={{ color: 'var(--accent)', marginTop: 6 }}>
              <strong>💬 Комментарий модератора:</strong> {moderatorComment}
            </div>
          )}
          {!permanent && bannedUntil && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: 'var(--text-muted)' }}>
              <strong>Действует до:</strong> {bannedUntil.toLocaleString('ru-RU')}
            </div>
          )}
        </div>

        {permanent ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 13.5 }}>
            Ваш аккаунт заблокирован администрацией PixChats навсегда. Если вы считаете, что произошла ошибка — подайте апелляцию ниже.
          </p>
        ) : (
          <>
            <p style={{ color: 'var(--text-muted)', margin: '4px 0' }}>До разблокировки осталось:</p>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, color: 'var(--accent)', margin: '10px 0' }}>
              {formatRemaining(remaining)}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>
              По истечении срока доступ к приложению восстановится автоматически.
            </p>
          </>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginTop: 20 }}>
          {me && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => setShowAppealModal(true)}
            >
              ⚖️ Подать апелляцию
            </button>
          )}
          <Link href="/appeals" className="btn" style={{ width: 'auto', textDecoration: 'none' }}>
            📋 Мои апелляции
          </Link>
          <button
            className="btn"
            style={{ width: 'auto' }}
            onClick={async () => {
              clearChatListCache();
              await signOut();
              router.push('/login');
            }}
          >
            Выйти из аккаунта
          </button>
        </div>

        {showAppealModal && me && (
          <AppealModal
            userId={me.id}
            penaltyType="ban_account"
            onClose={() => setShowAppealModal(false)}
            onAppealSubmitted={() => {
              setAppealNotice('⚖️ Ваша апелляция отправлена на рассмотрение модераторам!');
            }}
          />
        )}
      </div>
    </main>
  );
}

