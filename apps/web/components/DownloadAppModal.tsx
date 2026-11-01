'use client';

import { useEffect, useState } from 'react';
import { detectRuntimePlatform } from '../lib/nativePlatform';

const GITHUB_REPO = 'Pixset-Studio/PixChats';
const FALLBACK_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.2.0';

export function openDownloadAppModal(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pixchats:open_download_modal'));
}

interface ReleaseAssetInfo {
  name: string;
  browser_download_url: string;
  size: number;
}

interface ReleaseInfo {
  tag_name: string;
  name: string;
  assets: ReleaseAssetInfo[];
}

export function DownloadAppModal() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [releaseVersion, setReleaseVersion] = useState<string>(`v${FALLBACK_VERSION}`);
  const [exeAsset, setExeAsset] = useState<ReleaseAssetInfo>({
    name: 'PixChats-Setup.exe',
    browser_download_url: `https://github.com/${GITHUB_REPO}/releases/latest/download/PixChats-Setup.exe`,
    size: 0,
  });
  const [apkAsset, setApkAsset] = useState<ReleaseAssetInfo>({
    name: 'PixChats.apk',
    browser_download_url: `https://github.com/${GITHUB_REPO}/releases/latest/download/PixChats.apk`,
    size: 0,
  });
  const [isMobileDevice, setIsMobileDevice] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsMobileDevice(/android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent));

    const handleOpen = () => {
      setOpen(true);
      void fetchLatestAssets();
    };

    window.addEventListener('pixchats:open_download_modal', handleOpen);
    return () => window.removeEventListener('pixchats:open_download_modal', handleOpen);
  }, []);

  async function fetchLatestAssets() {
    setLoading(true);
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=3`, {
        headers: { Accept: 'application/vnd.github.v3+json' },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const list: ReleaseInfo[] = await res.json();
      if (!Array.isArray(list) || list.length === 0) return;
      const latest = list[0];
      if (!latest) return;

      const verMatch = (latest.tag_name || latest.name || '').match(/([0-9]+\.[0-9]+\.[0-9]+)/);
      if (verMatch) {
        setReleaseVersion(`v${verMatch[1]}`);
      }

      const foundExe = latest.assets?.find((a) => a.name.toLowerCase().endsWith('.exe'));
      const foundApk = latest.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));

      if (foundExe) setExeAsset(foundExe);
      if (foundApk) setApkAsset(foundApk);
    } catch {
      // Используем прямые ссылки fallback
    } finally {
      setLoading(false);
    }
  }

  function triggerDownload(asset: ReleaseAssetInfo) {
    const a = document.createElement('a');
    a.href = asset.browser_download_url;
    a.download = asset.name;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  if (!open) return null;

  const runtimePlat = detectRuntimePlatform();
  if (runtimePlat !== 'web') return null;

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)} style={{ zIndex: 9999 }}>
      <div
        className="modal-card"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 480,
          width: '94%',
          padding: 20,
          border: '1px solid rgba(255, 212, 0, 0.35)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.85)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                padding: '3px 9px',
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 700,
                background: 'rgba(255, 212, 0, 0.14)',
                color: 'var(--accent)',
                border: '1px solid rgba(255, 212, 0, 0.3)',
              }}
            >
              ⬇️ Официальные приложения · {releaseVersion}
            </span>
          </div>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: 'auto', padding: '4px 8px', fontSize: 15 }}
            onClick={() => setOpen(false)}
          >
            ✕
          </button>
        </div>

        <h3 style={{ margin: '0 0 6px', fontSize: 19, fontFamily: 'var(--font-display)' }}>
          Скачать приложение PixChats
        </h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Выберите вашу платформу. Нативные приложения для ПК и телефона поддерживают работу в фоне, мгновенные уведомления о звонках и автоматическое самообновление.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
          {/* Карточка Windows (.exe) */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: !isMobileDevice ? 'rgba(255, 212, 0, 0.06)' : 'var(--bg-secondary)',
              border: !isMobileDevice ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 11,
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    flexShrink: 0,
                  }}
                >
                  🖥️
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>PixChats для Windows</span>
                    {!isMobileDevice && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 5,
                          background: 'var(--accent)',
                          color: '#09090b',
                        }}
                      >
                        ДЛЯ ВАШЕГО ПК
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Windows 10 / 11 (x64) • Автообновление и системный трей
                  </div>
                </div>
              </div>
              {exeAsset.size > 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {(exeAsset.size / (1024 * 1024)).toFixed(1)} МБ
                </span>
              )}
            </div>

            <button
              type="button"
              className={!isMobileDevice ? 'btn btn-primary' : 'btn'}
              style={{ width: '100%', padding: '10px 14px', fontWeight: 700, fontSize: 13.5 }}
              onClick={() => triggerDownload(exeAsset)}
            >
              💻 Скачать для Windows (.exe)
            </button>
          </div>

          {/* Карточка Android (.apk) */}
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: isMobileDevice ? 'rgba(255, 212, 0, 0.06)' : 'var(--bg-secondary)',
              border: isMobileDevice ? '1.5px solid var(--accent)' : '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 11,
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 22,
                    flexShrink: 0,
                  }}
                >
                  📱
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 15 }}>PixChats для Android</span>
                    {isMobileDevice && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 5,
                          background: 'var(--accent)',
                          color: '#09090b',
                        }}
                      >
                        ДЛЯ ВАШЕГО ТЕЛЕФОНА
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    Android 8.0+ (.apk) • Пуш-уведомления и установка поверх старой версии
                  </div>
                </div>
              </div>
              {apkAsset.size > 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', flexShrink: 0 }}>
                  {(apkAsset.size / (1024 * 1024)).toFixed(1)} МБ
                </span>
              )}
            </div>

            <button
              type="button"
              className={isMobileDevice ? 'btn btn-primary' : 'btn'}
              style={{ width: '100%', padding: '10px 14px', fontWeight: 700, fontSize: 13.5 }}
              onClick={() => triggerDownload(apkAsset)}
            >
              📲 Скачать для Android (.apk)
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-muted)' }}>
          <span>{loading ? '⏳ Проверка последнего релиза…' : `Актуальная сборка: ${releaseVersion}`}</span>
          <button
            type="button"
            className="btn-ghost"
            style={{ width: 'auto', padding: '5px 12px', fontSize: 12.5 }}
            onClick={() => setOpen(false)}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
