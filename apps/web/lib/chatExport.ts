'use client';

import type { Message, Profile } from '@pixchats/core';
import { extractSelfDestructInfo } from '../components/FormattedMessageText';
import { extractTopicFromText } from './channelConfig';

export function exportChatHistory(
  chatTitle: string,
  messages: Message[],
  myProfile: Profile,
  senderProfiles: Record<string, Profile>,
  otherProfile: Profile | null,
  format: 'html' | 'json'
): void {
  if (typeof window === 'undefined') return;

  const resolveSenderName = (senderId: string) => {
    if (senderId === myProfile.id) return myProfile.display_name;
    if (otherProfile && senderId === otherProfile.id) return otherProfile.display_name;
    return senderProfiles[senderId]?.display_name || 'Участник';
  };

  const items = messages
    .filter((m) => !m.is_deleted)
    .map((m) => {
      const { cleanText } = extractSelfDestructInfo(m.text || '');
      const { topicId, cleanText: finalText } = extractTopicFromText(cleanText);
      return {
        id: m.id,
        sender: resolveSenderName(m.sender_id),
        sentAt: m.sent_at,
        type: m.message_type,
        topic: topicId || undefined,
        text: finalText,
        caption: m.caption || undefined,
      };
    });

  const safeTitle = (chatTitle || 'chat').replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_');

  if (format === 'json') {
    const jsonBlob = new Blob([JSON.stringify({ chatTitle, exportedAt: new Date().toISOString(), messages: items }, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    triggerDownload(jsonBlob, `pixchats-${safeTitle}.json`);
    return;
  }

  const rowsHtml = items
    .map(
      (item) => `
      <div class="msg">
        <div class="meta">
          <strong>${escapeHtml(item.sender)}</strong>
          <span>${new Date(item.sentAt).toLocaleString('ru-RU')}</span>
          ${item.topic ? `<span class="topic">#${escapeHtml(item.topic)}</span>` : ''}
        </div>
        <div class="body">${escapeHtml(item.text)}</div>
      </div>`
    )
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <title>Экспорт чата — ${escapeHtml(chatTitle)}</title>
  <style>
    body { background: #09090b; color: #f4f4f5; font-family: system-ui, -apple-system, sans-serif; max-width: 760px; margin: 0 auto; padding: 28px 18px; }
    h1 { color: #ffd400; font-size: 22px; margin-bottom: 4px; }
    .sub { color: #a1a1aa; font-size: 13px; margin-bottom: 24px; }
    .msg { background: #141418; border: 1px solid #27272a; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
    .meta { display: flex; gap: 10px; align-items: baseline; font-size: 12px; color: #a1a1aa; margin-bottom: 6px; }
    .meta strong { color: #ffd400; font-size: 13px; }
    .topic { background: rgba(255,212,0,0.12); color: #ffd400; padding: 1px 6px; border-radius: 6px; }
    .body { font-size: 14px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  </style>
</head>
<body>
  <h1>Экспорт истории: ${escapeHtml(chatTitle)}</h1>
  <div class="sub">PixChats · Экспортировано ${new Date().toLocaleString('ru-RU')} · Сообщений: ${items.length}</div>
  ${rowsHtml}
</body>
</html>`;

  const htmlBlob = new Blob([html], { type: 'text/html;charset=utf-8' });
  triggerDownload(htmlBlob, `pixchats-${safeTitle}.html`);
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
