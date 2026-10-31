'use client';

import { useEffect, useState } from 'react';
import { detectRuntimePlatform } from '../lib/nativePlatform';

const CURRENT_VERSION = '0.1.0';
const GITHUB_REPO = 'Pixset-Studio/PixChats';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  assets: ReleaseAsset[];
}

function parseSemver(v: string): number[] {
  return v
    .replace(/^v/, '')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
}

function isNewer(latest: string, current: string): boolean {
  const [lMaj, lMin, lPat] = parseSemver(latest);
  const [cMaj, cMin, cPat] = parseSemver(current);
  if (lMaj > cMaj) return true;
  if (lMaj === cMaj && lMin > cMin) return true;
  if (lMaj === cMaj && lMin === cMin && lPat > cPat) return true;
  return false;
}

export function UpdateNotifier() {
  const [release, setRelease] = useState<GitHubRelease | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [platform, setPlatform] = useState<'desktop-exe' | 'android-apk' | 'web'>('web');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const detected = detectRuntimePlatform();
    setPlatform(detected);
    if (detected === 'web') {
      return; // Автообновления предназначены только для нативных приложений ПК (.exe) и Android (.apk)
    }

    async function checkForUpdates() {
      try {
        const dismissedTag = sessionStorage.getItem('pixchats:dismissed_update');
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`, {
          headers: { Accept: 'application/vnd.github.v3+json' },
        });
        if (!res.ok) return;
        const list: GitHubRelease[] = await res.json();
        const data = Array.isArray(list) ? list[0] : null;
        if (!data || !data.tag_name) return;

        if (data.tag_name === dismissedTag) return;

        if (isNewer(data.tag_name, CURRENT_VERSION)) {
          setRelease(data);
          setShowModal(true);
        }
      } catch {
        // Оффлайн или лимит GitHub API — тихо игнорируем
      }
    }

    checkForUpdates();
    const interval = setInterval(checkForUpdates, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  if (!showModal || !release) return null;

  const versionTag = release.tag_name.replace(/^v/, '');

  function handleDismiss() {
    if (release) {
      sessionStorage.setItem('pixchats:dismissed_update', release.tag_name);
    }
    setShowModal(false);
  }

  async function handleInstallUpdate() {
    if (!release) return;
    setUpdating(true);

    let targetAsset: ReleaseAsset | undefined;

    if (platform === 'desktop-exe') {
      targetAsset = release.assets.find((a) => a.name.toLowerCase().endsWith('.exe'));
    } else if (platform === 'android-apk') {
      targetAsset = release.assets.find((a) => a.name.toLowerCase().endsWith('.apk'));
    }

    const downloadUrl = targetAsset ? targetAsset.browser_download_url : release.html_url;

    // 1. Нативное обновление Windows (.exe): скачивание в %TEMP% и запуск инсталлятора
    if (platform === 'desktop-exe' && window.pixchatsDesktop?.installUpdate && targetAsset) {
      try {
        const ok = await window.pixchatsDesktop.installUpdate(downloadUrl, targetAsset.name);
        if (ok) {
          setUpdating(false);
          setShowModal(false);
          return;
        }
      } catch {
        // fallback ниже
      }
    }

    // 2. Нативное обновление Android (.apk): через Kotlin DownloadManager + Intent.ACTION_VIEW
    if (platform === 'android-apk' && window.PixChatsAndroid?.downloadAndInstallApk && targetAsset) {
      try {
        window.PixChatsAndroid.downloadAndInstallApk(downloadUrl);
        setTimeout(() => {
          setUpdating(false);
          setShowModal(false);
        }, 1500);
        return;
      } catch {
        // fallback ниже
      }
    }

    // 3. Fallback: прямая загрузка
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = targetAsset ? targetAsset.name : 'PixChats-Update';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      setUpdating(false);
      setShowModal(false);
    }, 2500);
  }

  return (
    <div className="update-modal-backdrop" onClick={handleDismiss}>
      <div className="update-modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="update-modal-badge">
          🚀 Доступно обновление
        </div>

        <div className="update-modal-title">
          PixChats v{versionTag}
        </div>
        <div className="update-modal-version">
          У вас установлена версия v{CURRENT_VERSION} · Новая версия готова к установке
        </div>

        {release.body && (
          <div className="update-modal-changelog">
            <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>
              Что нового в обновлении:
            </div>
            {release.body}
          </div>
        )}

        <div className="update-modal-actions">
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, padding: '12px 20px', fontWeight: 600 }}
            onClick={handleInstallUpdate}
            disabled={updating}
          >
            {updating ? 'Установка обновления…' : 'Установить обновление'}
          </button>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '12px 18px' }}
            onClick={handleDismiss}
            disabled={updating}
          >
            Позже
          </button>
        </div>
      </div>
    </div>
  );
}
