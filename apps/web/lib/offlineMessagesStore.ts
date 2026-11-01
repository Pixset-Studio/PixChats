/**
 * offlineMessagesStore.ts — 100% Офлайн-доступ к истории сообщений PixChats
 * Сохраняет историю сообщений для всех чатов в локальном хранилище устройства,
 * что позволяет свободно открывать и читать старые переписки без интернета.
 */

import type { Message } from '@pixchats/core';

export interface OfflineQueuedMessage {
  id: string;
  chatId: string;
  text: string;
  mediaPath?: string;
  caption?: string;
  messageType?: string;
  createdAt: number;
}

const MESSAGES_KEY_PREFIX = 'pixchats:offline_messages:';
const QUEUE_KEY = 'pixchats:offline_outgoing_queue';

export function saveOfflineMessages(chatId: string, messages: Message[]): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    // Сохраняем последние 250 сообщений чата для офлайн чтения
    const sliced = messages.slice(-250);
    localStorage.setItem(`${MESSAGES_KEY_PREFIX}${chatId}`, JSON.stringify(sliced));
  } catch {}
}

export function getOfflineMessages(chatId: string): Message[] {
  if (typeof window === 'undefined' || !chatId) return [];
  try {
    const raw = localStorage.getItem(`${MESSAGES_KEY_PREFIX}${chatId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function queueOfflineMessage(item: OfflineQueuedMessage): void {
  if (typeof window === 'undefined') return;
  try {
    const queue = getOfflineQueue();
    queue.push(item);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    window.dispatchEvent(new CustomEvent('pixchats:offline_queue_changed'));
  } catch {}
}

export function getOfflineQueue(): OfflineQueuedMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function clearOfflineQueue(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(QUEUE_KEY);
}
