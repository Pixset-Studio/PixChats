'use client';

import React, { useState } from 'react';
import { reportMessage } from '@pixchats/core';

interface ReportMessageModalProps {
  messageId: string;
  reportedUserId: string;
  chatId?: string;
  onClose: () => void;
  onReported?: (autoFrozen: boolean) => void;
}

const REPORT_REASONS = [
  { id: 'spam', label: '🚨 Спам, реклама или фишинг' },
  { id: 'insult', label: '🤬 Оскорбления, буллинг или травля' },
  { id: 'illegal', label: '⚠️ Угрозы, запрещённый контент или нарушение закона' },
  { id: 'scam', label: '💸 Мошенничество или вымогательство' },
  { id: 'other', label: '💬 Другое нарушение правил PixChats' },
];

export function ReportMessageModal({
  messageId,
  reportedUserId,
  chatId,
  onClose,
  onReported,
}: ReportMessageModalProps) {
  const [selectedReason, setSelectedReason] = useState(REPORT_REASONS[0].label);
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await reportMessage({
        messageId,
        reportedUserId,
        chatId,
        reason: selectedReason,
        details: details.trim() || undefined,
      });

      onReported?.(res.autoFrozen);
      onClose();
    } catch (err: any) {
      setError(err.message ?? 'Не удалось отправить жалобу');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 9999 }}>
      <div
        className="modal-card"
        style={{ maxWidth: 420, width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 17, color: 'var(--text)' }}>🚨 Пожаловаться на сообщение</h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: 4 }} onClick={onClose}>
            ✕
          </button>
        </div>

        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14, lineHeight: 1.45 }}>
          Жалоба передаётся команде модерации. Если на этого пользователя поступит несколько жалоб от разных людей, его аккаунт будет автоматически заморожен.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="field" style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700 }}>Причина жалобы</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
              {REPORT_REASONS.map((r) => (
                <label
                  key={r.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: selectedReason === r.label ? 'var(--surface-raised)' : 'transparent',
                    border: selectedReason === r.label ? '1px solid var(--accent)' : '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="radio"
                    name="report_reason"
                    checked={selectedReason === r.label}
                    onChange={() => setSelectedReason(r.label)}
                  />
                  <span>{r.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="field" style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700 }}>Дополнительные детали (необязательно)</label>
            <textarea
              className="input"
              rows={2}
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Опишите подробнее, что нарушено…"
              style={{ resize: 'vertical', fontSize: 13 }}
            />
          </div>

          {error && <p className="error" style={{ marginBottom: 12 }}>{error}</p>}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose} disabled={submitting}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={submitting}>
              {submitting ? 'Отправляем…' : 'Отправить жалобу'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
