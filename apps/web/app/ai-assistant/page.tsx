'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getCachedCurrentProfile,
  FREE_TIER_AI_MODELS,
  DEVELOPER_TOOL_DECLARATIONS,
  loadDeveloperAiConfig,
  saveDeveloperAiConfig,
  runDeveloperAiAssistantTurn,
  type Profile,
  type AiAssistantMessage,
} from '@pixchats/core';
import { DesktopShell } from '../../components/DesktopShell';
import { BottomNav } from '../../components/BottomNav';
import { isBanned } from '../../lib/ban';

const QUICK_DEV_PROMPTS = [
  {
    label: '📊 Полная статистика',
    prompt: 'Покажи полную живую статистику приложения PixChats и проверь статус систем.',
  },
  {
    label: '🗄️ Диагностика БД и квот',
    prompt: 'Запусти глубокую диагностику таблиц базы данных Supabase (run_database_diagnostics) и оцени расход квот.',
  },
  {
    label: '❄️ Замороженные и забаненные',
    prompt: 'Найди всех замороженных и забаненных пользователей и покажи причины их наказаний.',
  },
  {
    label: '⚖️ Проверить апелляции',
    prompt: 'Покажи все поступившие апелляции от пользователей, которые ждут рассмотрения.',
  },
  {
    label: '🚨 Жалобы на сообщения',
    prompt: 'Покажи последние жалобы пользователей на сообщения и скажи, кого нужно проверить.',
  },
  {
    label: '🏷️ Кастомные роли',
    prompt: 'Покажи список всех созданных кастомных ролей в приложении.',
  },
  {
    label: '🧹 Очистка заморозок >90 дней',
    prompt: 'Запусти проверку и очистку аккаунтов, замороженных более 90 дней (cleanup_expired_frozen_accounts).',
  },
  {
    label: '📜 Журнал аудита и ошибки',
    prompt: 'Покажи последние записи из журнала действий администрации (Audit Log) и ошибки клиентов.',
  },
];

const CHAT_HISTORY_LS_KEY = 'pixchats_dev_ai_chat_history_v1';

/**
 * Парсер инлайн-разметки Markdown (жирный **текст**, курсив *текст*, код `код`, зачёркнутый ~~текст~~)
 * Полностью убирает сырые символы **, *, `, ~~ из текста ответа AI ассистента.
 */
function renderInlineMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Регулярное выражение для инлайн-элементов: `code`, **bold**, __bold__, ~~strike~~, *italic*
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyCounter = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const raw = match[0];
    keyCounter += 1;

    if (raw.startsWith('`') && raw.endsWith('`') && raw.length > 2) {
      nodes.push(
        <code
          key={`inline-code-${keyCounter}`}
          style={{
            padding: '2px 6px',
            borderRadius: 5,
            background: 'rgba(255, 212, 0, 0.14)',
            border: '1px solid rgba(255, 212, 0, 0.3)',
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.9em',
          }}
        >
          {raw.slice(1, -1)}
        </code>
      );
    } else if (
      (raw.startsWith('**') && raw.endsWith('**') && raw.length > 4) ||
      (raw.startsWith('__') && raw.endsWith('__') && raw.length > 4)
    ) {
      nodes.push(
        <strong key={`inline-bold-${keyCounter}`} style={{ fontWeight: 700, color: 'var(--text)' }}>
          {raw.slice(2, -2)}
        </strong>
      );
    } else if (raw.startsWith('~~') && raw.endsWith('~~') && raw.length > 4) {
      nodes.push(
        <span key={`inline-strike-${keyCounter}`} style={{ opacity: 0.7 }}>
          {raw.slice(2, -2)}
        </span>
      );
    } else if (raw.startsWith('*') && raw.endsWith('*') && raw.length > 2) {
      nodes.push(
        <em key={`inline-em-${keyCounter}`} style={{ fontStyle: 'italic' }}>
          {raw.slice(1, -1)}
        </em>
      );
    } else {
      nodes.push(raw);
    }

    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/**
 * Полноценный Markdown-рендерер для окна AI ассистента:
 * поддерживает заголовки (#, ##, ###), списки (-, *, 1.), таблицы (|...|), цитаты (>),
 * разделители (---) и блоки кода (```...```).
 */
function AssistantMarkdown({ content, isUser }: { content: string; isUser?: boolean }) {
  if (isUser) {
    return <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{content}</div>;
  }

  // Разбиваем по блокам кода ```...```
  const segments = content.split(/(```[\s\S]*?```)/g);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, wordBreak: 'break-word' }}>
      {segments.map((segment, segIdx) => {
        if (segment.startsWith('```') && segment.endsWith('```')) {
          const inner = segment.slice(3, -3).replace(/^\r?\n/, '');
          const firstNewLine = inner.indexOf('\n');
          let lang = '';
          let codeBody = inner;
          if (firstNewLine !== -1) {
            const firstLine = inner.slice(0, firstNewLine).trim();
            if (/^[a-zA-Z0-9_-]{1,18}$/.test(firstLine)) {
              lang = firstLine;
              codeBody = inner.slice(firstNewLine + 1);
            }
          }
          return (
            <div
              key={`codeblock-${segIdx}`}
              style={{
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--border)',
                background: '#09090b',
                margin: '4px 0',
              }}
            >
              {lang && (
                <div
                  style={{
                    padding: '4px 10px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: 'rgba(255, 212, 0, 0.12)',
                    color: 'var(--accent)',
                    borderBottom: '1px solid var(--border)',
                    textTransform: 'uppercase',
                  }}
                >
                  {lang}
                </div>
              )}
              <pre
                style={{
                  margin: 0,
                  padding: '10px 12px',
                  overflowX: 'auto',
                  fontSize: 12.5,
                  lineHeight: 1.45,
                  color: '#e4e4e7',
                  fontFamily: 'var(--font-mono, monospace)',
                }}
              >
                <code>{codeBody}</code>
              </pre>
            </div>
          );
        }

        const lines = segment.split(/\r?\n/);
        const blocks: React.ReactNode[] = [];
        let i = 0;

        while (i < lines.length) {
          const line = lines[i];
          const trimmed = line.trim();

          if (!trimmed) {
            i += 1;
            continue;
          }

          // Горизонтальный разделитель
          if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            blocks.push(
              <hr
                key={`hr-${segIdx}-${i}`}
                style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '6px 0' }}
              />
            );
            i += 1;
            continue;
          }

          // Заголовки #, ##, ###, ####
          const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
          if (headingMatch) {
            const level = headingMatch[1].length;
            const headingText = headingMatch[2].replace(/\s*#+\s*$/, '');
            const fontSize = level === 1 ? 17 : level === 2 ? 15.5 : level === 3 ? 14.5 : 13.5;
            blocks.push(
              <div
                key={`h-${segIdx}-${i}`}
                style={{
                  fontWeight: 800,
                  fontSize,
                  color: level <= 2 ? 'var(--accent)' : 'var(--text)',
                  marginTop: 4,
                  marginBottom: 2,
                }}
              >
                {renderInlineMarkdown(headingText)}
              </div>
            );
            i += 1;
            continue;
          }

          // Таблица Markdown (| ... |)
          if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < lines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(lines[i + 1])) {
            const headerCells = trimmed
              .slice(1, -1)
              .split('|')
              .map((c) => c.trim());
            i += 2; // пропускаем заголовок и разделитель |---|---|
            const bodyRows: string[][] = [];
            while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].trim().endsWith('|')) {
              const rowCells = lines[i]
                .trim()
                .slice(1, -1)
                .split('|')
                .map((c) => c.trim());
              bodyRows.push(rowCells);
              i += 1;
            }
            blocks.push(
              <div key={`table-${segIdx}-${i}`} style={{ overflowX: 'auto', margin: '4px 0' }}>
                <table
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    fontSize: 12.5,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    overflow: 'hidden',
                  }}
                >
                  <thead>
                    <tr style={{ background: 'rgba(255, 212, 0, 0.12)' }}>
                      {headerCells.map((hc, cIdx) => (
                        <th
                          key={cIdx}
                          style={{
                            padding: '7px 10px',
                            borderBottom: '1px solid var(--border)',
                            textAlign: 'left',
                            fontWeight: 700,
                            color: 'var(--accent)',
                          }}
                        >
                          {renderInlineMarkdown(hc)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        style={{
                          background: rIdx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                        }}
                      >
                        {row.map((cell, cIdx) => (
                          <td
                            key={cIdx}
                            style={{
                              padding: '6px 10px',
                              borderBottom: '1px solid var(--border)',
                            }}
                          >
                            {renderInlineMarkdown(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
            continue;
          }

          // Маркированный список (- , * , • )
          if (/^([-*•])\s+/.test(trimmed)) {
            const listItems: string[] = [];
            while (i < lines.length && /^([-*•])\s+/.test(lines[i].trim())) {
              listItems.push(lines[i].trim().replace(/^([-*•])\s+/, ''));
              i += 1;
            }
            blocks.push(
              <ul
                key={`ul-${segIdx}-${i}`}
                style={{ margin: '2px 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                {listItems.map((item, idx) => (
                  <li key={idx} style={{ lineHeight: 1.45 }}>
                    {renderInlineMarkdown(item)}
                  </li>
                ))}
              </ul>
            );
            continue;
          }

          // Нумерованный список (1. , 2. )
          if (/^\d+\.\s+/.test(trimmed)) {
            const listItems: string[] = [];
            while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
              listItems.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
              i += 1;
            }
            blocks.push(
              <ol
                key={`ol-${segIdx}-${i}`}
                style={{ margin: '2px 0', paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}
              >
                {listItems.map((item, idx) => (
                  <li key={idx} style={{ lineHeight: 1.45 }}>
                    {renderInlineMarkdown(item)}
                  </li>
                ))}
              </ol>
            );
            continue;
          }

          // Цитата (> )
          if (trimmed.startsWith('>')) {
            const quoteText = trimmed.replace(/^>\s*/, '');
            blocks.push(
              <div
                key={`quote-${segIdx}-${i}`}
                style={{
                  borderLeft: '3px solid var(--accent)',
                  paddingLeft: 10,
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                  margin: '2px 0',
                }}
              >
                {renderInlineMarkdown(quoteText)}
              </div>
            );
            i += 1;
            continue;
          }

          // Обычный абзац
          blocks.push(
            <div key={`p-${segIdx}-${i}`} style={{ lineHeight: 1.5 }}>
              {renderInlineMarkdown(trimmed)}
            </div>
          );
          i += 1;
        }

        return <React.Fragment key={`seg-${segIdx}`}>{blocks}</React.Fragment>;
      })}
    </div>
  );
}

export default function DeveloperAiAssistantPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(() => getCachedCurrentProfile());
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>(FREE_TIER_AI_MODELS[0].id);
  const [showKeyConfig, setShowKeyConfig] = useState(false);
  const [showToolsList, setShowToolsList] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configNotice, setConfigNotice] = useState<string | null>(null);

  const [messages, setMessages] = useState<AiAssistantMessage[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          router.push('/login');
          return;
        }
        if (isBanned(profile)) {
          router.push('/banned');
          return;
        }
        // Доступ строго только для разработчиков (developer)
        if (profile.role !== 'developer') {
          router.push('/chats');
          return;
        }
        setMe(profile);

        const cfg = await loadDeveloperAiConfig(profile);
        setApiKey(cfg.apiKey || '');
        setSelectedModel(cfg.model || FREE_TIER_AI_MODELS[0].id);
        if (!cfg.apiKey) {
          setShowKeyConfig(true);
        }

        if (typeof window !== 'undefined') {
          const savedHistory = localStorage.getItem(CHAT_HISTORY_LS_KEY);
          if (savedHistory) {
            try {
              const parsed = JSON.parse(savedHistory);
              if (Array.isArray(parsed)) setMessages(parsed);
            } catch {}
          }
        }
      } finally {
        setLoadingAuth(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, running]);

  function persistHistory(next: AiAssistantMessage[]) {
    setMessages(next);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(CHAT_HISTORY_LS_KEY, JSON.stringify(next.slice(-40)));
      } catch {}
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!me) return;
    setSavingConfig(true);
    setConfigNotice(null);
    setError(null);
    try {
      const saved = await saveDeveloperAiConfig(
        { apiKey: apiKey.trim(), model: selectedModel },
        me
      );
      setApiKey(saved.apiKey);
      setSelectedModel(saved.model);
      setConfigNotice('✅ API ключ и выбранная модель сохранены!');
      setShowKeyConfig(false);
      setTimeout(() => setConfigNotice(null), 3000);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить настройки AI ассистента');
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleSendPrompt(textToSend?: string) {
    if (!me || running) return;
    const promptText = (textToSend ?? input).trim();
    if (!promptText) return;

    setError(null);
    if (!textToSend) setInput('');

    const userMsg: AiAssistantMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: promptText,
      createdAt: new Date().toISOString(),
    };
    const nextHistory = [...messages, userMsg];
    persistHistory(nextHistory);
    setRunning(true);

    try {
      const { replyText, toolLogs } = await runDeveloperAiAssistantTurn({
        prompt: promptText,
        history: messages,
        actingProfile: me,
        apiKeyOverride: apiKey.trim(),
        modelOverride: selectedModel,
      });

      const assistantMsg: AiAssistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        text: replyText,
        createdAt: new Date().toISOString(),
        toolLogs,
      };
      persistHistory([...nextHistory, assistantMsg]);
    } catch (err: any) {
      setError(err.message ?? 'Ошибка обращения к Gemini API');
    } finally {
      setRunning(false);
    }
  }

  if (loadingAuth) {
    return (
      <DesktopShell>
        <main className="container-wide with-bottom-nav">
          <div className="empty-state">Проверка прав доступа разработчика…</div>
        </main>
      </DesktopShell>
    );
  }

  if (!me || me.role !== 'developer') {
    return null;
  }

  const activeModelMeta =
    FREE_TIER_AI_MODELS.find((m) => m.id === selectedModel) || FREE_TIER_AI_MODELS[0];

  return (
    <DesktopShell>
      <main className="container-wide with-bottom-nav" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <header className="app-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>
                🤖 AI ассистент разработчика PixChats
              </h1>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 800,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--accent)',
                  color: '#000',
                }}
              >
                DEVELOPER ONLY
              </span>
              {activeModelMeta.isAgent && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 800,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: '#38bdf8',
                    color: '#000',
                  }}
                >
                  🚀 AGENT ANTIGRAVITY
                </span>
              )}
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              16 инструментов полного управления приложением • Активная модель:{' '}
              <strong style={{ color: 'var(--accent)' }}>{activeModelMeta.label}</strong> ({selectedModel})
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={showKeyConfig ? 'btn btn-primary' : 'btn'}
              style={{ width: 'auto', padding: '7px 12px', fontSize: 12.5 }}
              onClick={() => setShowKeyConfig((v) => !v)}
            >
              🔑 {apiKey ? 'Модели и API ключ' : 'Вставить API ключ'}
            </button>
            <button
              type="button"
              className={showToolsList ? 'btn btn-primary' : 'btn'}
              style={{ width: 'auto', padding: '7px 12px', fontSize: 12.5 }}
              onClick={() => setShowToolsList((v) => !v)}
            >
              🛠️ Инструменты ({DEVELOPER_TOOL_DECLARATIONS.length})
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', padding: '7px 12px', fontSize: 12.5 }}
                onClick={() => persistHistory([])}
              >
                🧹 Очистить диалог
              </button>
            )}
            <Link href="/admin/" className="btn btn-ghost" style={{ width: 'auto', padding: '7px 12px', fontSize: 12.5 }}>
              🛡️ В админку
            </Link>
          </div>
        </header>

        {configNotice && <div className="notice">{configNotice}</div>}
        {error && <div className="error">{error}</div>}

        {/* Справка по всем 16 доступным инструментам и агенту Antigravity */}
        {showToolsList && (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                🛠️ Арсенал инструментов AI ассистента ({DEVELOPER_TOOL_DECLARATIONS.length}) и режим Агента Antigravity
              </div>
              <button type="button" className="btn btn-ghost" style={{ width: 'auto', padding: '4px 8px' }} onClick={() => setShowToolsList(false)}>
                ✕
              </button>
            </div>
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgba(255, 212, 0, 0.08)',
                border: '1px solid rgba(255, 212, 0, 0.3)',
                fontSize: 12.5,
                marginBottom: 12,
                lineHeight: 1.45,
              }}
            >
              <strong style={{ color: 'var(--accent)' }}>🚀 Где использовать Агента Antigravity (antigravity-preview-09-2026):</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                <li><strong>Комплексные многошаговые задачи и аудит:</strong> когда нужно одновременно собрать статистику, проверить жалобы, проанализировать подозрительных пользователей и сформировать сводный отчёт.</li>
                <li><strong>Вычисления и выполнение кода Python в облачной песочнице:</strong> расчёт прогнозов нагрузки на БД Supabase, анализ динамики роста DAU/MAU, генерация сложных скриптов и регулярных выражений для автомодерации.</li>
                <li><strong>Поиск актуальной информации в вебе:</strong> проверка внешних ссылок, документации API, IP-адресов нарушителей или технических решений прямо из окна управления PixChats.</li>
              </ul>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 8 }}>
              {DEVELOPER_TOOL_DECLARATIONS.map((t) => (
                <div
                  key={t.name}
                  style={{
                    padding: '9px 11px',
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 700, color: 'var(--accent)', marginBottom: 3 }}>⚡ {t.name}</div>
                  <div style={{ color: 'var(--text-muted)', lineHeight: 1.35 }}>{t.description}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Панель настройки API ключа и выбора модели */}
        {showKeyConfig && (
          <form onSubmit={handleSaveConfig} className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              ⚙️ Настройка Gemini API ключа и выбор модели / агента
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
              Вставьте ваш API ключ из Google AI Studio. Выберите любую из моделей семейства Gemini 2.5 / 3 / 3.5 / 3.6 / 3.8 или режим автономного агента <strong>Antigravity</strong>.
            </p>

            <div className="field" style={{ marginBottom: 14 }}>
              <label style={{ fontWeight: 700, fontSize: 12.5 }}>Gemini API ключ (AIzaSy...)</label>
              <input
                type="password"
                className="input"
                placeholder="Вставьте ваш Gemini API Key…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: 14 }}>
              <label style={{ fontWeight: 700, fontSize: 12.5 }}>Выбор модели или режима Агента</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(235px, 1fr))', gap: 10 }}>
                {FREE_TIER_AI_MODELS.map((m) => {
                  const active = selectedModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedModel(m.id)}
                      style={{
                        textAlign: 'left',
                        padding: 12,
                        borderRadius: 12,
                        cursor: 'pointer',
                        background: active
                          ? 'rgba(255, 212, 0, 0.12)'
                          : m.isAgent
                            ? 'rgba(56, 189, 248, 0.08)'
                            : 'var(--bg-secondary)',
                        border: active
                          ? '1.5px solid var(--accent)'
                          : m.isAgent
                            ? '1px solid rgba(56, 189, 248, 0.4)'
                            : '1px solid var(--border)',
                        color: 'var(--text)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5 }}>
                          {m.isAgent ? `🚀 ${m.label}` : m.label}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            borderRadius: 5,
                            background: active ? 'var(--accent)' : 'var(--surface-raised)',
                            color: active ? '#000' : 'var(--text-muted)',
                          }}
                        >
                          {m.badge}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.35 }}>
                        {m.description}
                      </div>
                      <code style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>{m.id}</code>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={savingConfig}>
                {savingConfig ? 'Сохранение…' : '💾 Сохранить настройки AI ассистента'}
              </button>
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => setShowKeyConfig(false)}
              >
                Скрыть
              </button>
            </div>
          </form>
        )}

        {/* Быстрые команды управления приложением */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 4,
          }}
        >
          {QUICK_DEV_PROMPTS.map((q) => (
            <button
              key={q.label}
              type="button"
              className="btn"
              style={{
                width: 'auto',
                padding: '7px 12px',
                fontSize: 12,
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
              disabled={running}
              onClick={() => handleSendPrompt(q.prompt)}
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* Окно диалога с AI ассистентом, логом вызовов инструментов и чистым Markdown-форматированием */}
        <div
          className="card"
          style={{
            flex: 1,
            minHeight: 420,
            maxHeight: '64vh',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 16,
          }}
        >
          {messages.length === 0 ? (
            <div className="empty-state" style={{ margin: 'auto', maxWidth: 560 }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>🤖</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>
                Системный AI ассистент и агент разработчика готов к работе
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Вы можете попросить его собрать статистику, провести диагностику таблиц БД, собрать полное досье на любого пользователя, выдать или снять бан/заморозку/мут, управлять кастомными ролями, рассмотреть апелляции, модерировать чаты/истории или запустить автономного агента <strong>Antigravity</strong>.
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={msg.id}
                  style={{
                    alignSelf: isUser ? 'flex-end' : 'flex-start',
                    maxWidth: '88%',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  {msg.toolLogs && msg.toolLogs.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {msg.toolLogs.map((log, idx) => (
                        <div
                          key={`${msg.id}-tool-${idx}`}
                          style={{
                            fontSize: 11.5,
                            padding: '5px 10px',
                            borderRadius: 8,
                            background: 'rgba(255, 212, 0, 0.1)',
                            border: '1px solid rgba(255, 212, 0, 0.3)',
                            color: 'var(--text)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 800,
                              padding: '1px 6px',
                              borderRadius: 4,
                              background: 'var(--accent)',
                              color: '#000',
                              fontSize: 10.5,
                            }}
                          >
                            ⚡ {log.toolName}
                          </span>
                          <span>{log.resultSummary}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    style={{
                      padding: '11px 15px',
                      borderRadius: 14,
                      background: isUser ? 'var(--accent)' : 'var(--bg-secondary)',
                      color: isUser ? '#000' : 'var(--text)',
                      border: isUser ? 'none' : '1px solid var(--border)',
                      fontSize: 13.5,
                      lineHeight: 1.5,
                      fontWeight: isUser ? 600 : 400,
                    }}
                  >
                    <AssistantMarkdown content={msg.text} isUser={isUser} />
                  </div>
                </div>
              );
            })
          )}

          {running && (
            <div
              style={{
                alignSelf: 'flex-start',
                padding: '10px 14px',
                borderRadius: 12,
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                fontSize: 13,
                color: 'var(--accent)',
                fontWeight: 600,
              }}
            >
              🤖 {activeModelMeta.isAgent ? 'Агент Antigravity планирует шаги и выполняет задачу…' : 'AI ассистент анализирует данные и выполняет инструменты…'}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Поле ввода запроса */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSendPrompt();
          }}
          style={{ display: 'flex', gap: 8 }}
        >
          <input
            className="input"
            style={{ flex: 1 }}
            placeholder="Напишите команду (напр.: «Собери досье на @username», «Удали все кастомные роли», «Проведи диагностику БД»)…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={running}
          />
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: 'auto', padding: '10px 20px' }}
            disabled={running || !input.trim()}
          >
            {running ? 'Выполняется…' : 'Отправить →'}
          </button>
        </form>
      </main>
      <BottomNav />
    </DesktopShell>
  );
}
