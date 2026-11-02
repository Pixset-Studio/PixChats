'use client';

import React, { useState } from 'react';
import { submitAppeal, type AppealPenaltyType } from '@pixchats/core';

interface AppealModalProps {
  userId: string;
  penaltyType: AppealPenaltyType;
  chatId?: string;
  chatTitle?: string;
  allowChangeType?: boolean;
  onClose: () => void;
  onAppealSubmitted?: () => void;
}

const PENALTY_TITLES: Record<AppealPenaltyType, string> = {
  mute: '🔇 Мут в чате',
  freeze: '❄️ Заморозка аккаунта',
  ban_account: '⛔ Блокировка аккаунта',
  ban_ip: '🌐 Блокировка по IP-адресу',
};

export function AppealModal({
  userId,
  penaltyType,
  chatId,
  chatTitle,
  allowChangeType = false,
  onClose,
  onAppealSubmitted,
}: AppealModalProps) {
  const [selectedType, setSelectedType] = useState<AppealPenaltyType>(penaltyType);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Опишите причину обжалования');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      await submitAppeal({
        userId,
        penaltyType: selectedType,
        chatId: selectedType === 'mute' ? chatId : undefined,
        reason: reason.trim(),
      });

      onAppealSubmitted?.();
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить апелляцию');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 10000 }}>
      <div
        className="modal-card"
        style={{ maxWidth: 440, width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 17, color: 'var(--accent)' }}>
            ⚖️ Подать апелляцию (Обжалование)
          </h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: 4 }} onClick={onClose}>
            ✕
          </button>
        </div>

        <div
          style={{
            padding: '10px 12px',
            borderRadius: 10,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            marginBottom: 14,
            fontSize: 13,
          }}
        >
          {allowChangeType ? (
            <div className="field" style={{ marginBottom: chatTitle ? 8 : 0 }}>
              <label style={{ fontSize: 12, fontWeight: 700, display: 'block', marginBottom: 4 }}>
                Тип ограничения для обжалования
              </label>
              <select
                className="select"
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as AppealPenaltyType)}
              >
                <option value="mute">🔇 Мут в чате</option>
                <option value="freeze">❄️ Заморозка аккаунта</option>
                <option value="ban_account">⛔ Блокировка аккаунта</option>
                <option value="ban_ip">🌐 Блокировка по IP-адресу</option>
              </select>
            </div>
          ) : (
            <div>
              <strong>Тип ограничения:</strong> {PENALTY_TITLES[selectedType] || selectedType}
            </div>
          )}
          {chatTitle && selectedType === 'mute' && (
            <div style={{ marginTop: 4, color: 'var(--text-muted)' }}>
              <strong>Чат:</strong> {chatTitle}
            </div>
          )}
        </div>

        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14, lineHeight: 1.45 }}>
          Апелляция будет передана на рассмотрение модераторам и администраторам PixChats. Если наказание было выдано по ошибке, ограничение будет снято.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700 }}>Причина обжалования</label>
            <textarea
              className="input"
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Подробно объясните, почему снятие ограничений оправдано (например: ошибка системы, случайная опечатка, недоразумение)..."
              required
              autoFocus
              style={{ resize: 'vertical', fontSize: 13 }}
            />
          </div>

          {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={submitting}>
              {submitting ? 'Отправляем…' : 'Отправить апелляцию ⚖️'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

