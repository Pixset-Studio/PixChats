'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getCurrentProfile,
  getUserAllMutes,
  getUserPenaltyDetails,
  getMyAppeals,
  type Profile,
  type ChatMute,
  type AppealPenaltyType,
} from '@pixchats/core';
import { DesktopShell } from '../../components/DesktopShell';
import { Loading } from '../../components/Loading';
import { AppealModal } from '../../components/AppealModal';
import { isBanned } from '../../lib/ban';

interface MyAppealRow {
  id: string;
  penalty_type: AppealPenaltyType;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  admin_notes: string | null;
  created_at: string;
}

const PENALTY_LABELS: Record<AppealPenaltyType, string> = {
  mute: '🔇 Мут в чате',
  freeze: '❄️ Заморозка аккаунта',
  ban_account: '⛔ Блокировка аккаунта',
  ban_ip: '🌐 Блокировка по IP-адресу',
};

export default function AppealsPage() {
  const [me, setMe] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutes, setMutes] = useState<ChatMute[]>([]);
  const [penaltyDetails, setPenaltyDetails] = useState<{
    banReason: string | null;
    frozenReason: string | null;
    moderatorComment: string | null;
  }>({ banReason: null, frozenReason: null, moderatorComment: null });
  const [myAppeals, setMyAppeals] = useState<MyAppealRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const [activeModalPenalty, setActiveModalPenalty] = useState<{
    type: AppealPenaltyType;
    chatId?: string;
    chatTitle?: string;
    allowChangeType?: boolean;
  } | null>(null);

  async function loadData() {
    setLoading(true);
    try {
      const profile = await getCurrentProfile(true);
      setMe(profile);

      if (profile) {
        const [activeMutes, details, appealsList] = await Promise.all([
          getUserAllMutes(profile.id),
          getUserPenaltyDetails(profile.id, profile),
          getMyAppeals(profile.id),
        ]);
        setMutes(activeMutes);
        setPenaltyDetails(details);
        setMyAppeals((appealsList ?? []) as MyAppealRow[]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  if (loading) return <Loading />;

  const accountBanned = me ? isBanned(me) : false;

  const content = (
    <main className="container-narrow" style={{ paddingTop: 20, paddingBottom: 40 }}>
        <header className="app-header" style={{ marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 22, margin: 0 }}>
              ⚖️ Центр апелляций и обжалований
            </h1>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
              Раздел рассмотрения обращений по снятию мутов, заморозок и блокировок
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {me && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: 'auto', padding: '8px 14px', fontSize: 12.5 }}
                onClick={() =>
                  setActiveModalPenalty({
                    type: accountBanned ? 'ban_account' : me.frozen ? 'freeze' : 'mute',
                    allowChangeType: true,
                  })
                }
              >
                ➕ Подать апелляцию
              </button>
            )}
            <Link href={accountBanned ? '/banned' : '/chats'} className="btn btn-ghost" style={{ width: 'auto' }}>
              ← Назад
            </Link>
          </div>
        </header>

        {notice && <div className="notice" style={{ marginBottom: 16 }}>{notice}</div>}

        {me && (
          <>
            {/* Текущий статус аккаунта */}
            <section className="card" style={{ marginBottom: 20, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10, color: 'var(--accent)' }}>
                📌 Текущий статус вашего аккаунта и активные ограничения
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {accountBanned && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 12,
                      background: 'rgba(220, 38, 38, 0.14)',
                      border: '1px solid #ef4444',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 700, color: '#ef4444', fontSize: 14.5 }}>
                        ⛔ Ваш аккаунт заблокирован
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 4 }}>
                        <strong>Срок:</strong>{' '}
                        {me.banned_permanently
                          ? 'Навсегда (Бессрочно)'
                          : me.banned_until
                            ? `до ${new Date(me.banned_until).toLocaleString('ru-RU')}`
                            : 'Временно'}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2 }}>
                        <strong>Причина:</strong> {penaltyDetails.banReason || me.ban_reason || 'Нарушение правил сообщества PixChats'}
                      </div>
                      {(penaltyDetails.moderatorComment || me.moderator_comment) && (
                        <div style={{ fontSize: 12.5, color: 'var(--accent)', marginTop: 4 }}>
                          <strong>💬 Комментарий модератора:</strong> {penaltyDetails.moderatorComment || me.moderator_comment}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: 'auto', padding: '7px 14px', fontSize: 12 }}
                      onClick={() => setActiveModalPenalty({ type: 'ban_account' })}
                    >
                      ⚖️ Обжаловать блокировку
                    </button>
                  </div>
                )}

                {me.frozen && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '14px 16px',
                      borderRadius: 12,
                      background: 'rgba(56, 189, 248, 0.15)',
                      border: '1px solid #38bdf8',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: 14.5 }}>
                        ❄️ Ваш аккаунт заморожен
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        Вы можете читать сообщения, но отправка ограничена до решения модератора.
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 4 }}>
                        <strong>Причина заморозки:</strong>{' '}
                        {penaltyDetails.frozenReason || me.frozen_reason || 'Автоматическая защита / жалоба пользователей'}
                      </div>
                      {(penaltyDetails.moderatorComment || me.moderator_comment) && (
                        <div style={{ fontSize: 12.5, color: 'var(--accent)', marginTop: 4 }}>
                          <strong>💬 Комментарий модератора:</strong> {penaltyDetails.moderatorComment || me.moderator_comment}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ width: 'auto', padding: '7px 14px', fontSize: 12 }}
                      onClick={() => setActiveModalPenalty({ type: 'freeze' })}
                    >
                      ⚖️ Обжаловать заморозку
                    </button>
                  </div>
                )}

                {mutes.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>Ограничения в чатах (Муты):</div>
                    {mutes.map((mute) => (
                      <div
                        key={mute.id}
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: '12px 14px',
                          borderRadius: 10,
                          background: 'rgba(245, 158, 11, 0.12)',
                          border: '1px solid var(--accent)',
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 200 }}>
                          <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                            🔇 {mute.chat_title || 'Чат'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 3 }}>
                            <strong>Причина:</strong> {mute.reason || 'Нарушение правил чата'} ·{' '}
                            <strong>Срок:</strong>{' '}
                            {mute.muted_until
                              ? `до ${new Date(mute.muted_until).toLocaleString('ru-RU')}`
                              : 'бессрочно'}
                          </div>
                          {mute.moderator_comment && (
                            <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 3 }}>
                              <strong>💬 Комментарий модератора:</strong> {mute.moderator_comment}
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="btn"
                          style={{ width: 'auto', padding: '6px 12px', fontSize: 12 }}
                          onClick={() =>
                            setActiveModalPenalty({
                              type: 'mute',
                              chatId: mute.chat_id,
                              chatTitle: mute.chat_title,
                            })
                          }
                        >
                          ⚖️ Обжаловать мут
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!accountBanned && !me.frozen && mutes.length === 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <div style={{ color: '#22c55e', fontWeight: 600, fontSize: 13.5 }}>
                      ✅ У вас нет активных ограничений, мутов или блокировок!
                    </div>
                    <button
                      type="button"
                      className="btn"
                      style={{ width: 'auto', fontSize: 12, padding: '6px 12px' }}
                      onClick={() => setActiveModalPenalty({ type: 'mute', allowChangeType: true })}
                    >
                      ⚖️ Написать обращение в модерацию
                    </button>
                  </div>
                )}
              </div>
            </section>

            {/* История ваших апелляций */}
            <section className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12, color: 'var(--accent)' }}>
                📋 Ваши отправленные апелляции ({myAppeals.length})
              </div>

              {myAppeals.length === 0 ? (
                <div className="empty-state">Вы ещё не отправляли апелляций</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {myAppeals.map((item) => (
                    <div
                      key={item.id}
                      style={{
                        padding: 12,
                        borderRadius: 12,
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                          {PENALTY_LABELS[item.penalty_type] || item.penalty_type}
                        </span>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background:
                              item.status === 'approved'
                                ? 'rgba(34, 197, 94, 0.2)'
                                : item.status === 'rejected'
                                ? 'rgba(239, 68, 68, 0.2)'
                                : 'rgba(245, 158, 11, 0.2)',
                            color:
                              item.status === 'approved'
                                ? '#22c55e'
                                : item.status === 'rejected'
                                ? '#ef4444'
                                : 'var(--accent)',
                          }}
                        >
                          {item.status === 'approved'
                            ? '✅ Одобрено (Наказание снято)'
                            : item.status === 'rejected'
                            ? '❌ Отклонено'
                            : '⏳ На рассмотрении'}
                        </span>
                      </div>

                      <div style={{ fontSize: 12.5, color: 'var(--text)' }}>
                        <strong>Ваше объяснение:</strong> «{item.reason}»
                      </div>

                      {item.admin_notes && (
                        <div
                          style={{
                            fontSize: 12.5,
                            color: 'var(--accent)',
                            marginTop: 2,
                            padding: '6px 10px',
                            borderRadius: 8,
                            background: 'rgba(255, 212, 0, 0.08)',
                            border: '1px solid rgba(255, 212, 0, 0.25)',
                          }}
                        >
                          <strong>💬 Ответ / комментарий модератора:</strong> {item.admin_notes}
                        </div>
                      )}

                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        Подано: {new Date(item.created_at).toLocaleString('ru-RU')}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {activeModalPenalty && me && (
          <AppealModal
            userId={me.id}
            penaltyType={activeModalPenalty.type}
            chatId={activeModalPenalty.chatId}
            chatTitle={activeModalPenalty.chatTitle}
            allowChangeType={activeModalPenalty.allowChangeType}
            onClose={() => setActiveModalPenalty(null)}
            onAppealSubmitted={() => {
              setNotice('⚖️ Апелляция успешно отправлена модераторам');
              void loadData();
              setTimeout(() => setNotice(null), 4000);
            }}
          />
        )}
      </main>
  );

  if (accountBanned) return content;
  return <DesktopShell>{content}</DesktopShell>;
}


