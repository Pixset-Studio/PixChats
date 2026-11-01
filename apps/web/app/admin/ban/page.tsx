'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getSupabaseClient,
  banAccount,
  banIpAddress,
  type Profile,
} from '@pixchats/core';
import { DesktopShell } from '../../../components/DesktopShell';
import { NameWithBadges } from '../../../components/NameBadges';
import { Loading } from '../../../components/Loading';

const BAN_PRESET_REASONS = [
  '🚨 Спам, массовая рассылка или фишинг',
  '🤬 Оскорбления, буллинг или травля',
  '💸 Мошенничество или вымогательство',
  '⚠️ Нарушение законодательства / вредоносный контент',
  '🔓 Попытка взлома или использование читов/скриптов',
  '💬 Систематическое нарушение правил PixChats',
];

const DURATION_PRESETS = [
  { label: '1 час', days: 1 / 24 },
  { label: '12 часов', days: 0.5 },
  { label: '24 часа (1 день)', days: 1 },
  { label: '3 дня', days: 3 },
  { label: '7 дней', days: 7 },
  { label: '30 дней', days: 30 },
  { label: '90 дней', days: 90 },
  { label: 'Навсегда', days: 'forever' as const },
];

function BanConfigInner() {
  const searchParams = useSearchParams();
  const targetUserId = searchParams.get('id') ?? '';
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [targetUser, setTargetUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  // Настройки бана
  const [banAccountType, setBanAccountType] = useState(true);
  const [banIpType, setBanIpType] = useState(false);
  const [ipAddress, setIpAddress] = useState('');
  const [reason, setReason] = useState(BAN_PRESET_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [selectedDuration, setSelectedDuration] = useState<number | 'forever'>(7);
  const [customDays, setCustomDays] = useState('');
  const [useCustomDuration, setUseCustomDuration] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const profile = await getCurrentProfile();
      if (!profile || (profile.role !== 'admin' && profile.role !== 'developer')) {
        router.push('/chats');
        return;
      }
      setMe(profile);

      if (targetUserId) {
        const supabase = getSupabaseClient();
        const { data: userRow } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', targetUserId)
          .maybeSingle();

        if (userRow) {
          setTargetUser(userRow as Profile);
          if (userRow.last_ip) {
            setIpAddress(userRow.last_ip);
          }
        }
      }
      setLoading(false);
    })();
  }, [targetUserId, router]);

  async function handleSubmitBan(e: React.FormEvent) {
    e.preventDefault();
    if (!me || (!targetUser && !targetUserId)) return;
    if (!banAccountType && !banIpType) {
      setError('Выберите хотя бы один тип бана (по аккаунту или по IP)');
      return;
    }

    const finalReason = customReason.trim() ? `${reason} (${customReason.trim()})` : reason;

    let finalDays: number | 'forever' = selectedDuration;
    if (useCustomDuration) {
      const parsed = parseFloat(customDays);
      if (isNaN(parsed) || parsed <= 0) {
        setError('Укажите корректный срок бана в днях');
        return;
      }
      finalDays = parsed;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (banAccountType && targetUserId) {
        await banAccount(
          targetUserId,
          finalDays === 'forever' ? { permanent: true } : { durationDays: finalDays },
          me
        );
      }

      if (banIpType) {
        const ipToBan = ipAddress.trim() || targetUser?.last_ip || '127.0.0.1';
        await banIpAddress(ipToBan, finalReason, me);
      }

      router.push('/admin?tab=users');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось выдать бан');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading />;
  if (!me) return null;

  return (
    <main className="container-narrow" style={{ paddingTop: 20, paddingBottom: 40 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/admin?tab=users" className="btn btn-ghost" style={{ width: 'auto' }}>
          ← Назад в Админ-панель
        </Link>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Модератор: <strong style={{ color: 'var(--accent)' }}>@{me.username}</strong>
        </span>
      </div>

      <div className="card" style={{ padding: 24, borderRadius: 20, boxShadow: '0 16px 48px rgba(0,0,0,0.6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: '50%',
              background: '#dc2626',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
              fontSize: 24,
              fontWeight: 800,
            }}
          >
            ⛔
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontFamily: 'var(--font-display)' }}>
              Настройка блокировки (Бана)
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Конфигурация ограничений аккаунта и IP-адреса
            </p>
          </div>
        </div>

        {targetUser ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: 14,
              borderRadius: 14,
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              marginBottom: 20,
            }}
          >
            <div
              className={`avatar ${!targetUser.avatar_url ? 'avatar-fallback' : ''}`}
              style={{
                width: 48,
                height: 48,
                fontSize: 18,
                backgroundImage: targetUser.avatar_url ? `url(${targetUser.avatar_url})` : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              {!targetUser.avatar_url && targetUser.display_name.slice(0, 1).toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>
                <NameWithBadges
                  name={targetUser.display_name}
                  role={targetUser.role}
                  isVerified={targetUser.is_verified}
                  isPixsetEmployee={targetUser.is_pixset_employee}
                  isFrozen={targetUser.frozen}
                />
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                @{targetUser.username} · ID: {targetUser.id}
                {targetUser.last_ip && ` · IP: ${targetUser.last_ip}`}
              </div>
            </div>
          </div>
        ) : (
          <div className="field" style={{ marginBottom: 20 }}>
            <label>ID целевого пользователя</label>
            <input className="input" value={targetUserId} disabled placeholder="ID пользователя" />
          </div>
        )}

        <form onSubmit={handleSubmitBan}>
          {/* Тип блокировки */}
          <div className="field" style={{ marginBottom: 20 }}>
            <label style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'block' }}>
              1. Выберите тип блокировки
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: banAccountType ? 'rgba(220, 38, 38, 0.15)' : 'var(--bg)',
                  border: banAccountType ? '2px solid #ef4444' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={banAccountType}
                  onChange={(e) => setBanAccountType(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>👤 Бан по аккаунту</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Запрещает вход под этим ID</div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: banIpType ? 'rgba(220, 38, 38, 0.15)' : 'var(--bg)',
                  border: banIpType ? '2px solid #ef4444' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={banIpType}
                  onChange={(e) => setBanIpType(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>🌐 Бан по IP-адресу</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Запрещает доступ с данного IP</div>
                </div>
              </label>
            </div>
          </div>

          {banIpType && (
            <div className="field" style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>IP-адрес для блокировки</label>
              <input
                type="text"
                className="input"
                value={ipAddress}
                onChange={(e) => setIpAddress(e.target.value)}
                placeholder="Например: 192.168.1.1 или 2001:db8::1"
                required={banIpType}
              />
            </div>
          )}

          {/* Причина бана */}
          <div className="field" style={{ marginBottom: 20 }}>
            <label style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'block' }}>
              2. Причина блокировки
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {BAN_PRESET_REASONS.map((r) => (
                <label
                  key={r}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: reason === r ? 'var(--surface-raised)' : 'transparent',
                    border: reason === r ? '1px solid var(--accent)' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="ban_reason"
                    checked={reason === r}
                    onChange={() => setReason(r)}
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>

            <textarea
              className="input"
              rows={2}
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder="Дополнительные примечания админа (необязательно)..."
              style={{ resize: 'vertical', fontSize: 13 }}
            />
          </div>

          {/* Срок бана */}
          <div className="field" style={{ marginBottom: 24 }}>
            <label style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'block' }}>
              3. Срок блокировки
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 6, marginBottom: 10 }}>
              {DURATION_PRESETS.map((p) => {
                const isActive = !useCustomDuration && selectedDuration === p.days;
                return (
                  <button
                    key={p.label}
                    type="button"
                    className="btn"
                    style={{
                      fontSize: 12,
                      borderColor: isActive ? '#ef4444' : undefined,
                      color: isActive ? '#ef4444' : undefined,
                      background: isActive ? 'rgba(239, 68, 68, 0.15)' : undefined,
                      fontWeight: isActive ? 700 : 400,
                    }}
                    onClick={() => {
                      setUseCustomDuration(false);
                      setSelectedDuration(p.days);
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                className="btn"
                style={{
                  width: 'auto',
                  fontSize: 12,
                  borderColor: useCustomDuration ? '#ef4444' : undefined,
                }}
                onClick={() => setUseCustomDuration(true)}
              >
                ✏️ Свой срок (в днях)
              </button>
              {useCustomDuration && (
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  className="input"
                  style={{ width: 140, fontSize: 13 }}
                  placeholder="Дней (напр. 0.5)"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  autoFocus
                />
              )}
            </div>
          </div>

          {error && (
            <div className="error" style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10 }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Link href="/admin?tab=users" className="btn" style={{ width: 'auto', padding: '10px 18px' }}>
              Отмена
            </Link>
            <button
              type="submit"
              className="btn"
              style={{
                width: 'auto',
                padding: '10px 24px',
                background: '#dc2626',
                borderColor: '#ef4444',
                color: '#fff',
                fontWeight: 700,
              }}
              disabled={submitting}
            >
              {submitting ? 'Применяем бан…' : '⛔ Подтвердить и выдать бан'}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

export default function BanConfigPage() {
  return (
    <DesktopShell>
      <Suspense fallback={<Loading />}>
        <BanConfigInner />
      </Suspense>
    </DesktopShell>
  );
}
