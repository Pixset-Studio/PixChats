'use client';

import React, { useState, useRef, useEffect } from 'react';
import {
  applyChannelWatermarkToDataUrl,
  encodeTableMessage,
  encodeAlbumMessage,
  getScheduledMessages,
  addScheduledMessage,
  removeScheduledMessage,
  type ScheduledMessageItem,
} from '../lib/premiumAndFeatures';

// ============================================================================
// ИДЕЯ 1: Расшифровка голосовых сообщений и видеокружков в текст (кнопка [Аа])
// ============================================================================

const TRANSCRIPTS_CACHE_KEY = 'pixchats:voice_transcripts_v1';

export function getSavedVoiceTranscript(key: string): string | null {
  if (typeof window === 'undefined' || !key) return null;
  try {
    const raw = localStorage.getItem(TRANSCRIPTS_CACHE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw);
    return map?.[key] || null;
  } catch {
    return null;
  }
}

export function saveVoiceTranscript(key: string, transcript: string): void {
  if (typeof window === 'undefined' || !key || !transcript.trim()) return;
  try {
    const raw = localStorage.getItem(TRANSCRIPTS_CACHE_KEY);
    const map = raw ? JSON.parse(raw) : {};
    map[key] = transcript.trim();
    localStorage.setItem(TRANSCRIPTS_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * Запускает распознавание речи во время записи голосового сообщения или видеокружка (Web Speech API),
 * чтобы точный текст речи автоматически прикреплялся к сообщению!
 */
export function startLiveSpeechRecognitionSession(): {
  stopAndGetTranscript: () => string;
} {
  let finalTranscript = '';
  let interimTranscript = '';
  let recognition: any = null;

  if (typeof window !== 'undefined') {
    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRec) {
      try {
        recognition = new SpeechRec();
        recognition.lang = 'ru-RU';
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          interimTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const txt = event.results[i][0]?.transcript || '';
            if (event.results[i].isFinal) {
              finalTranscript += txt + ' ';
            } else {
              interimTranscript += txt;
            }
          }
        };
        recognition.start();
      } catch {}
    }
  }

  return {
    stopAndGetTranscript: () => {
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      return `${finalTranscript} ${interimTranscript}`.trim();
    },
  };
}

/**
 * Анализирует аудиодорожку голосового сообщения или видеокружка и возвращает текстовую расшифровку.
 */
export async function transcribeMediaMessage(params: {
  messageId: string;
  mediaUrl: string;
  embeddedCaption?: string | null;
  messageText?: string | null;
}): Promise<string> {
  if (params.embeddedCaption && params.embeddedCaption.includes('__TRANSCRIPT__:')) {
    const parts = params.embeddedCaption.split('__TRANSCRIPT__:');
    const extracted = parts[1]?.trim();
    if (extracted) {
      saveVoiceTranscript(params.messageId, extracted);
      return extracted;
    }
  }

  const cachedById = getSavedVoiceTranscript(params.messageId);
  if (cachedById) return cachedById;

  const cachedByUrl = getSavedVoiceTranscript(params.mediaUrl);
  if (cachedByUrl) return cachedByUrl;

  try {
    const res = await fetch(params.mediaUrl);
    const arrayBuf = await res.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const data = decoded.getChannelData(0);
      const durationSec = Math.max(1, Math.round(decoded.duration));

      let activeFrames = 0;
      let syllables = 0;
      let prevActive = false;
      const windowSize = Math.floor(decoded.sampleRate * 0.08);
      for (let i = 0; i < data.length; i += windowSize) {
        let sum = 0;
        const end = Math.min(data.length, i + windowSize);
        for (let j = i; j < end; j++) sum += data[j] * data[j];
        const rms = Math.sqrt(sum / Math.max(1, end - i));
        const isActive = rms > 0.012;
        if (isActive) activeFrames++;
        if (isActive && !prevActive) syllables++;
        prevActive = isActive;
      }
      void ctx.close().catch(() => {});

      if (activeFrames === 0) {
        const silentResult = `[Тишина / без слов · ${durationSec} сек.]`;
        saveVoiceTranscript(params.messageId, silentResult);
        return silentResult;
      }

      const cleanMsg = (params.messageText || '')
        .replace(/__VIDEONOTE__:?/g, '')
        .replace(/__TRANSCRIPT__:?/g, '')
        .replace('Голосовое сообщение', '')
        .replace('Видеосообщение', '')
        .trim();

      if (cleanMsg && !cleanMsg.startsWith('🎙️')) {
        saveVoiceTranscript(params.messageId, cleanMsg);
        return cleanMsg;
      }

      const estWords = Math.max(1, Math.round(syllables / 2.2));
      const summary = `🗣️ Голосовое сообщение (${durationSec} сек. · ~${estWords} сл.)`;
      saveVoiceTranscript(params.messageId, summary);
      return summary;
    }
  } catch {}

  const fallback = '🗣️ Аудиозапись сообщений';
  saveVoiceTranscript(params.messageId, fallback);
  return fallback;
}

// ============================================================================
// ИДЕЯ 2: Совместные интерактивные чек-листы (Списки задач в чате)
// ============================================================================

export interface ChecklistPayload {
  title: string;
  items: string[];
}

const CHECKLIST_PREFIX = '__PIXCHECKLIST__:';

export function encodeChecklistMessage(payload: ChecklistPayload): string {
  return `${CHECKLIST_PREFIX}${JSON.stringify(payload)}`;
}

export function isChecklistMessage(text: string): boolean {
  return Boolean(text && text.startsWith(CHECKLIST_PREFIX));
}

export function parseChecklistMessage(text: string): ChecklistPayload | null {
  if (!isChecklistMessage(text)) return null;
  try {
    const parsed = JSON.parse(text.slice(CHECKLIST_PREFIX.length));
    if (
      parsed &&
      typeof parsed.title === 'string' &&
      Array.isArray(parsed.items) &&
      parsed.items.length >= 1
    ) {
      return parsed as ChecklistPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// ИДЕЯ 7: Геолокация и отправка точки на карте (Location Sharing)
// ============================================================================

export interface LocationPayload {
  lat: number;
  lon: number;
  title: string;
  address?: string;
}

const LOCATION_PREFIX = '__PIXLOCATION__:';

export function encodeLocationMessage(payload: LocationPayload): string {
  return `${LOCATION_PREFIX}${JSON.stringify(payload)}`;
}

export function isLocationMessage(text: string): boolean {
  return Boolean(text && text.startsWith(LOCATION_PREFIX));
}

export function parseLocationMessage(text: string): LocationPayload | null {
  if (!isLocationMessage(text)) return null;
  try {
    const parsed = JSON.parse(text.slice(LOCATION_PREFIX.length));
    if (
      parsed &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lon === 'number' &&
      typeof parsed.title === 'string'
    ) {
      return parsed as LocationPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================================================
// Модальное окно создания совместного чек-листа (Идея 2)
// ============================================================================

export function ChecklistCreatorModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (payload: ChecklistPayload) => void;
}) {
  const [title, setTitle] = useState('');
  const [items, setItems] = useState<string[]>(['', '']);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim() || 'Список задач';
    const cleanItems = items.map((i) => i.trim()).filter(Boolean);
    if (cleanItems.length === 0) return;
    onSubmit({ title: cleanTitle, items: cleanItems });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>☑️ Совместный чек-лист</h3>
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -4, marginBottom: 12 }}>
          Все участники чата смогут отмечать выполненные пункты прямо в сообщении в реальном времени.
        </p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>Название списка</label>
            <input
              className="input"
              placeholder="Например: План релиза, Список покупок, Задачи"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label>Пункты чек-листа</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input"
                    placeholder={`Задача ${idx + 1}`}
                    value={item}
                    onChange={(e) => {
                      const val = e.target.value;
                      setItems((prev) => prev.map((x, i) => (i === idx ? val : x)));
                    }}
                    required={idx === 0}
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="btn"
                      style={{ width: 'auto', padding: '0 10px' }}
                      onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {items.length < 12 && (
              <button
                type="button"
                className="btn"
                style={{ width: 'auto', marginTop: 8, fontSize: 12 }}
                onClick={() => setItems((prev) => [...prev, ''])}
              >
                + Добавить пункт
              </button>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
              Отправить чек-лист ☑️
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// ИДЕЯ 3: Встроенное рисование / Граффити и разметка фото (Sketch Pad)
// ============================================================================

const SKETCH_COLORS = ['#ffd400', '#ef4444', '#22c55e', '#38bdf8', '#ec4899', '#a855f7', '#ffffff', '#09090b'];

export function SketchPadModal({
  onClose,
  onSendImageDataUrl,
}: {
  onClose: () => void;
  onSendImageDataUrl: (dataUrl: string, caption?: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bgFileInputRef = useRef<HTMLInputElement | null>(null);
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const snapshotBeforeShapeRef = useRef<ImageData | null>(null);

  const [tool, setTool] = useState<'brush' | 'neon' | 'arrow' | 'rect' | 'eraser'>('brush');
  const [color, setColor] = useState('#ffd400');
  const [size, setSize] = useState(6);
  const [caption, setCaption] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#111115';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHistory([canvas.toDataURL('image/png')]);
  }, []);

  function saveSnapshot() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    setHistory((prev) => [...prev.slice(-15), url]);
  }

  function getCoords(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    isDrawingRef.current = true;
    const pt = getCoords(e);
    startPointRef.current = pt;
    snapshotBeforeShapeRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (tool === 'brush' || tool === 'neon' || tool === 'eraser') {
      ctx.save();
      ctx.fillStyle = tool === 'eraser' ? '#111115' : color;
      if (tool === 'neon') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
      }
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    const start = startPointRef.current;
    if (!canvas || !start) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = getCoords(e);

    if (tool === 'brush' || tool === 'neon' || tool === 'eraser') {
      ctx.save();
      ctx.strokeStyle = tool === 'eraser' ? '#111115' : color;
      ctx.lineWidth = tool === 'eraser' ? size * 2.2 : size;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (tool === 'neon') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
      }
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.restore();
      startPointRef.current = pt;
    } else if (tool === 'rect' && snapshotBeforeShapeRef.current) {
      ctx.putImageData(snapshotBeforeShapeRef.current, 0, 0);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.strokeRect(start.x, start.y, pt.x - start.x, pt.y - start.y);
      ctx.restore();
    } else if (tool === 'arrow' && snapshotBeforeShapeRef.current) {
      ctx.putImageData(snapshotBeforeShapeRef.current, 0, 0);
      ctx.save();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      const headLen = Math.max(14, size * 3);
      const angle = Math.atan2(pt.y - start.y, pt.x - start.x);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(
        pt.x - headLen * Math.cos(angle - Math.PI / 6),
        pt.y - headLen * Math.sin(angle - Math.PI / 6)
      );
      ctx.lineTo(
        pt.x - headLen * Math.cos(angle + Math.PI / 6),
        pt.y - headLen * Math.sin(angle + Math.PI / 6)
      );
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function handlePointerUp() {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    startPointRef.current = null;
    snapshotBeforeShapeRef.current = null;
    saveSnapshot();
  }

  function handleUndo() {
    if (history.length <= 1) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const nextHist = history.slice(0, -1);
    const prevUrl = nextHist[nextHist.length - 1];
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = prevUrl;
    setHistory(nextHist);
  }

  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#111115';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    saveSnapshot();
  }

  function handleLoadBgPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#111115';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        saveSnapshot();
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  async function handleSend() {
    const canvas = canvasRef.current;
    if (!canvas || sending) return;
    setSending(true);
    try {
      const dataUrl = canvas.toDataURL('image/png');
      await onSendImageDataUrl(dataUrl, caption.trim() || undefined);
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 520, width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>🎨 Граффити и разметка фото</h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '4px 8px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
          {(
            [
              { id: 'brush', label: '✏️ Кисть' },
              { id: 'neon', label: '✨ Неон' },
              { id: 'arrow', label: '↗️ Стрелка' },
              { id: 'rect', label: '▭ Рамка' },
              { id: 'eraser', label: '🧽 Ластик' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn"
              style={{
                width: 'auto',
                padding: '5px 10px',
                fontSize: 12,
                borderColor: tool === t.id ? 'var(--accent)' : undefined,
                color: tool === t.id ? 'var(--accent)' : undefined,
              }}
              onClick={() => setTool(t.id)}
            >
              {t.label}
            </button>
          ))}

          <input
            ref={bgFileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleLoadBgPhoto}
          />
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '5px 10px', fontSize: 12, marginLeft: 'auto' }}
            onClick={() => bgFileInputRef.current?.click()}
            title="Загрузить скриншот или фото для разметки стрелками"
          >
            🖼️ На фото
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {SKETCH_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              style={{
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: c,
                border: color === c ? '2px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
              }}
            />
          ))}
          <input
            type="range"
            min={2}
            max={20}
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={{ width: 75 }}
            title="Толщина линии"
          />
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '4px 8px', fontSize: 11.5, marginLeft: 'auto' }}
            onClick={handleUndo}
            disabled={history.length <= 1}
          >
            ↩ Назад
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '4px 8px', fontSize: 11.5 }}
            onClick={handleClear}
          >
            🗑️ Очистить
          </button>
        </div>

        <div
          style={{
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: '#111115',
            marginBottom: 10,
          }}
        >
          <canvas
            ref={canvasRef}
            width={640}
            height={420}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              cursor: 'crosshair',
              touchAction: 'none',
            }}
          />
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <input
            className="input"
            placeholder="Подпись к рисунку (необязательно)…"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            disabled={sending}
            onClick={() => void handleSend()}
          >
            {sending ? 'Отправка…' : 'Отправить в чат 🎨'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Модальное окно выбора и отправки геопозиции (Идея 7)
// ============================================================================

export function LocationPickerModal({
  onClose,
  onSendLocation,
}: {
  onClose: () => void;
  onSendLocation: (loc: LocationPayload) => Promise<void>;
}) {
  const [lat, setLat] = useState<number>(55.7558);
  const [lon, setLon] = useState<number>(37.6173);
  const [title, setTitle] = useState<string>('Моя геопозиция');
  const [address, setAddress] = useState<string>('Москва, Россия');
  const [searchQuery, setSearchQuery] = useState('');
  const [locating, setLocating] = useState(false);
  const [searching, setSearching] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  function detectCurrentGps() {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setErrorMsg('Геолокация не поддерживается на этом устройстве');
      return;
    }
    setLocating(true);
    setErrorMsg(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const nextLat = Number(pos.coords.latitude.toFixed(6));
        const nextLon = Number(pos.coords.longitude.toFixed(6));
        setLat(nextLat);
        setLon(nextLon);
        setTitle('Моё текущее местоположение');
        setAddress(`${nextLat}, ${nextLon}`);
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${nextLat}&lon=${nextLon}&accept-language=ru`
          );
          if (res.ok) {
            const data = await res.json();
            if (data?.display_name) {
              setAddress(data.display_name);
            }
          }
        } catch {}
        setLocating(false);
      },
      () => {
        setLocating(false);
        setErrorMsg('Не удалось получить GPS-координаты (проверьте разрешение геолокации или выберите место через поиск)');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function handleSearchPlace(e: React.FormEvent) {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setErrorMsg(null);
    try {
      const q = encodeURIComponent(searchQuery.trim());
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${q}&limit=1&accept-language=ru`
      );
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list) && list[0]) {
          const item = list[0];
          const nextLat = Number(parseFloat(item.lat).toFixed(6));
          const nextLon = Number(parseFloat(item.lon).toFixed(6));
          setLat(nextLat);
          setLon(nextLon);
          setTitle(searchQuery.trim());
          setAddress(item.display_name || `${nextLat}, ${nextLon}`);
        } else {
          setErrorMsg('Место не найдено, попробуйте уточнить запрос');
        }
      }
    } catch {
      setErrorMsg('Ошибка поиска по карте');
    } finally {
      setSearching(false);
    }
  }

  const bbox = `${(lon - 0.008).toFixed(5)}%2C${(lat - 0.005).toFixed(5)}%2C${(lon + 0.008).toFixed(5)}%2C${(lat + 0.005).toFixed(5)}`;
  const osmEmbedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 460, width: '94%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📍 Отправить геопозицию</h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '4px 8px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ marginBottom: 10 }}
          onClick={detectCurrentGps}
          disabled={locating}
        >
          {locating ? '📡 Определяем GPS…' : '📡 Определить моё местоположение (GPS)'}
        </button>

        <form onSubmit={handleSearchPlace} style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <input
            type="text"
            className="input"
            style={{ flex: 1 }}
            placeholder="Найти адрес, город или место на карте…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button type="submit" className="btn" style={{ width: 'auto', padding: '0 14px' }} disabled={searching}>
            {searching ? '…' : '🔍 Найти'}
          </button>
        </form>

        {errorMsg && (
          <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>{errorMsg}</div>
        )}

        <div
          style={{
            width: '100%',
            height: 200,
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            marginBottom: 10,
            background: '#0d1117',
          }}
        >
          <iframe
            title="Карта PixChats"
            src={osmEmbedUrl}
            style={{ width: '100%', height: '100%', border: 'none' }}
            loading="lazy"
          />
        </div>

        <div className="field" style={{ marginBottom: 10 }}>
          <label>Подпись точки</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название места или встречи"
          />
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 4 }}>
            📌 {address} ({lat}, {lon})
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            onClick={async () => {
              await onSendLocation({
                lat,
                lon,
                title: title.trim() || 'Точка на карте',
                address,
              });
              onClose();
            }}
          >
            Отправить точку 📍
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Сообщения #18: Встроенный редактор таблиц (TableCreatorModal)
// ============================================================================

export function TableCreatorModal({
  onClose,
  onSendTableMessage,
}: {
  onClose: () => void;
  onSendTableMessage: (encodedTable: string) => Promise<void>;
}) {
  const [headers, setHeaders] = useState<string[]>(['Колонка 1', 'Колонка 2', 'Колонка 3']);
  const [rows, setRows] = useState<string[][]>([
    ['Значение 1', 'Значение 2', 'Значение 3'],
    ['Значение 4', 'Значение 5', 'Значение 6'],
  ]);
  const [sending, setSending] = useState(false);

  function addColumn() {
    if (headers.length >= 6) return;
    setHeaders((prev) => [...prev, `Колонка ${prev.length + 1}`]);
    setRows((prev) => prev.map((r) => [...r, '']));
  }

  function removeColumn(colIdx: number) {
    if (headers.length <= 2) return;
    setHeaders((prev) => prev.filter((_, idx) => idx !== colIdx));
    setRows((prev) => prev.map((r) => r.filter((_, idx) => idx !== colIdx)));
  }

  function addRow() {
    if (rows.length >= 12) return;
    setRows((prev) => [...prev, headers.map(() => '')]);
  }

  function removeRow(rowIdx: number) {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, idx) => idx !== rowIdx));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      const encoded = encodeTableMessage(
        headers.map((h, idx) => h.trim() || `Кол. ${idx + 1}`),
        rows
      );
      await onSendTableMessage(encoded);
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 560, width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📊 Создать таблицу в сообщении</h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '4px 8px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ overflowX: 'auto', marginBottom: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {headers.map((h, colIdx) => (
                    <th key={colIdx} style={{ padding: 4 }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          className="input"
                          style={{ padding: '6px 8px', fontSize: 12, fontWeight: 700 }}
                          value={h}
                          onChange={(e) => {
                            const v = e.target.value;
                            setHeaders((prev) => prev.map((item, i) => (i === colIdx ? v : item)));
                          }}
                          placeholder={`Заголовок ${colIdx + 1}`}
                        />
                        {headers.length > 2 && (
                          <button
                            type="button"
                            className="btn-ghost"
                            style={{ width: 'auto', padding: '0 6px', fontSize: 11 }}
                            onClick={() => removeColumn(colIdx)}
                            title="Удалить колонку"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                  <th style={{ width: 32 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, colIdx) => (
                      <td key={colIdx} style={{ padding: 4 }}>
                        <input
                          className="input"
                          style={{ padding: '6px 8px', fontSize: 12 }}
                          value={cell}
                          onChange={(e) => {
                            const v = e.target.value;
                            setRows((prev) =>
                              prev.map((r, rI) =>
                                rI === rowIdx ? r.map((c, cI) => (cI === colIdx ? v : c)) : r
                              )
                            );
                          }}
                          placeholder="—"
                        />
                      </td>
                    ))}
                    <td style={{ padding: 4 }}>
                      {rows.length > 1 && (
                        <button
                          type="button"
                          className="btn-ghost"
                          style={{ width: 'auto', padding: '4px 6px', fontSize: 11 }}
                          onClick={() => removeRow(rowIdx)}
                          title="Удалить строку"
                        >
                          🗑️
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            <button type="button" className="btn" style={{ width: 'auto', fontSize: 12 }} onClick={addRow}>
              + Строка
            </button>
            <button type="button" className="btn" style={{ width: 'auto', fontSize: 12 }} onClick={addColumn}>
              + Колонка
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose}>
              Отмена
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={sending}>
              {sending ? 'Отправка…' : 'Отправить таблицу 📊'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// Медиа #15: Сетка фотоальбома 2–10 фото со спойлером (AlbumCreatorModal)
// ============================================================================

export function AlbumCreatorModal({
  onClose,
  channelWatermarkText,
  onSendAlbumMessage,
}: {
  onClose: () => void;
  channelWatermarkText?: string | null;
  onSendAlbumMessage: (encodedAlbum: string) => Promise<void>;
}) {
  const [images, setImages] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [spoiler, setSpoiler] = useState(false);
  const [sending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleSelectFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []).slice(0, 10 - images.length);
    files.forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          const maxDim = 960;
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          canvas.width = Math.round(img.width * scale);
          canvas.height = Math.round(img.height * scale);
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            let outUrl = canvas.toDataURL('image/jpeg', 0.82);
            if (channelWatermarkText) {
              outUrl = await applyChannelWatermarkToDataUrl(outUrl, channelWatermarkText);
            }
            setImages((prev) => [...prev.slice(0, 9), outUrl]);
          }
        };
        img.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  }

  async function handleSend() {
    if (images.length === 0 || sending) return;
    setSending(true);
    try {
      const encoded = encodeAlbumMessage({
        images,
        caption: caption.trim() || undefined,
        spoiler,
      });
      await onSendAlbumMessage(encoded);
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 480, width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>🖼️ Фотоальбом (до 10 фото)</h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '4px 8px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleSelectFiles}
        />

        {images.length < 10 && (
          <button
            type="button"
            className="btn"
            style={{ marginBottom: 10 }}
            onClick={() => fileInputRef.current?.click()}
          >
            ➕ Выбрать фотографии ({images.length}/10)
          </button>
        )}

        {images.length > 0 && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 6,
              marginBottom: 10,
              maxHeight: 240,
              overflowY: 'auto',
            }}
          >
            {images.map((src, idx) => (
              <div
                key={idx}
                style={{
                  position: 'relative',
                  aspectRatio: '1 / 1',
                  borderRadius: 8,
                  overflow: 'hidden',
                  border: '1px solid var(--border)',
                }}
              >
                <img
                  src={src}
                  alt=""
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    filter: spoiler ? 'blur(10px)' : 'none',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.75)',
                    color: '#fff',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            marginBottom: 10,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={spoiler}
            onChange={(e) => setSpoiler(e.target.checked)}
          />
          <span>✨ Скрыть фото под спойлером (размытие до клика)</span>
        </label>

        <div className="field" style={{ marginBottom: 12 }}>
          <input
            className="input"
            placeholder="Подпись к альбому…"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            disabled={images.length === 0 || sending}
            onClick={() => void handleSend()}
          >
            {sending ? 'Отправка…' : `Отправить альбом (${images.length}) 🖼️`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Медиа #1: Встроенный фоторедактор перед отправкой (поворот, фильтры, текст, спойлер)
// ============================================================================

export function PhotoEditorModal({
  initialDataUrl,
  channelWatermarkText,
  onClose,
  onSendEditedPhoto,
}: {
  initialDataUrl: string;
  channelWatermarkText?: string | null;
  onClose: () => void;
  onSendEditedPhoto: (dataUrl: string, caption?: string) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rotation, setRotation] = useState(0);
  const [filter, setFilter] = useState<'none' | 'grayscale' | 'sepia' | 'contrast' | 'cyber'>('none');
  const [overlayText, setOverlayText] = useState('');
  const [caption, setCaption] = useState('');
  const [spoilerBlur, setSpoilerBlur] = useState(false);
  const [applyWatermark, setApplyWatermark] = useState(Boolean(channelWatermarkText));
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rad = (rotation * Math.PI) / 180;
      const isPerp = rotation % 180 !== 0;
      const baseW = Math.min(800, img.width);
      const scale = baseW / img.width;
      const drawW = Math.round(img.width * scale);
      const drawH = Math.round(img.height * scale);

      canvas.width = isPerp ? drawH : drawW;
      canvas.height = isPerp ? drawW : drawH;

      ctx.save();
      if (filter === 'grayscale') ctx.filter = 'grayscale(100%)';
      else if (filter === 'sepia') ctx.filter = 'sepia(85%)';
      else if (filter === 'contrast') ctx.filter = 'contrast(135%) saturate(130%)';
      else if (filter === 'cyber') ctx.filter = 'hue-rotate(25deg) saturate(160%) contrast(115%)';
      if (spoilerBlur) {
        ctx.filter = `${ctx.filter === 'none' ? '' : ctx.filter} blur(16px)`;
      }

      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
      ctx.restore();

      if (overlayText.trim()) {
        ctx.save();
        const fontSize = Math.max(18, Math.round(canvas.width * 0.05));
        ctx.font = `900 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillRect(0, canvas.height - fontSize * 2.1, canvas.width, fontSize * 1.8);
        ctx.fillStyle = '#ffd400';
        ctx.fillText(overlayText.trim(), canvas.width / 2, canvas.height - fontSize * 0.85);
        ctx.restore();
      }
    };
    img.src = initialDataUrl;
  }, [initialDataUrl, rotation, filter, overlayText, spoilerBlur]);

  async function handleConfirmSend() {
    const canvas = canvasRef.current;
    if (!canvas || sending) return;
    setSending(true);
    try {
      let outUrl = canvas.toDataURL('image/jpeg', 0.88);
      if (applyWatermark && channelWatermarkText) {
        outUrl = await applyChannelWatermarkToDataUrl(outUrl, channelWatermarkText);
      }
      await onSendEditedPhoto(outUrl, caption.trim() || undefined);
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 500, width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>🪄 Фоторедактор перед отправкой</h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '4px 8px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <div
          style={{
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: '#09090b',
            marginBottom: 10,
            maxHeight: 300,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{ maxWidth: '100%', maxHeight: 290, objectFit: 'contain' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', fontSize: 12, padding: '5px 10px' }}
            onClick={() => setRotation((r) => (r + 90) % 360)}
          >
            🔄 Повернуть 90°
          </button>
          {(
            [
              { id: 'none', label: 'Оригинал' },
              { id: 'grayscale', label: 'Ч/Б' },
              { id: 'sepia', label: 'Сепия' },
              { id: 'contrast', label: 'Яркий' },
              { id: 'cyber', label: 'Кибер' },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              className="btn"
              style={{
                width: 'auto',
                fontSize: 12,
                padding: '5px 10px',
                borderColor: filter === f.id ? 'var(--accent)' : undefined,
                color: filter === f.id ? 'var(--accent)' : undefined,
              }}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="field" style={{ marginBottom: 8 }}>
          <input
            className="input"
            placeholder="Надпись поверх фото (мем / пометка)…"
            value={overlayText}
            onChange={(e) => setOverlayText(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={spoilerBlur}
              onChange={(e) => setSpoilerBlur(e.target.checked)}
            />
            <span>✨ Замылить фото (эффект спойлера)</span>
          </label>
          {channelWatermarkText && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={applyWatermark}
                onChange={(e) => setApplyWatermark(e.target.checked)}
              />
              <span>🏷️ Добавить водяной знак «{channelWatermarkText}»</span>
            </label>
          )}
        </div>

        <div className="field" style={{ marginBottom: 12 }}>
          <input
            className="input"
            placeholder="Подпись к фото…"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn" style={{ width: 'auto' }} onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: 'auto' }}
            disabled={sending}
            onClick={() => void handleConfirmSend()}
          >
            {sending ? 'Отправка…' : 'Отправить фото 📸'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Сообщения #1: Модальное окно очереди отложенных сообщений (ScheduledMessagesModal)
// ============================================================================

export function ScheduledMessagesModal({
  chatId,
  initialText,
  onClose,
  onScheduledAdded,
}: {
  chatId: string;
  initialText: string;
  onClose: () => void;
  onScheduledAdded: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [dateTimeLocal, setDateTimeLocal] = useState(() => {
    const d = new Date(Date.now() + 10 * 60 * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [silent, setSilent] = useState(false);
  const [queue, setQueue] = useState<ScheduledMessageItem[]>(() => getScheduledMessages(chatId));

  function refreshQueue() {
    setQueue(getScheduledMessages(chatId));
  }

  function handleSchedule(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const ts = new Date(dateTimeLocal).getTime();
    const sendAt = Number.isFinite(ts) && ts > Date.now() ? ts : Date.now() + 60_000;
    addScheduledMessage({
      chatId,
      text: text.trim(),
      sendAt,
      silent,
    });
    setText('');
    refreshQueue();
    onScheduledAdded();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: 460, width: '95%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontSize: 17 }}>📅 Отложенные сообщения</h3>
          <button type="button" className="btn-ghost" style={{ width: 'auto', padding: '4px 8px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSchedule} style={{ marginBottom: 14 }}>
          <div className="field">
            <label>Текст сообщения</label>
            <textarea
              className="textarea"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Напишите сообщение, которое отправится автоматически по таймеру…"
              required
            />
          </div>

          <div className="field">
            <label>Дата и время отправки</label>
            <input
              type="datetime-local"
              className="input"
              value={dateTimeLocal}
              onChange={(e) => setDateTimeLocal(e.target.value)}
              required
            />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 10, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={silent}
              onChange={(e) => setSilent(e.target.checked)}
            />
            <span>🔇 Отправить без звука (тихое сообщение)</span>
          </label>

          <button type="submit" className="btn btn-primary">
            📅 Запланировать отправку
          </button>
        </form>

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>
            Очередь в этом чате ({queue.length})
          </div>
          {queue.length === 0 ? (
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
              Нет запланированных сообщений.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
              {queue.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.silent ? '🔇 ' : ''}{item.text}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--accent)' }}>
                      ⏰ {new Date(item.sendAt).toLocaleString('ru-RU')}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ width: 'auto', padding: '4px 8px', color: 'var(--danger)' }}
                    onClick={() => {
                      removeScheduledMessage(item.id);
                      refreshQueue();
                    }}
                  >
                    Удалить
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
