'use client';

import React, { useMemo, useState } from 'react';
import { generateValidQrMatrix } from '../lib/qrCodeGenerator';

export interface QrCodeModalProps {
  title: string;
  subtitle?: string;
  avatarUrl?: string | null;
  url: string;
  badgeText?: string;
  onClose: () => void;
}

interface QrTheme {
  id: string;
  name: string;
  cardBg: string;
  fgColor: string;
  accentColor: string;
}

const QR_THEMES: QrTheme[] = [
  {
    id: 'gold',
    name: 'PixGold',
    cardBg: 'linear-gradient(135deg, #18181b 0%, #2e2605 100%)',
    fgColor: '#09090b',
    accentColor: '#ffd400',
  },
  {
    id: 'cyber',
    name: 'Киберпанк',
    cardBg: 'linear-gradient(135deg, #0f172a 0%, #311042 100%)',
    fgColor: '#1e1b4b',
    accentColor: '#38bdf8',
  },
  {
    id: 'emerald',
    name: 'Изумруд',
    cardBg: 'linear-gradient(135deg, #052e16 0%, #064e3b 100%)',
    fgColor: '#064e3b',
    accentColor: '#34d399',
  },
  {
    id: 'crimson',
    name: 'Рубин',
    cardBg: 'linear-gradient(135deg, #2a0a18 0%, #4c0519 100%)',
    fgColor: '#4c0519',
    accentColor: '#fb7185',
  },
];

export function QrCodeModal({
  title,
  subtitle,
  avatarUrl,
  url,
  badgeText = 'PixChats QR',
  onClose,
}: QrCodeModalProps) {
  const [selectedTheme, setSelectedTheme] = useState<QrTheme>(QR_THEMES[0]);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const matrix = useMemo(() => generateValidQrMatrix(url || 'https://pixchats.vercel.app'), [url]);
  const quietZone = 4;
  const totalModules = matrix.length + quietZone * 2;

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  async function handleDownloadPng() {
    setDownloading(true);
    try {
      const canvas = document.createElement('canvas');
      const width = 720;
      const height = 920;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Card background
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#121217');
      grad.addColorStop(1, '#1e1b2e');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Border frame
      ctx.strokeStyle = selectedTheme.accentColor;
      ctx.lineWidth = 8;
      ctx.strokeRect(24, 24, width - 48, height - 48);

      // Header title
      ctx.fillStyle = selectedTheme.accentColor;
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(badgeText.toUpperCase(), width / 2, 86);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 38px sans-serif';
      ctx.fillText((title || 'PixChats').slice(0, 28), width / 2, 142);

      if (subtitle) {
        ctx.fillStyle = '#a1a1aa';
        ctx.font = '26px sans-serif';
        ctx.fillText(subtitle.slice(0, 36), width / 2, 184);
      }

      // White QR container with quiet zone
      const qrBoxSize = 500;
      const qrBoxX = Math.floor((width - qrBoxSize) / 2);
      const qrBoxY = 230;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(qrBoxX, qrBoxY, qrBoxSize, qrBoxSize, 28);
      ctx.fill();

      const scale = qrBoxSize / totalModules;
      ctx.fillStyle = '#000000';
      for (let r = 0; r < matrix.length; r++) {
        for (let c = 0; c < matrix[r].length; c++) {
          if (matrix[r][c]) {
            const x = Math.floor(qrBoxX + (c + quietZone) * scale);
            const y = Math.floor(qrBoxY + (r + quietZone) * scale);
            const w = Math.ceil(scale);
            const h = Math.ceil(scale);
            ctx.fillRect(x, y, w, h);
          }
        }
      }

      // Footer URL
      ctx.fillStyle = '#e4e4e7';
      ctx.font = '20px monospace';
      const displayUrl = url.length > 48 ? url.slice(0, 45) + '...' : url;
      ctx.fillText(displayUrl, width / 2, 795);

      ctx.fillStyle = selectedTheme.accentColor;
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('Наведите камеру телефона для перехода в PixChats', width / 2, 845);

      const dataUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `pixchats-qr-${(subtitle || title || 'card').replace(/[^a-zA-Z0-9_-]/g, '') || 'card'}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(0, 0, 0, 0.78)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 400,
          borderRadius: 24,
          background: selectedTheme.cardBg,
          border: `2px solid ${selectedTheme.accentColor}`,
          boxShadow: '0 24px 60px rgba(0,0,0,0.65)',
          padding: 22,
          color: '#ffffff',
          textAlign: 'center',
          position: 'relative',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(0,0,0,0.35)',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 16,
          }}
          title="Закрыть"
        >
          ✕
        </button>

        <div
          style={{
            display: 'inline-block',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '4px 12px',
            borderRadius: 999,
            background: 'rgba(255,255,255,0.1)',
            color: selectedTheme.accentColor,
            marginBottom: 10,
          }}
        >
          {badgeText}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 4 }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={title}
              style={{
                width: 42,
                height: 42,
                borderRadius: '50%',
                objectFit: 'cover',
                border: `2px solid ${selectedTheme.accentColor}`,
              }}
            />
          ) : null}
          <div style={{ textAlign: avatarUrl ? 'left' : 'center' }}>
            <div style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.2 }}>{title}</div>
            {subtitle && (
              <div style={{ fontSize: 13, color: selectedTheme.accentColor, fontWeight: 600 }}>{subtitle}</div>
            )}
          </div>
        </div>

        {/* High-contrast ISO/IEC 18004 QR Code with 4-module quiet zone */}
        <div
          style={{
            display: 'inline-flex',
            background: '#ffffff',
            padding: 12,
            borderRadius: 20,
            border: `3px solid ${selectedTheme.accentColor}`,
            boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
            margin: '14px 0',
          }}
        >
          <svg
            width={220}
            height={220}
            viewBox={`0 0 ${totalModules} ${totalModules}`}
            shapeRendering="crispEdges"
          >
            <rect width={totalModules} height={totalModules} fill="#ffffff" />
            {matrix.map((row, r) =>
              row.map((cell, c) =>
                cell ? (
                  <rect
                    key={`${r}-${c}`}
                    x={c + quietZone}
                    y={r + quietZone}
                    width={1}
                    height={1}
                    fill={selectedTheme.fgColor}
                  />
                ) : null
              )
            )}
          </svg>
        </div>

        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.75)', marginBottom: 12 }}>
          Наведите любую камеру телефона для мгновенного сканирования
        </div>

        {/* Theme switcher */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 14 }}>
          {QR_THEMES.map((theme) => (
            <button
              key={theme.id}
              type="button"
              onClick={() => setSelectedTheme(theme)}
              style={{
                padding: '5px 10px',
                borderRadius: 10,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                border:
                  selectedTheme.id === theme.id
                    ? `2px solid ${theme.accentColor}`
                    : '1px solid rgba(255,255,255,0.2)',
                background:
                  selectedTheme.id === theme.id ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.28)',
                color: '#fff',
              }}
            >
              {theme.name}
            </button>
          ))}
        </div>

        {/* URL display & action buttons */}
        <div
          style={{
            fontSize: 11,
            fontFamily: 'monospace',
            background: 'rgba(0,0,0,0.35)',
            padding: '7px 10px',
            borderRadius: 10,
            marginBottom: 12,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: '#d4d4d8',
          }}
        >
          {url}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-compact"
            onClick={handleCopyUrl}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.14)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.25)',
            }}
          >
            {copied ? '✅ Скопировано' : '🔗 Копировать ссылку'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={handleDownloadPng}
            disabled={downloading}
            style={{
              flex: 1,
              background: selectedTheme.accentColor,
              color: '#09090b',
              fontWeight: 800,
            }}
          >
            {downloading ? 'Сохранение…' : '📥 Скачать PNG'}
          </button>
        </div>
      </div>
    </div>
  );
}
