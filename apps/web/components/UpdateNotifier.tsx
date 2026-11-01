'use client';

import { useEffect, useState } from 'react';
import { detectRuntimePlatform } from '../lib/nativePlatform';

const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.1.0';
const CURRENT_BUILD_SHA = (process.env.NEXT_PUBLIC_BUILD_SHA || '').trim();
const CURRENT_BUILD_TIMESTAMP = (process.env.NEXT_PUBLIC_BUILD_TIMESTAMP || '').trim();
const GITHUB_REPO = 'Pixset-Studio/PixChats';

export function triggerManualUpdateCheck(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pixchats:check_updates_manual'));
}

interface ReleaseAsset {
  id?: number;
  name: string;
  browser_download_url: string;
  size: number;
  updated_at?: string;
}

interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at?: string;
  created_at?: string;
  assets: ReleaseAsset[];
}

function parseSemver(v: string): number[] {
  return v
    .replace(/^v/i, '')
    .split('.')
    .map((x) => parseInt(x, 10) || 0);
}

function isNewerSemver(latest: string, current: string): boolean {
  const [lMaj, lMin, lPat] = parseSemver(latest);
  const [cMaj, cMin, cPat] = parseSemver(current);
  if (lMaj > cMaj) return true;
  if (lMaj === cMaj && lMin > cMin) return true;
  if (lMaj === cMaj && lMin === cMin && lPat > cPat) return true;
  return false;
}

function extractMetaFromBody(body: string) {
  const versionMatch = body.match(/Версия:\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i) || body.match(/Version:\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i);
  const commitMatch = body.match(/Commit:\s*([a-f0-9]{7,40})/i);
  const timeMatch = body.match(/Build-Time:\s*([^\s\n]+)/i);
  return {
    version: versionMatch ? versionMatch[1] : null,
    commitSha: commitMatch ? commitMatch[1].toLowerCase() : null,
    buildTime: timeMatch ? timeMatch[1] : null,
  };
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

    async function checkForUpdates(isManual = false) {
      const currentPlat = detectRuntimePlatform();
      if (currentPlat === 'web' && !isManual) {
        return; // Автоматическое окно обновления запускается в нативных клиентах (.exe и .apk)
      }

      try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=10`, {
          headers: { Accept: 'application/vnd.github.v3+json' },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const list: GitHubRelease[] = await res.json();
        if (!Array.isArray(list) || list.length === 0) return;

        // Ищем релиз "Lastest Version" (или "Latest Version"), либо берём самый свежий
        const latestRel =
          list.find((r) => {
            const title = (r.name || '').trim().toLowerCase();
            const tag = (r.tag_name || '').trim().toLowerCase();
            return (
              title === 'lastest version' ||
              title === 'latest version' ||
              tag === 'lastest-version' ||
              tag === 'latest'
            );
          }) || list[0];

        if (!latestRel) return;

        const targetAsset =
          currentPlat === 'desktop-exe'
            ? latestRel.assets?.find((a) => a.name.toLowerCase().endsWith('.exe'))
            : currentPlat === 'android-apk'
              ? latestRel.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'))
              : latestRel.assets?.[0];

        const releaseSignature = `${latestRel.id}:${targetAsset?.updated_at || latestRel.published_at || latestRel.tag_name}`;
        const installedSig = localStorage.getItem('pixchats:installed_release_sig');
        if (!isManual && installedSig === releaseSignature) {
          return;
        }

        const meta = extractMetaFromBody(latestRel.body || '');
        const mySha = CURRENT_BUILD_SHA.toLowerCase();

        // Если текущий бинарник (.exe / .apk) собран из того же самого коммита, что и релиз — запоминаем, что версия актуальна
        if (mySha && meta.commitSha && (mySha.startsWith(meta.commitSha) || meta.commitSha.startsWith(mySha))) {
          localStorage.setItem('pixchats:installed_release_sig', releaseSignature);
          if (!isManual) return;
        }

        let needsUpdate = false;

        // 1. Если в релизе указан новый Commit SHA, отличный от текущего бинарника
        if (mySha && meta.commitSha && !mySha.startsWith(meta.commitSha) && !meta.commitSha.startsWith(mySha)) {
          needsUpdate = true;
        }

        // 2. Если версия в релизе или теге выше текущей
        const remoteVer = meta.version || latestRel.tag_name;
        if (remoteVer && isNewerSemver(remoteVer, CURRENT_VERSION)) {
          needsUpdate = true;
        }

        // 3. Сравнение времени публикации релиза "Lastest Version" со временем сборки приложения
        const relTimeStr = targetAsset?.updated_at || meta.buildTime || latestRel.published_at || latestRel.created_at;
        if (relTimeStr && CURRENT_BUILD_TIMESTAMP) {
          const relMs = Date.parse(relTimeStr);
          const buildMs = Date.parse(CURRENT_BUILD_TIMESTAMP);
          // Если релиз опубликован более чем через 15 минут после сборки этого клиента — вышла новая версия!
          if (!Number.isNaN(relMs) && !Number.isNaN(buildMs) && relMs > buildMs + 15 * 60 * 1000) {
            needsUpdate = true;
          }
        }

        // 4. Если старый релиз "Lastest Version" был удалён и создан новый с другим ID
        const lastKnownReleaseId = localStorage.getItem('pixchats:last_known_release_id');
        if (!lastKnownReleaseId) {
          localStorage.setItem('pixchats:last_known_release_id', String(latestRel.id));
        } else if (lastKnownReleaseId !== String(latestRel.id)) {
          needsUpdate = true;
        }

        if (needsUpdate || isManual) {
          setRelease(latestRel);
          setShowModal(true);
        }
      } catch {
        // Оффлайн или лимит GitHub API — тихо игнорируем
      }
    }

    void checkForUpdates(false);
    const interval = setInterval(() => void checkForUpdates(false), 15 * 60 * 1000);

    const onManualCheck = () => void checkForUpdates(true);
    window.addEventListener('pixchats:check_updates_manual', onManualCheck);

    return () => {
      clearInterval(interval);
      window.removeEventListener('pixchats:check_updates_manual', onManualCheck);
    };
  }, []);

  if (!showModal || !release) return null;

  const meta = extractMetaFromBody(release.body || '');
  const displayVersion = meta.version
    ? `v${meta.version}`
    : release.name || release.tag_name || 'Lastest Version';

  const exeAsset = release.assets?.find((a) => a.name.toLowerCase().endsWith('.exe'));
  const apkAsset = release.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
  const targetAsset =
    platform === 'desktop-exe'
      ? exeAsset
      : platform === 'android-apk'
        ? apkAsset
        : exeAsset || apkAsset;

  async function handleInstallUpdate() {
    if (!release) return;
    setUpdating(true);

    const releaseSignature = `${release.id}:${targetAsset?.updated_at || release.published_at || release.tag_name}`;
    localStorage.setItem('pixchats:installed_release_sig', releaseSignature);
    localStorage.setItem('pixchats:last_known_release_id', String(release.id));

    const downloadUrl = targetAsset ? targetAsset.browser_download_url : release.html_url;

    // 1. Нативное обновление Windows (.exe): скачивание в %TEMP% и автоматический запуск инсталлятора
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

    // 2. Нативное обновление Android (.apk): через системный DownloadManager + Intent.ACTION_VIEW
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

    // 3. Прямая загрузка файла обновления (.exe / .apk)
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
    }, 2000);
  }

  return (
    <div className="update-modal-overlay">
      <div className="update-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="update-badge">🚀 Доступна новая версия · {release.name || 'Lastest Version'}</div>

        <h3 style={{ margin: '0 0 6px', fontSize: 19, fontFamily: 'var(--font-display)' }}>
          Вышла новая версия PixChats ({displayVersion})
        </h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Вышло актуальное обновление мессенджера. Для стабильной работы звонков, чатов и защиты данных необходимо обновиться до последней версии.
        </p>

        {targetAsset && (
          <div
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              fontSize: 12.5,
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
              📦 {targetAsset.name}
            </span>
            {targetAsset.size > 0 && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                {(targetAsset.size / (1024 * 1024)).toFixed(1)} МБ
              </span>
            )}
          </div>
        )}

        {release.body && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(0, 0, 0, 0.25)',
              border: '1px solid var(--border)',
              fontSize: 12,
              color: 'var(--text-muted)',
              maxHeight: 130,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              marginBottom: 16,
            }}
          >
            {release.body}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, padding: '11px 18px', fontWeight: 700 }}
            onClick={handleInstallUpdate}
            disabled={updating}
          >
            {updating ? '⏳ Скачивание и запуск обновления…' : '🔄 Обновиться сейчас'}
          </button>
        </div>
      </div>
    </div>
  );
}

