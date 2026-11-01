'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { DesktopShell } from '../../components/DesktopShell';
import { BottomNav } from '../../components/BottomNav';
import { BackIcon } from '../../components/Icons';

interface FaqItem {
  q: string;
  a: string;
  category: 'Общие' | 'Безопасность' | 'Каналы и звонки';
}

const FAQ_LIST: FaqItem[] = [
  {
    category: 'Общие',
    q: 'Как работает офлайн-режим в PixChats?',
    a: 'Приложение автоматически сохраняет до 250 последних сообщений каждого чата в локальном хранилище устройства (IndexedDB / LocalStorage). Вы можете просматривать историю старых сообщений и чатов даже при полном отсутствии интернета и сотовой связи.',
  },
  {
    category: 'Общие',
    q: 'Как работают папки и архивы чатов?',
    a: 'Вы можете создавать персональные папки (например, «Работа», «Семья», «Важное»), распределять по ним чаты, а также закреплять важные диалоги сверху списка или отправлять неактивные чаты в Архив.',
  },
  {
    category: 'Безопасность',
    q: 'Как работает вход по PIN-коду и скрытые чаты?',
    a: 'В настройках вы можете включить блокировку приложения по секретному PIN-коду (App Lock) и настроить автоблокировку при бездействии. Тот же PIN-код позволяет скрывать чаты из общего списка и находить их через секретный поиск.',
  },
  {
    category: 'Безопасность',
    q: 'Как устроены исчезающие сообщения и одноразовые медиа?',
    a: 'Вы можете устанавливать таймер автоудаления сообщений (15 сек, 1 мин, 1 час, 24 часа), а также отправлять фото и видео в режиме однократного просмотра («View Once»), которые удаляются сразу после просмотренного сеанса.',
  },
  {
    category: 'Каналы и звонки',
    q: 'Как работают каналы с входом по заявкам?',
    a: 'Создатель приватного канала может включить настройку «Вход только по заявкам». Когда новый пользователь переходит по ссылке, он отправляет заявку с примечанием, а администраторы рассматривают её и могут одобрить или отклонить в настройках канала.',
  },
  {
    category: 'Каналы и звонки',
    q: 'Можно ли свернуть звонок и пользоваться приложением?',
    a: 'Да! Звонки и групповые аудио/видеочаты можно сворачивать в удобный плавающий мини-плеер, позволяющий одновременно общаться в других чатах и использовать все функции PixChats.',
  },
  {
    category: 'Каналы и звонки',
    q: 'Какие возможности доступны в прямых эфирах каналов?',
    a: 'Администраторы каналов могут проводить прямые трансляции с включением камеры, демонстрацией экрана (Screen Share), поддержкой спикеров и интерактивной системой поднятых рук («Поднять руку» / «Дать слово»).',
  },
];

export default function FaqPage() {
  const [filter, setFilter] = useState<'All' | 'Общие' | 'Безопасность' | 'Каналы и звонки'>('All');
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const [search, setSearch] = useState('');

  const filtered = FAQ_LIST.filter((item) => {
    if (filter !== 'All' && item.category !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return item.q.toLowerCase().includes(q) || item.a.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <DesktopShell>
      <main className="container-wide with-bottom-nav">
        <header className="app-header" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Link href="/chats/" className="btn btn-ghost" style={{ width: 'auto', padding: '6px 10px' }}>
              <BackIcon size={18} />
            </Link>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>
              FAQ и Справка PixChats
            </h1>
          </div>
        </header>

        <div className="card" style={{ marginBottom: 20, background: 'var(--surface-raised)' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Часто задаваемые вопросы</h3>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px' }}>
            Всё, что нужно знать о функциях, безопасности, офлайн-режиме, звонках и каналах в PixChats.
          </p>

          <input
            type="text"
            className="input"
            placeholder="🔍 Поиск по вопросам и ответам..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ marginBottom: 14 }}
          />

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['All', 'Общие', 'Безопасность', 'Каналы и звонки'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                className={`btn ${filter === cat ? 'btn-primary' : ''}`}
                style={{ width: 'auto', padding: '6px 12px', fontSize: 12.5 }}
                onClick={() => setFilter(cat)}
              >
                {cat === 'All' ? 'Все темы' : cat}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filtered.length === 0 ? (
            <div className="empty-state">По вашему запросу ничего не найдено.</div>
          ) : (
            filtered.map((item, idx) => {
              const isOpen = openIndex === idx;
              return (
                <div
                  key={idx}
                  className="card"
                  style={{
                    padding: 18,
                    cursor: 'pointer',
                    borderColor: isOpen ? 'var(--accent)' : undefined,
                    transition: 'border-color 0.2s ease',
                  }}
                  onClick={() => setOpenIndex(isOpen ? null : idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'rgba(255, 212, 0, 0.15)',
                          color: 'var(--accent)',
                        }}
                      >
                        {item.category}
                      </span>
                      <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                        {item.q}
                      </h4>
                    </div>
                    <span style={{ fontSize: 16, color: 'var(--accent)', fontWeight: 700 }}>
                      {isOpen ? '−' : '+'}
                    </span>
                  </div>

                  {isOpen && (
                    <div
                      style={{
                        marginTop: 12,
                        paddingTop: 12,
                        borderTop: '1px solid var(--border)',
                        fontSize: 13.5,
                        color: 'var(--text-muted)',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {item.a}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>
      <BottomNav />
    </DesktopShell>
  );
}
