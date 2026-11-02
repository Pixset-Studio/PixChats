'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getCachedCurrentProfile,
  FREE_TIER_AI_MODELS,
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
    label: '📊 Полная статистика приложения',
    prompt: 'Покажи полную живую статистику приложения PixChats и проверь статус систем.',
  },
  {
    label: '❄️ Список замороженных и забаненных',
    prompt: 'Найди всех замороженных и забаненных пользователей и покажи причины их наказаний.',
  },
  {
    label: '⚖️ Проверить апелляции',
    prompt: 'Покажи все поступившие апелляции от пользователей, которые ждут рассмотрения.',
  },
  {
    label: '🚨 Проверить жалобы на сообщения',
    prompt: 'Покажи последние жалобы пользователей на сообщения и скажи, кого нужно проверить.',
  },
  {
    label: '🏷️ Кастомные роли',
    prompt: 'Покажи список всех созданных кастомных ролей в приложении.',
  },
  {
    label: '📜 Журнал аудита и ошибки',
    prompt: 'Покажи последние записи из журнала действий администрации (Audit Log) и ошибки клиентов.',
  },
];

const CHAT_HISTORY_LS_KEY = 'pixchats_dev_ai_chat_history_v1';

export default function DeveloperAiAssistantPage() {
  const router = useRouter();
  const [me, setMe] = useState<Profile | null>(() => getCachedCurrentProfile());
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState<string>(FREE_TIER_AI_MODELS[0].id);
  const [showKeyConfig, setShowKeyConfig] = useState(false);
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
      setConfigNotice('✅ API ключ и выбранная модель Free Tier сохранены!');
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

  return (
    <DesktopShell>
      <main className="container-wide with-bottom-nav" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <header className="app-header" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Полное управление приложением, базой пользователей, ролями, апелляциями и статистикой • Модель:{' '}
              <strong style={{ color: 'var(--accent)' }}>{selectedModel}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              className={showKeyConfig ? 'btn btn-primary' : 'btn'}
              style={{ width: 'auto', padding: '7px 12px', fontSize: 12.5 }}
              onClick={() => setShowKeyConfig((v) => !v)}
            >
              🔑 {apiKey ? 'Настройки API и Модели' : 'Вставить API ключ'}
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

        {/* Панель настройки API ключа и выбора модели Free Tier */}
        {showKeyConfig && (
          <form onSubmit={handleSaveConfig} className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
              ⚙️ Настройка Gemini API ключа и выбор модели (Free Tier)
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
              Вставьте ваш API ключ из Google AI Studio. Выберите любую модель, доступную в бесплатном тарифе (Free Tier). Доступ к этому разделу и инструментам имеют исключительно пользователи с ролью <strong>developer</strong>.
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
              <label style={{ fontWeight: 700, fontSize: 12.5 }}>Модель Free Tier</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
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
                        background: active ? 'rgba(255, 212, 0, 0.1)' : 'var(--bg-secondary)',
                        border: active ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                        color: 'var(--text)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: 13.5 }}>{m.label}</span>
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

        {/* Окно диалога с AI ассистентом и логом вызовов инструментов */}
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
            <div className="empty-state" style={{ margin: 'auto', maxWidth: 520 }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>🤖</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)', marginBottom: 6 }}>
                Системный AI ассистент разработчика готов к работе
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Вы можете попросить его собрать статистику, найти любого пользователя, выдать или снять бан/заморозку/мут, создать новую кастомную роль со своей иконкой, рассмотреть апелляции или опубликовать системное объявление.
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
                    maxWidth: '86%',
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
                      whiteSpace: 'pre-wrap',
                      fontWeight: isUser ? 600 : 400,
                    }}
                  >
                    {msg.text}
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
              🤖 AI ассистент анализирует данные и выполняет инструменты…
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
            placeholder="Напишите команду (напр.: «Создай роль Тестер с иконкой 🧪», «Покажи статистику», «Разморозь @username»)…"
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
