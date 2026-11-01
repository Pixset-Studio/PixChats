'use client';

import { useEffect, useState } from 'react';
import { detectRuntimePlatform } from '../lib/nativePlatform';

const CURRENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || '0.2.0';
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
    .replace(/^[^0-9]*/i, '')
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
  const versionMatch =
    body.match(/Версия:\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i) ||
    body.match(/Version:\s*v?([0-9]+\.[0-9]+\.[0-9]+)/i);
  const commitMatch = body.match(/Commit:\s*([a-f0-9]{7,40})/i);
  const timeMatch = body.match(/Build-Time:\s*([^\s\n]+)/i);

  // Извлекаем пункты «Что нового» из текста релиза
  const lines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      if (/^(---|###|📦|Актуальная сборка)/i.test(l)) return false;
      if (/^-\s*(Версия|Version|Commit|Build-Time):/i.test(l)) return false;
      return true;
    })
    .map((l) => l.replace(/^[•*-]\s*/, '').trim())
    .filter(Boolean);

  return {
    version: versionMatch ? versionMatch[1] : null,
    commitSha: commitMatch ? commitMatch[1].toLowerCase() : null,
    buildTime: timeMatch ? timeMatch[1] : null,
    changelogItems: lines,
  };
}

export function UpdateNotifier() {
  const [release, setRelease] = useState<GitHubRelease | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [progressStatus, setProgressStatus] = useState<'idle' | 'downloading' | 'installing'>('idle');
  const [platform, setPlatform] = useState<'desktop-exe' | 'android-apk' | 'web'>('web');

  async function executeAutoInstall(rel: GitHubRelease, currentPlat: 'desktop-exe' | 'android-apk' | 'web') {
    setUpdating(true);
    setProgressPercent(4);
    setProgressStatus('downloading');

    const exeAsset = rel.assets?.find((a) => a.name.toLowerCase().endsWith('.exe'));
    const apkAsset = rel.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
    const targetAsset =
      currentPlat === 'desktop-exe'
        ? exeAsset
        : currentPlat === 'android-apk'
          ? apkAsset
          : exeAsset || apkAsset;

    const releaseSignature = `${rel.id}:${targetAsset?.updated_at || rel.published_at || rel.tag_name}`;
    localStorage.setItem('pixchats:installed_release_sig', releaseSignature);
    localStorage.setItem('pixchats:last_known_release_id', String(rel.id));

    const downloadUrl = targetAsset ? targetAsset.browser_download_url : rel.html_url;

    // 1. Нативное автообновление Windows (.exe): тихое скачивание в %TEMP%, тихая самоустановка (/S) и автоматический перезапуск
    if (currentPlat === 'desktop-exe' && window.pixchatsDesktop?.installUpdate && targetAsset) {
      try {
        const ok = await window.pixchatsDesktop.installUpdate(downloadUrl, targetAsset.name);
        if (ok) {
          setProgressPercent(100);
          setProgressStatus('installing');
          return;
        }
      } catch {
        // fallback ниже
      }
    }

    // 2. Нативное автообновление Android (.apk): автоматическое скачивание и самоустановка через PackageInstaller Session API
    if (currentPlat === 'android-apk' && window.PixChatsAndroid?.downloadAndInstallApk && targetAsset) {
      try {
        window.PixChatsAndroid.downloadAndInstallApk(downloadUrl);
        return;
      } catch {
        // fallback ниже
      }
    }

    // 3. Fallback — прямая автоматическая загрузка пакета обновления
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = targetAsset ? targetAsset.name : 'PixChats-Update';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setProgressPercent(100);
    setProgressStatus('installing');
    setTimeout(() => {
      setUpdating(false);
      setShowModal(false);
    }, 3500);
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const detected = detectRuntimePlatform();
    setPlatform(detected);

    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent<{ percent?: number; status?: 'downloading' | 'installing' }>).detail;
      if (!detail) return;
      if (typeof detail.percent === 'number') {
        setProgressPercent(Math.max(0, Math.min(100, detail.percent)));
      }
      if (detail.status) {
        setProgressStatus(detail.status);
      }
      if (detail.percent === 100 && detail.status === 'installing') {
        setTimeout(() => {
          setUpdating(false);
          setShowModal(false);
        }, 4500);
      }
    };

    window.addEventListener('pixchats:update_progress', onProgress);

    async function checkForUpdates(isManual = false) {
      const currentPlat = detectRuntimePlatform();
      if (currentPlat === 'web' && !isManual) {
        return; // Автоматическая самоустановка работает в нативных клиентах (.exe и .apk)
      }

      try {
        const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=5`, {
          headers: { Accept: 'application/vnd.github.v3+json' },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const list: GitHubRelease[] = await res.json();
        if (!Array.isArray(list) || list.length === 0) return;

        // Берём самый свежий опубликованный релиз с конкретной версией
        const latestRel = list[0];
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
        const remoteVer = meta.version || latestRel.tag_name || latestRel.name;
        if (remoteVer && isNewerSemver(remoteVer, CURRENT_VERSION)) {
          needsUpdate = true;
        }

        // 3. Сравнение времени публикации релиза со временем сборки приложения
        const relTimeStr = targetAsset?.updated_at || meta.buildTime || latestRel.published_at || latestRel.created_at;
        if (relTimeStr && CURRENT_BUILD_TIMESTAMP) {
          const relMs = Date.parse(relTimeStr);
          const buildMs = Date.parse(CURRENT_BUILD_TIMESTAMP);
          if (!Number.isNaN(relMs) && !Number.isNaN(buildMs) && relMs > buildMs + 15 * 60 * 1000) {
            needsUpdate = true;
          }
        }

        // 4. Если вышел новый релиз с другим ID или тегом
        const lastKnownReleaseId = localStorage.getItem('pixchats:last_known_release_id');
        if (!lastKnownReleaseId) {
          localStorage.setItem('pixchats:last_known_release_id', String(latestRel.id));
        } else if (lastKnownReleaseId !== String(latestRel.id)) {
          needsUpdate = true;
        }

        if (needsUpdate || isManual) {
          setRelease(latestRel);
          setShowModal(true);

          // На ПК и телефоне сразу автоматически запускаем скачивание и самоустановку новой версии без лишних кликов!
          if (needsUpdate && (currentPlat === 'desktop-exe' || currentPlat === 'android-apk')) {
            void executeAutoInstall(latestRel, currentPlat);
          }
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
      window.removeEventListener('pixchats:update_progress', onProgress);
    };
  }, []);

  if (!showModal || !release) return null;

  const meta = extractMetaFromBody(release.body || '');
  const versionNumber =
    meta.version ||
    release.tag_name?.replace(/^v/i, '') ||
    release.name?.replace(/^[^0-9]*/i, '') ||
    CURRENT_VERSION;
  const displayVersion = `v${versionNumber}`;
  const releaseTitle =
    release.name && !release.name.toLowerCase().includes('lastest')
      ? release.name
      : `PixChats ${displayVersion}`;

  const changelogItems =
    meta.changelogItems.length > 0
      ? meta.changelogItems
      : [
          'Полностью автоматическое скачивание и самоустановка обновлений на ПК (.exe) и Android (.apk)',
          'Стабильная передача звука и видео в личных звонках, голосовых чатах групп и прямых эфирах каналов',
          'Обновление Android (.apk) устанавливается поверх текущей версии без удаления приложения',
        ];

  const exeAsset = release.assets?.find((a) => a.name.toLowerCase().endsWith('.exe'));
  const apkAsset = release.assets?.find((a) => a.name.toLowerCase().endsWith('.apk'));
  const targetAsset =
    platform === 'desktop-exe'
      ? exeAsset
      : platform === 'android-apk'
        ? apkAsset
        : exeAsset || apkAsset;

  return (
    <div className="update-modal-overlay">
      <div className="update-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="update-badge">
          {updating ? `⚡ Автообновление · ${releaseTitle}` : `🚀 Новая версия · ${releaseTitle}`}
        </div>

        <h3 style={{ margin: '0 0 6px', fontSize: 19, fontFamily: 'var(--font-display)' }}>
          {updating
            ? `Автоматическое обновление до ${releaseTitle}`
            : `Доступно обновление ${releaseTitle}`}
        </h3>
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.45 }}>
          Текущая версия: <b>v{CURRENT_VERSION}</b> → Новая версия: <b style={{ color: 'var(--accent)' }}>{displayVersion}</b>.{' '}
          {platform === 'desktop-exe'
            ? 'Обновление скачивается и устанавливается автоматически в фоновом режиме, после чего приложение само перезапустится.'
            : platform === 'android-apk'
              ? 'Обновление скачивается и автоматически запускает установку поверх текущей версии без удаления данных.'
              : ''}
        </p>

        {/* Индикатор автоматической загрузки и самоустановки */}
        {updating && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--surface-raised)',
              border: '1px solid rgba(255, 212, 0, 0.35)',
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 12,
                fontWeight: 600,
                marginBottom: 6,
                color: 'var(--accent)',
              }}
            >
              <span>
                {progressStatus === 'installing'
                  ? '⚙️ Автоматическая установка обновления…'
                  : '⬇️ Автоматическое скачивание обновления…'}
              </span>
              <span>{progressPercent}%</span>
            </div>
            <div
              style={{
                width: '100%',
                height: 6,
                borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.08)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${Math.max(6, progressPercent)}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          </div>
        )}

        {/* Блок «Что нового» */}
        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'rgba(255, 212, 0, 0.06)',
            border: '1px solid rgba(255, 212, 0, 0.25)',
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: 'var(--accent)',
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>✨ Что нового в {displayVersion}:</span>
          </div>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 12.5,
              color: 'var(--text)',
              lineHeight: 1.5,
              maxHeight: 150,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {changelogItems.map((item, idx) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>

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
              📦 {targetAsset.name} ({displayVersion})
            </span>
            {targetAsset.size > 0 && (
              <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>
                {(targetAsset.size / (1024 * 1024)).toFixed(1)} МБ
              </span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn"
            style={{ width: 'auto', padding: '11px 14px', fontSize: 13 }}
            onClick={() => setShowModal(false)}
          >
            Свернуть в фон
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, padding: '11px 18px', fontWeight: 700 }}
            onClick={() => void executeAutoInstall(release, platform)}
            disabled={updating}
          >
            {updating
              ? progressStatus === 'installing'
                ? '⚙️ Устанавливается автоматически…'
                : `⏳ Скачивание (${progressPercent}%)…`
              : `🔄 Установить ${displayVersion} сейчас`}
          </button>
        </div>
      </div>
    </div>
  );
}
