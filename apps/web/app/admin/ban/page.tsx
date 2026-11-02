'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getSupabaseClient,
  banAccount,
  banIpAddress,
  muteUserInChat,
  computePenaltyExpirationIso,
  type Profile,
  type PenaltyDurationUnit,
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

const DURATION_PRESETS: Array<{ label: string; value: number; unit: PenaltyDurationUnit }> = [
  { label: '15 минут', value: 15, unit: 'minutes' },
  { label: '1 час', value: 1, unit: 'hours' },
  { label: '12 часов', value: 12, unit: 'hours' },
  { label: '1 день', value: 1, unit: 'days' },
  { label: '3 дня', value: 3, unit: 'days' },
  { label: '7 дней', value: 7, unit: 'days' },
  { label: '30 дней', value: 30, unit: 'days' },
  { label: '90 дней', value: 90, unit: 'days' },
];

const DURATION_UNITS: Array<{ value: PenaltyDurationUnit; label: string }> = [
  { value: 'seconds', label: 'Секунд' },
  { value: 'minutes', label: 'Минут' },
  { value: 'hours', label: 'Часов' },
  { value: 'days', label: 'Дней' },
  { value: 'months', label: 'Месяцев' },
  { value: 'years', label: 'Лет / Года' },
];

type DurationMode = 'preset' | 'custom_unit' | 'exact_date' | 'forever';

function BanConfigInner() {
  const searchParams = useSearchParams();
  const targetUserId = searchParams.get('id') ?? '';
  const router = useRouter();

  const [me, setMe] = useState<Profile | null>(null);
  const [targetUser, setTargetUser] = useState<Profile | null>(null);
  const [availableChats, setAvailableChats] = useState<Array<{ id: string; title: string; type: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Тип наказания
  const [banAccountType, setBanAccountType] = useState(true);
  const [banIpType, setBanIpType] = useState(false);
  const [muteChatType, setMuteChatType] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState('');
  const [ipAddress, setIpAddress] = useState('');

  // Причина и комментарий модератора
  const [reason, setReason] = useState(BAN_PRESET_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [moderatorComment, setModeratorComment] = useState('');

  // Срок наказания
  const [durationMode, setDurationMode] = useState<DurationMode>('preset');
  const [presetIndex, setPresetIndex] = useState<number>(5); // 7 дней по умолчанию
  const [customDurationValue, setCustomDurationValue] = useState<string>('1');
  const [customDurationUnit, setCustomDurationUnit] = useState<PenaltyDurationUnit>('days');
  const [exactDateTime, setExactDateTime] = useState<string>(() => {
    const d = new Date(Date.now() + 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const profile = await getCurrentProfile();
      if (!profile || (profile.role !== 'admin' && profile.role !== 'developer' && profile.role !== 'moderator')) {
        router.push('/chats');
        return;
      }
      setMe(profile);

      const supabase = getSupabaseClient();
      if (targetUserId) {
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

      const { data: chatsData } = await supabase
        .from('chats')
        .select('id, title, type')
        .in('type', ['group', 'channel'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (chatsData && chatsData.length > 0) {
        setAvailableChats(chatsData.map((c: any) => ({ id: c.id, title: c.title || 'Чат без названия', type: c.type })));
        setSelectedChatId(chatsData[0].id);
      }

      setLoading(false);
    })();
  }, [targetUserId, router]);

  function getComputedPreviewDate(): string | null {
    if (durationMode === 'forever') return 'Навсегда (Бессрочно)';
    if (durationMode === 'preset') {
      const p = DURATION_PRESETS[presetIndex] || DURATION_PRESETS[0];
      const iso = computePenaltyExpirationIso({ durationValue: p.value, durationUnit: p.unit });
      return iso ? new Date(iso).toLocaleString('ru-RU') : null;
    }
    if (durationMode === 'custom_unit') {
      const val = parseFloat(customDurationValue);
      if (isNaN(val) || val <= 0) return null;
      const iso = computePenaltyExpirationIso({ durationValue: val, durationUnit: customDurationUnit });
      return iso ? new Date(iso).toLocaleString('ru-RU') : null;
    }
    if (durationMode === 'exact_date') {
      if (!exactDateTime) return null;
      const iso = computePenaltyExpirationIso({ untilDate: exactDateTime });
      return iso ? new Date(iso).toLocaleString('ru-RU') : null;
    }
    return null;
  }

  async function handleSubmitBan(e: React.FormEvent) {
    e.preventDefault();
    if (!me || (!targetUser && !targetUserId)) return;
    if (!banAccountType && !banIpType && !muteChatType) {
      setError('Выберите хотя бы одно действие (Бан по аккаунту, Бан по IP или Мут в чате)');
      return;
    }

    const finalReason = customReason.trim() ? `${reason} — ${customReason.trim()}` : reason;
    const finalComment = moderatorComment.trim() || undefined;

    let durationOptions: {
      permanent?: boolean;
      durationValue?: number;
      durationUnit?: PenaltyDurationUnit;
      untilDate?: string;
    } = {};

    if (durationMode === 'forever') {
      durationOptions = { permanent: true };
    } else if (durationMode === 'preset') {
      const p = DURATION_PRESETS[presetIndex] || DURATION_PRESETS[0];
      durationOptions = { durationValue: p.value, durationUnit: p.unit };
    } else if (durationMode === 'custom_unit') {
      const parsed = parseFloat(customDurationValue);
      if (isNaN(parsed) || parsed <= 0) {
        setError('Укажите корректное положительное число для длительности');
        return;
      }
      durationOptions = { durationValue: parsed, durationUnit: customDurationUnit };
    } else if (durationMode === 'exact_date') {
      if (!exactDateTime) {
        setError('Выберите точную дату и время окончания');
        return;
      }
      const targetMs = new Date(exactDateTime).getTime();
      if (isNaN(targetMs) || targetMs <= Date.now()) {
        setError('Дата и время окончания должны быть в будущем');
        return;
      }
      durationOptions = { untilDate: new Date(exactDateTime).toISOString() };
    }

    if (muteChatType && !selectedChatId) {
      setError('Выберите чат для выдачи мута');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      if (banAccountType && targetUserId) {
        await banAccount(
          targetUserId,
          {
            ...durationOptions,
            reason: finalReason,
            moderatorComment: finalComment,
          },
          me
        );
      }

      if (banIpType) {
        const ipToBan = ipAddress.trim() || targetUser?.last_ip || '127.0.0.1';
        await banIpAddress(ipToBan, finalComment ? `${finalReason} | Комментарий: ${finalComment}` : finalReason, me);
      }

      if (muteChatType && targetUserId && selectedChatId) {
        await muteUserInChat({
          chatId: selectedChatId,
          userId: targetUserId,
          reason: finalReason,
          moderatorComment: finalComment,
          durationValue: durationOptions.durationValue,
          durationUnit: durationOptions.durationUnit,
          untilDate: durationOptions.untilDate,
          permanent: durationOptions.permanent,
          actingProfile: me,
        });
      }

      router.push('/admin?tab=users');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось применить наказание');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading />;
  if (!me) return null;

  const previewDate = getComputedPreviewDate();

  return (
    <main className="container-narrow" style={{ paddingTop: 20, paddingBottom: 40 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Link href="/admin?tab=users" className="btn btn-ghost" style={{ width: 'auto' }}>
          ← Назад в Панель администратора
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
              Настройка наказания (Бан / Мут)
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
              Точная настройка причины, комментария модератора и длительности ограничения
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
          {/* 1. Тип ограничения */}
          <div className="field" style={{ marginBottom: 20 }}>
            <label style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'block' }}>
              1. Выберите тип ограничения
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
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
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Блокирует доступ к аккаунту</div>
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
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Запрещает доступ с этого IP</div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 12,
                  borderRadius: 12,
                  background: muteChatType ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg)',
                  border: muteChatType ? '2px solid #f59e0b' : '1px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={muteChatType}
                  onChange={(e) => setMuteChatType(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>🔇 Мут в чате</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>Запрет писать в выбранном чате</div>
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

          {muteChatType && (
            <div className="field" style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>Выберите чат для мута</label>
              <select
                className="select"
                value={selectedChatId}
                onChange={(e) => setSelectedChatId(e.target.value)}
              >
                {availableChats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.type === 'channel' ? '📢 ' : '👥 '}
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 2. Причина и комментарий модератора */}
          <div className="field" style={{ marginBottom: 20 }}>
            <label style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'block' }}>
              2. Причина наказания и комментарий модератора (видны пользователю)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
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

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                  Уточнение причины (необязательно)
                </label>
                <input
                  className="input"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="Например: пункт правил 4.2, спам ссылками в общем чате..."
                  style={{ fontSize: 13 }}
                />
              </div>

              <div>
                <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', display: 'block', marginBottom: 4 }}>
                  💬 Комментарий модератора для пользователя
                </label>
                <textarea
                  className="input"
                  rows={2}
                  value={moderatorComment}
                  onChange={(e) => setModeratorComment(e.target.value)}
                  placeholder="Напишите комментарий от модерации — пользователь увидит его на экране блокировки и в разделе апелляций..."
                  style={{ resize: 'vertical', fontSize: 13 }}
                />
              </div>
            </div>
          </div>

          {/* 3. Длительность или точная дата/время */}
          <div className="field" style={{ marginBottom: 24 }}>
            <label style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, display: 'block' }}>
              3. Срок действия (длительность или точная дата и время)
            </label>

            {/* Переключатель режимов срока */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 6, marginBottom: 14 }}>
              <button
                type="button"
                className="btn"
                style={{
                  fontSize: 12,
                  borderColor: durationMode === 'preset' ? 'var(--accent)' : undefined,
                  color: durationMode === 'preset' ? 'var(--accent)' : undefined,
                  fontWeight: durationMode === 'preset' ? 700 : 500,
                }}
                onClick={() => setDurationMode('preset')}
              >
                ⚡ Быстрый выбор
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  fontSize: 12,
                  borderColor: durationMode === 'custom_unit' ? 'var(--accent)' : undefined,
                  color: durationMode === 'custom_unit' ? 'var(--accent)' : undefined,
                  fontWeight: durationMode === 'custom_unit' ? 700 : 500,
                }}
                onClick={() => setDurationMode('custom_unit')}
              >
                ⏱️ Свой срок (сек/мин/ч/дн/мес/год)
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  fontSize: 12,
                  borderColor: durationMode === 'exact_date' ? 'var(--accent)' : undefined,
                  color: durationMode === 'exact_date' ? 'var(--accent)' : undefined,
                  fontWeight: durationMode === 'exact_date' ? 700 : 500,
                }}
                onClick={() => setDurationMode('exact_date')}
              >
                📅 До даты и времени
              </button>
              <button
                type="button"
                className="btn"
                style={{
                  fontSize: 12,
                  borderColor: durationMode === 'forever' ? '#ef4444' : undefined,
                  color: durationMode === 'forever' ? '#ef4444' : undefined,
                  fontWeight: durationMode === 'forever' ? 700 : 500,
                }}
                onClick={() => setDurationMode('forever')}
              >
                ♾️ Навсегда
              </button>
            </div>

            {durationMode === 'preset' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
                {DURATION_PRESETS.map((p, idx) => {
                  const isActive = presetIndex === idx;
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
                      onClick={() => setPresetIndex(idx)}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}

            {durationMode === 'custom_unit' && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 10,
                  padding: 14,
                  borderRadius: 12,
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                }}
              >
                <div style={{ flex: '1 1 140px' }}>
                  <label style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Количество
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    className="input"
                    value={customDurationValue}
                    onChange={(e) => setCustomDurationValue(e.target.value)}
                    placeholder="Введите число"
                  />
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>
                    Единица времени
                  </label>
                  <select
                    className="select"
                    value={customDurationUnit}
                    onChange={(e) => setCustomDurationUnit(e.target.value as PenaltyDurationUnit)}
                  >
                    {DURATION_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {durationMode === 'exact_date' && (
              <div
                style={{
                  padding: 14,
                  borderRadius: 12,
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                }}
              >
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Укажите точную дату и время окончания наказания:
                </label>
                <input
                  type="datetime-local"
                  className="input"
                  value={exactDateTime}
                  onChange={(e) => setExactDateTime(e.target.value)}
                  style={{ maxWidth: 280 }}
                />
              </div>
            )}

            {previewDate && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: 'rgba(255, 212, 0, 0.08)',
                  border: '1px solid rgba(255, 212, 0, 0.25)',
                  fontSize: 12.5,
                  color: 'var(--text)',
                }}
              >
                🕒 Наказание будет действовать до: <strong style={{ color: 'var(--accent)' }}>{previewDate}</strong>
              </div>
            )}
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
              {submitting ? 'Применяем наказание…' : '⛔ Подтвердить и применить'}
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

