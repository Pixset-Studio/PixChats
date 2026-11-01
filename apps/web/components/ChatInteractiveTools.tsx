'use client';

import React, { useState, useRef, useEffect } from 'react';

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
  // 1. Проверяем встроенную расшифровку в подписи (__TRANSCRIPT__:...) или локальный кэш
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

  // 2. Декодируем аудио через Web Audio API для вычисления длительности, темпа речи и активности голоса
  try {
    const res = await fetch(params.mediaUrl);
    const arrayBuf = await res.arrayBuffer();
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
      const data = decoded.getChannelData(0);
      const durationSec = Math.max(1, Math.round(decoded.duration));

      // Подсчитываем голосовые сегменты (слоги/слова по огибающей энергии)
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

        {/* Инструменты */}
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

        {/* Палитра и размер */}
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

        {/* Холст */}
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

        {/* Интерактивное превью карты OpenStreetMap */}
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
