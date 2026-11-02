'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  getCurrentProfile,
  getCachedCurrentProfile,
  hasActiveSession,
  updateProfile,
  setTheme as persistTheme,
  updatePrivacySettings,
  getLinkedIdentities,
  linkGoogle,
  linkEmailPassword,
  getSavedPixsetStudioAccount,
  signInWithPixsetStudioAccount,
  unlinkPixsetStudioAccount,
} from '@pixchats/core';
import type { Profile, LinkedIdentity, PixsetStudioAccount, AppTheme } from '@pixchats/core';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { isBanned } from '../../lib/ban';
import { buildAppUrl } from '../../lib/url';
import { PIXSET_THEMES, applyTheme, getCurrentTheme } from '../../components/ThemeManager';
import { triggerManualUpdateCheck } from '../../components/UpdateNotifier';
import { fileToBase64Image } from '../../lib/imageUtils';
import {
  getNotificationPrefs,
  updateNotificationPref,
  type NotificationPreferences,
  DEFAULT_NOTIFICATION_PREFS,
} from '../../lib/notificationPrefs';
import { ensureNotificationPermissionEverywhere, requestPermissionNow } from '../../lib/nativePlatform';
import {
  WALLPAPER_PRESETS,
  getChatAppearance,
  saveChatAppearance,
  DEFAULT_CHAT_APPEARANCE,
  type ChatAppearanceSettings,
  type WallpaperPresetId,
} from '../../lib/chatAppearance';
import {
  getAppLockConfig,
  saveAppLockConfig,
  lockSessionNow,
  DEFAULT_APP_LOCK,
  type AppLockConfig,
} from '../../lib/appLock';
import { get2FAConfig, save2FAConfig, type TwoFactorConfig } from '../../lib/twoFactorAuth';
import { getAutoTranslatePref, setAutoTranslatePref } from '../../lib/translator';
import { isScreenshotGuardEnabled, setScreenshotGuardEnabled } from '../../lib/screenshotGuard';
import {
  syncAndGetAccountDevices,
  terminateDeviceSession,
  terminateAllOtherDeviceSessions,
  type DeviceSessionInfo,
} from '../../lib/deviceSessions';
import { approveQrLoginSession, normalizeQrCodeInput } from '../../lib/qrAuth';
import {
  getPreferredMediaDevices,
  savePreferredMediaDevices,
} from '../../lib/mediaDevicesStore';
import {
  getUserEmojiStatus,
  setUserEmojiStatus,
  EMOJI_STATUS_PRESETS,
} from '../../lib/emojiStatus';
import { EmojiPicker } from '../../components/EmojiPicker';

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const initialCachedMe = getCachedCurrentProfile();
  const [profile, setProfile] = useState<Profile | null>(initialCachedMe);

  const [displayName, setDisplayName] = useState(initialCachedMe?.display_name ?? '');
  const [bio, setBio] = useState(initialCachedMe?.bio ?? '');
  const [username, setUsername] = useState(initialCachedMe?.username ?? '');
  const [theme, setThemeState] = useState<AppTheme>(() => getCurrentTheme());
  const [whoCanMessage, setWhoCanMessage] = useState<'everyone' | 'friends_only' | 'nobody'>(
    initialCachedMe?.privacy_who_can_message ?? 'everyone'
  );
  const [showLastSeen, setShowLastSeen] = useState<'everyone' | 'friends_only' | 'nobody'>(
    initialCachedMe?.privacy_show_last_seen ?? 'everyone'
  );
  const [whoCanAdd, setWhoCanAdd] = useState<'everyone' | 'friends_only' | 'nobody'>(
    initialCachedMe?.privacy_who_can_add_to_groups ?? 'everyone'
  );
  const [linkedProviders, setLinkedProviders] = useState<string[]>([]);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');

  // Pixset Studio account integration
  const [pixsetAccount, setPixsetAccount] = useState<PixsetStudioAccount | null>(null);
  const [showPixsetForm, setShowPixsetForm] = useState(false);
  const [pixsetLogin, setPixsetLogin] = useState('');
  const [pixsetPassword, setPixsetPassword] = useState('');
  const [pixsetLoading, setPixsetLoading] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(DEFAULT_NOTIFICATION_PREFS);
  const [desktopAutoStart, setDesktopAutoStart] = useState(true);
  const [desktopLaunchMinimized, setDesktopLaunchMinimized] = useState(true);
  const [appearance, setAppearance] = useState<ChatAppearanceSettings>(DEFAULT_CHAT_APPEARANCE);
  const [appLock, setAppLock] = useState<AppLockConfig>(DEFAULT_APP_LOCK);
  const [pinDraft, setPinDraft] = useState('');
  const [twoFactor, setTwoFactor] = useState<TwoFactorConfig>(get2FAConfig());
  const [twoFactorPassDraft, setTwoFactorPassDraft] = useState('');
  const [twoFactorHintDraft, setTwoFactorHintDraft] = useState('');
  const [autoTranslate, setAutoTranslate] = useState(getAutoTranslatePref());
  const [screenshotGuard, setScreenshotGuard] = useState(isScreenshotGuardEnabled());
  const [settingsTab, setSettingsTab] = useState<'general' | 'devices'>('general');
  const [deviceSessions, setDeviceSessions] = useState<DeviceSessionInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [terminatingId, setTerminatingId] = useState<string | null>(null);
  const [qrInputCode, setQrInputCode] = useState('');
  const [qrApproving, setQrApproving] = useState(false);
  const [qrCameraOpen, setQrCameraOpen] = useState(false);
  const qrVideoRef = useRef<HTMLVideoElement>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);

  // Эмодзи-статус рядом с ником
  const [emojiStatus, setEmojiStatus] = useState<string | null>(() =>
    initialCachedMe ? getUserEmojiStatus(initialCachedMe.id, initialCachedMe.username) : null
  );
  const [showEmojiStatusPicker, setShowEmojiStatusPicker] = useState(false);

  // Устройства ввода/вывода (Микрофон, Камера, Динамики) и разрешения для ПК / Веб
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedAudioInput, setSelectedAudioInput] = useState<string>(
    () => getPreferredMediaDevices().audioInputId
  );
  const [selectedVideoInput, setSelectedVideoInput] = useState<string>(
    () => getPreferredMediaDevices().videoInputId
  );
  const [selectedAudioOutput, setSelectedAudioOutput] = useState<string>(
    () => getPreferredMediaDevices().audioOutputId
  );
  const [micPermission, setMicPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [camPermission, setCamPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt');
  const [testingMic, setTestingMic] = useState(false);
  const [micVolumePct, setMicVolumePct] = useState(0);
  const [testingCam, setTestingCam] = useState(false);
  const testCamVideoRef = useRef<HTMLVideoElement | null>(null);
  const testMicStreamRef = useRef<MediaStream | null>(null);
  const testCamStreamRef = useRef<MediaStream | null>(null);
  const testMicRafRef = useRef<number | null>(null);

  async function refreshHardwareDevices() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(list.filter((d) => d.kind === 'audioinput'));
      setVideoInputs(list.filter((d) => d.kind === 'videoinput'));
      setAudioOutputs(list.filter((d) => d.kind === 'audiooutput'));

      const hasLabels = list.some((d) => Boolean(d.label));
      if (hasLabels) {
        if (list.some((d) => d.kind === 'audioinput' && d.label)) setMicPermission('granted');
        if (list.some((d) => d.kind === 'videoinput' && d.label)) setCamPermission('granted');
      }
    } catch {}

    try {
      if (navigator.permissions?.query) {
        const micRes = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        setMicPermission(micRes.state);
        const camRes = await navigator.permissions.query({ name: 'camera' as PermissionName });
        setCamPermission(camRes.state);
      }
    } catch {}
  }

  async function requestMicAndCameraPermissions() {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError('Ваш браузер не поддерживает доступ к микрофону и камере');
      return;
    }
    setError(null);
    let micOk = false;
    let camOk = false;
    try {
      const mStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      mStream.getTracks().forEach((t) => t.stop());
      micOk = true;
      setMicPermission('granted');
    } catch {
      setMicPermission('denied');
    }
    try {
      const cStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      cStream.getTracks().forEach((t) => t.stop());
      camOk = true;
      setCamPermission('granted');
    } catch {
      setCamPermission('denied');
    }
    await refreshHardwareDevices();
    if (micOk || camOk) {
      setNotice(
        `✅ Доступ получен: Микрофон (${micOk ? 'Разрешён' : 'Отклонён'}), Камера (${camOk ? 'Разрешена' : 'Отклонена'})`
      );
      setTimeout(() => setNotice(null), 3000);
    } else {
      setError('Доступ к микрофону и камере заблокирован в настройках браузера/системы');
    }
  }

  function stopHardwareTests() {
    if (testMicRafRef.current) {
      cancelAnimationFrame(testMicRafRef.current);
      testMicRafRef.current = null;
    }
    if (testMicStreamRef.current) {
      testMicStreamRef.current.getTracks().forEach((t) => t.stop());
      testMicStreamRef.current = null;
    }
    if (testCamStreamRef.current) {
      testCamStreamRef.current.getTracks().forEach((t) => t.stop());
      testCamStreamRef.current = null;
    }
    setTestingMic(false);
    setMicVolumePct(0);
    setTestingCam(false);
  }

  async function toggleMicTest() {
    if (testingMic) {
      stopHardwareTests();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedAudioInput ? { deviceId: { exact: selectedAudioInput } } : true,
        video: false,
      });
      testMicStreamRef.current = stream;
      setMicPermission('granted');
      setTestingMic(true);
      void refreshHardwareDevices();

      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!testMicStreamRef.current) {
          void ctx.close().catch(() => {});
          return;
        }
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        setMicVolumePct(Math.min(100, Math.round((avg / 90) * 100)));
        testMicRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      setError('Не удалось запустить проверку микрофона (разрешите доступ к микрофону)');
    }
  }

  async function toggleCamTest() {
    if (testingCam) {
      stopHardwareTests();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: selectedVideoInput
          ? { deviceId: { exact: selectedVideoInput }, width: { ideal: 640 }, height: { ideal: 360 } }
          : { width: { ideal: 640 }, height: { ideal: 360 } },
        audio: false,
      });
      testCamStreamRef.current = stream;
      setCamPermission('granted');
      setTestingCam(true);
      void refreshHardwareDevices();
      setTimeout(() => {
        if (testCamVideoRef.current) {
          testCamVideoRef.current.srcObject = stream;
          void testCamVideoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      setError('Не удалось запустить проверку камеры (разрешите доступ к камере)');
    }
  }

  useEffect(() => {
    void refreshHardwareDevices();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qrApproveParam = params.get('qr_approve');
      if (qrApproveParam) {
        const clean = normalizeQrCodeInput(qrApproveParam);
        if (clean) {
          setSettingsTab('devices');
          setQrInputCode(clean);
          approveQrLoginSession(clean)
            .then(() => {
              setNotice('✅ Вход на устройстве по QR-коду автоматически подтверждён!');
            })
            .catch(() => {});
        }
      }
    }
    return () => {
      stopHardwareTests();
    };
  }, []);

  useEffect(() => {
    (async () => {
      const active = await hasActiveSession();
      if (!active) {
        router.push('/login');
        return;
      }
      const me = await getCurrentProfile();
      if (!me) {
        router.push('/complete-profile');
        return;
      }
      if (isBanned(me)) {
        router.push('/banned');
        return;
      }
      setProfile(me);
      setDisplayName(me.display_name);
      setUsername(me.username);
      setBio(me.bio ?? '');
      setEmojiStatus(getUserEmojiStatus(me.id, me.username));
      // Не перезаписываем кастомную тему из устаревшего поля базы
      setThemeState(getCurrentTheme());
      setWhoCanMessage(me.privacy_who_can_message);
      setShowLastSeen(me.privacy_show_last_seen);
      setWhoCanAdd(me.privacy_who_can_add_to_groups);
      try {
        setLinkedProviders((await getLinkedIdentities()).map((i) => i.provider));
      } catch {
        // не критично для остальной страницы
      }
      setPixsetAccount(getSavedPixsetStudioAccount());
      setNotifPrefs(getNotificationPrefs());
      setAppearance(getChatAppearance());
      const lockCfg = getAppLockConfig();
      setAppLock(lockCfg);
      setPinDraft(lockCfg.pinCode || '');
      ensureNotificationPermissionEverywhere();

      try {
        if (typeof window !== 'undefined') {
          if (window.pixchatsDesktop?.getAutoStartEnabled) {
            const enabled = await window.pixchatsDesktop.getAutoStartEnabled();
            setDesktopAutoStart(enabled);
          } else {
            const saved = localStorage.getItem('pixchats:desktop_autostart');
            setDesktopAutoStart(saved === null ? true : saved === '1');
          }

          if (window.pixchatsDesktop?.getLaunchMinimizedEnabled) {
            const minEnabled = await window.pixchatsDesktop.getLaunchMinimizedEnabled();
            setDesktopLaunchMinimized(minEnabled);
          } else {
            const savedMin = localStorage.getItem('pixchats:desktop_launch_minimized');
            setDesktopLaunchMinimized(savedMin === null ? true : savedMin === '1');
          }
        }
      } catch {}

      try {
        setDevicesLoading(true);
        const { devices, revokedCurrent } = await syncAndGetAccountDevices(me.id);
        if (revokedCurrent) {
          router.push('/login');
          return;
        }
        setDeviceSessions(devices);
      } catch {} finally {
        setDevicesLoading(false);
      }
    })();
  }, [router]);

  useEffect(() => {
    if (!profile) return;
    const onDevicesUpdated = () => {
      void syncAndGetAccountDevices(profile.id).then(({ devices, revokedCurrent }) => {
        if (revokedCurrent) {
          router.push('/login');
          return;
        }
        setDeviceSessions(devices);
      });
    };
    window.addEventListener('pixchats:devices_updated', onDevicesUpdated);
    return () => window.removeEventListener('pixchats:devices_updated', onDevicesUpdated);
  }, [profile, router]);

  async function handleRefreshDevices() {
    if (!profile) return;
    setDevicesLoading(true);
    try {
      const { devices, revokedCurrent } = await syncAndGetAccountDevices(profile.id);
      if (revokedCurrent) {
        router.push('/login');
        return;
      }
      setDeviceSessions(devices);
      setNotice('Список активных устройств обновлён');
      setTimeout(() => setNotice(null), 1600);
    } finally {
      setDevicesLoading(false);
    }
  }

  async function handleTerminateDevice(sessionId: string, deviceName: string) {
    if (!profile) return;
    setTerminatingId(sessionId);
    try {
      const next = await terminateDeviceSession(profile.id, sessionId);
      setDeviceSessions(next);
      setNotice(`Сеанс на устройстве «${deviceName}» завершён`);
      setTimeout(() => setNotice(null), 2200);
    } catch {
      setError('Не удалось завершить сеанс устройства');
    } finally {
      setTerminatingId(null);
    }
  }

  async function handleTerminateAllOtherDevices() {
    if (!profile) return;
    setTerminatingId('all-other');
    try {
      const next = await terminateAllOtherDeviceSessions(profile.id);
      setDeviceSessions(next);
      setNotice('Все другие сеансы кроме текущего успешно завершены');
      setTimeout(() => setNotice(null), 2200);
    } catch {
      setError('Не удалось завершить другие сеансы');
    } finally {
      setTerminatingId(null);
    }
  }

  function handleToggleNotifPref(key: keyof NotificationPreferences, value: boolean) {
    const next = updateNotificationPref(key, value);
    setNotifPrefs(next);
    if (value) {
      void requestPermissionNow();
    }
  }

  async function handleToggleDesktopAutoStart(enabled: boolean) {
    setDesktopAutoStart(enabled);
    try {
      localStorage.setItem('pixchats:desktop_autostart', enabled ? '1' : '0');
      if (typeof window !== 'undefined' && window.pixchatsDesktop?.setAutoStartEnabled) {
        await window.pixchatsDesktop.setAutoStartEnabled(enabled);
      }
      setNotice(
        enabled
          ? 'Автозапуск и фоновый режим (.exe) включены'
          : 'Автозапуск при старте ПК отключён'
      );
      setTimeout(() => setNotice(null), 1800);
    } catch {}
  }

  async function handleToggleDesktopLaunchMinimized(enabled: boolean) {
    setDesktopLaunchMinimized(enabled);
    try {
      localStorage.setItem('pixchats:desktop_launch_minimized', enabled ? '1' : '0');
      if (typeof window !== 'undefined' && window.pixchatsDesktop?.setLaunchMinimizedEnabled) {
        await window.pixchatsDesktop.setLaunchMinimizedEnabled(enabled);
      }
      setNotice(
        enabled
          ? 'Запуск приложения свёрнутым на ПК включён'
          : 'Приложение на ПК будет запускаться в обычном развёрнутом окне'
      );
      setTimeout(() => setNotice(null), 1800);
    } catch {}
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!profile) return;
    setError(null);
    try {
      await updateProfile(profile.id, { displayName, username, bio });
      setNotice('Профиль обновлён');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить');
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!profile || !e.target.files?.[0]) return;
    setAvatarUploading(true);
    setError(null);
    try {
      // Сжимаем аватар и сохраняем напрямую в base64 без расхода хранилища Supabase
      const base64Data = await fileToBase64Image(e.target.files[0], 256, 0.85);
      await updateProfile(profile.id, { avatarUrl: base64Data });
      setProfile({ ...profile, avatar_url: base64Data });
      setNotice('Аватар обновлён');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось загрузить аватар');
    } finally {
      setAvatarUploading(false);
    }
  }

  async function handleThemeChange(newTheme: AppTheme) {
    setThemeState(newTheme);
    applyTheme(newTheme);
    if (profile) {
      persistTheme(profile.id, newTheme).catch(() => {});
    }
    setNotice('Тема обновлена');
    setTimeout(() => setNotice(null), 1500);
  }

  function handleUpdateAppearance(patch: Partial<ChatAppearanceSettings>) {
    const next = saveChatAppearance(patch);
    setAppearance(next);
    setNotice('Внешний вид чата обновлён');
    setTimeout(() => setNotice(null), 1400);
  }

  async function handleCustomWallpaperUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToBase64Image(file, 960, 0.82, { cropSquare: false });
      handleUpdateAppearance({ wallpaper: 'custom', customWallpaperDataUrl: dataUrl });
    } catch {
      setError('Не удалось загрузить фоновое изображение');
    }
  }

  function handleSaveAppLock(e: React.FormEvent) {
    e.preventDefault();
    const cleanPin = pinDraft.trim();
    if (appLock.enabled && cleanPin.length < 4) {
      setError('PIN-код должен содержать минимум 4 символа');
      return;
    }
    setError(null);
    const saved = saveAppLockConfig({
      enabled: appLock.enabled && cleanPin.length >= 4,
      pinCode: cleanPin,
      autoLockMinutes: appLock.autoLockMinutes,
    });
    setAppLock(saved);
    setNotice(
      saved.enabled
        ? '🔐 Защита входа PIN-кодом активирована'
        : '🔓 Защита входа PIN-кодом отключена'
    );
    setTimeout(() => setNotice(null), 1800);
  }

  async function handleLinkProvider(provider: 'google') {
    setError(null);
    try {
      const redirectTo = buildAppUrl('/settings/');
      if (provider === 'google') await linkGoogle(redirectTo);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось привязать Google аккаунт');
    }
  }

  async function handleLinkPixsetStudio(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPixsetLoading(true);
    try {
      const acc = await signInWithPixsetStudioAccount(pixsetLogin, pixsetPassword);
      setPixsetAccount(acc);
      setShowPixsetForm(false);
      setPixsetLogin('');
      setPixsetPassword('');
      setNotice(`Учётная запись Pixset Studio (@${acc.nickname}) успешно привязана!`);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось привязать аккаунт Pixset Studio');
    } finally {
      setPixsetLoading(false);
    }
  }

  function handleUnlinkPixset() {
    unlinkPixsetStudioAccount();
    setPixsetAccount(null);
    setNotice('Учётная запись Pixset Studio отвязана');
  }

  async function handleLinkEmailPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await linkEmailPassword(linkEmail, linkPassword);
      setNotice('Email и пароль привязаны — теперь можно входить и так');
      setLinkedProviders((prev) => [...prev, 'email']);
      setLinkEmail('');
      setLinkPassword('');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось привязать email/пароль');
    }
  }

  async function handleSavePrivacy() {
    if (!profile) return;
    setError(null);
    try {
      await updatePrivacySettings(profile.id, {
        privacy_who_can_message: whoCanMessage,
        privacy_show_last_seen: showLastSeen,
        privacy_who_can_add_to_groups: whoCanAdd,
      });
      setNotice('Настройки приватности сохранены');
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить');
    }
  }

  if (!profile) return null;

  return (
    <DesktopShell>
    <main className="container-wide with-bottom-nav">
      <header className="app-header">
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>Настройки</h1>
        <Link href="/chats/" className="btn btn-ghost" style={{ width: 'auto' }}>
          ← К чатам
        </Link>
      </header>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {/* Переключатель вкладок Настроек: Основные / Устройства */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 20,
          padding: 4,
          borderRadius: 12,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
        }}
      >
        <button
          type="button"
          className={`btn ${settingsTab === 'general' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ flex: 1, padding: '10px 14px', fontSize: 13.5, fontWeight: 700 }}
          onClick={() => setSettingsTab('general')}
        >
          ⚙️ Основные настройки
        </button>
        <button
          type="button"
          className={`btn ${settingsTab === 'devices' ? 'btn-primary' : 'btn-ghost'}`}
          style={{ flex: 1, padding: '10px 14px', fontSize: 13.5, fontWeight: 700 }}
          onClick={() => {
            setSettingsTab('devices');
            void handleRefreshDevices();
          }}
        >
          💻 Устройства ({Math.max(1, deviceSessions.length)})
        </button>
      </div>

      {settingsTab === 'devices' ? (
        <div>
          <div className="section-title">Это устройство (Текущий сеанс)</div>
          {(() => {
            const currentDev = deviceSessions.find((d) => d.isCurrent) || deviceSessions[0];
            const otherDevices = deviceSessions.filter((d) => !d.isCurrent);
            const platformIcon =
              currentDev?.platformType === 'desktop-exe'
                ? '🖥️'
                : currentDev?.platformType === 'android-apk'
                  ? '📱'
                  : '🌐';

            return (
              <>
                {currentDev && (
                  <div
                    className="card"
                    style={{
                      marginBottom: 24,
                      border: '1px solid rgba(255, 212, 0, 0.35)',
                      background: 'linear-gradient(135deg, rgba(255, 212, 0, 0.06), var(--surface))',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 12,
                          background: 'rgba(255, 212, 0, 0.14)',
                          border: '1px solid var(--accent)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 24,
                          flexShrink: 0,
                        }}
                      >
                        {platformIcon}
                      </div>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: 16 }}>{currentDev.deviceName}</span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: 'rgba(34, 197, 94, 0.16)',
                              color: '#22c55e',
                              border: '1px solid rgba(34, 197, 94, 0.35)',
                            }}
                          >
                            🟢 В сети • Текущее устройство
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>
                          {currentDev.clientLabel}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                          📍 Регион / часовой пояс: {currentDev.locationLabel} • Вход выполнен:{' '}
                          {new Date(currentDev.createdAt).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 16,
                        paddingTop: 14,
                        borderTop: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        className="btn btn-compact"
                        onClick={handleRefreshDevices}
                        disabled={devicesLoading}
                      >
                        {devicesLoading ? '⏳ Синхронизация…' : '🔄 Обновить список устройств'}
                      </button>

                      {otherDevices.length > 0 ? (
                        <button
                          type="button"
                          className="btn btn-compact"
                          style={{
                            borderColor: 'var(--danger)',
                            color: 'var(--danger)',
                            fontWeight: 700,
                          }}
                          onClick={handleTerminateAllOtherDevices}
                          disabled={terminatingId !== null}
                        >
                          {terminatingId === 'all-other'
                            ? 'Завершаем…'
                            : `🛑 Завершить все другие сеансы (${otherDevices.length})`}
                        </button>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          ✓ На других устройствах активных сеансов нет
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="section-title">📷 Подключить устройство по QR-коду (Вход на ПК за 1 сек)</div>
                <div className="card" style={{ marginBottom: 20 }}>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    На странице входа на ПК или в другом браузере выберите вкладку <b>«📷 QR-код»</b> и введите показанный там 6-значный код (или наведите камеру):
                  </p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      className="input"
                      style={{
                        flex: 1,
                        minWidth: 160,
                        textTransform: 'uppercase',
                        letterSpacing: '0.14em',
                        fontWeight: 700,
                        fontFamily: 'var(--font-mono, monospace)',
                      }}
                      maxLength={8}
                      placeholder="Код с экрана (напр. 8F4K2M)"
                      value={qrInputCode}
                      onChange={(e) => setQrInputCode(e.target.value.toUpperCase())}
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      style={{ fontWeight: 700 }}
                      disabled={qrApproving || qrInputCode.trim().length < 4}
                      onClick={async () => {
                        setQrApproving(true);
                        setError(null);
                        try {
                          await approveQrLoginSession(qrInputCode);
                          setQrInputCode('');
                          setNotice('✅ Вход на новом устройстве успешно подтверждён!');
                          setTimeout(() => void handleRefreshDevices(), 1200);
                        } catch (err: any) {
                          setError(err?.message || 'Не удалось подтвердить вход по QR-коду');
                        } finally {
                          setQrApproving(false);
                        }
                      }}
                    >
                      {qrApproving ? 'Подключаем…' : '⚡ Подтвердить вход'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-compact"
                      onClick={async () => {
                        if (qrCameraOpen) {
                          qrStreamRef.current?.getTracks().forEach((t) => t.stop());
                          qrStreamRef.current = null;
                          setQrCameraOpen(false);
                          return;
                        }
                        try {
                          const stream = await navigator.mediaDevices.getUserMedia({
                            video: { facingMode: 'environment' },
                            audio: false,
                          });
                          qrStreamRef.current = stream;
                          setQrCameraOpen(true);
                          setTimeout(() => {
                            if (qrVideoRef.current) {
                              qrVideoRef.current.srcObject = stream;
                              qrVideoRef.current.play().catch(() => {});

                              // Автоматическое распознавание QR-кода через встроенный BarcodeDetector браузера
                              const BarcodeDetectorCtor = (window as any).BarcodeDetector;
                              if (typeof BarcodeDetectorCtor === 'function') {
                                try {
                                  const detector = new BarcodeDetectorCtor({ formats: ['qr_code'] });
                                  const scanLoop = setInterval(async () => {
                                    if (!qrVideoRef.current || !qrStreamRef.current) {
                                      clearInterval(scanLoop);
                                      return;
                                    }
                                    try {
                                      const codes = await detector.detect(qrVideoRef.current);
                                      if (codes && codes.length > 0 && codes[0].rawValue) {
                                        const code = normalizeQrCodeInput(codes[0].rawValue);
                                        if (code && code.length >= 4) {
                                          clearInterval(scanLoop);
                                          qrStreamRef.current?.getTracks().forEach((t) => t.stop());
                                          qrStreamRef.current = null;
                                          setQrCameraOpen(false);
                                          setQrInputCode(code);
                                          setQrApproving(true);
                                          approveQrLoginSession(code)
                                            .then(() => {
                                              setQrInputCode('');
                                              setNotice('✅ QR-код отсканирован! Вход на устройстве подтверждён.');
                                              setTimeout(() => void handleRefreshDevices(), 1000);
                                            })
                                            .catch((err: any) => {
                                              setError(err?.message || 'Ошибка подтверждения QR');
                                            })
                                            .finally(() => setQrApproving(false));
                                        }
                                      }
                                    } catch {}
                                  }, 400);
                                } catch {}
                              }
                            }
                          }, 100);
                        } catch {
                          setError('Не удалось открыть камеру для сканирования QR-кода');
                        }
                      }}
                    >
                      {qrCameraOpen ? '✕ Закрыть камеру' : '📸 Сканировать камерой'}
                    </button>
                  </div>

                  {qrCameraOpen && (
                    <div
                      style={{
                        marginTop: 12,
                        borderRadius: 12,
                        overflow: 'hidden',
                        border: '2px solid var(--accent)',
                        background: '#000',
                        position: 'relative',
                        maxWidth: 320,
                      }}
                    >
                      <video
                        ref={qrVideoRef}
                        playsInline
                        muted
                        style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }}
                      />
                      <div
                        style={{
                          padding: '6px 10px',
                          fontSize: 11.5,
                          color: 'var(--accent)',
                          textAlign: 'center',
                          background: 'rgba(0,0,0,0.75)',
                        }}
                      >
                        Наведите камеру на QR-код или введите 6-значный код под ним
                      </div>
                    </div>
                  )}
                </div>

                <div className="section-title">
                  Активные сеансы на других устройствах ({otherDevices.length})
                </div>
                <div className="card" style={{ marginBottom: 24 }}>
                  {otherDevices.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '18px 10px', color: 'var(--text-muted)', fontSize: 13.5 }}>
                      🔒 Сейчас в вашем аккаунте авторизовано только это устройство. Если вы войдёте в аккаунт с телефона (.apk), ПК (.exe) или другого браузера, все сеансы появятся здесь.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {otherDevices.map((dev) => {
                        const icon =
                          dev.platformType === 'desktop-exe'
                            ? '🖥️'
                            : dev.platformType === 'android-apk'
                              ? '📱'
                              : '🌐';
                        const badgeText =
                          dev.platformType === 'desktop-exe'
                            ? 'Windows .exe'
                            : dev.platformType === 'android-apk'
                              ? 'Android .apk'
                              : 'Web Браузер';

                        return (
                          <div
                            key={dev.sessionId}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 12,
                              padding: '12px 14px',
                              borderRadius: 12,
                              background: 'var(--bg-secondary)',
                              border: '1px solid var(--border)',
                              flexWrap: 'wrap',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200, flex: 1 }}>
                              <div
                                style={{
                                  width: 42,
                                  height: 42,
                                  borderRadius: 10,
                                  background: 'var(--surface-raised)',
                                  border: '1px solid var(--border)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 20,
                                  flexShrink: 0,
                                }}
                              >
                                {icon}
                              </div>
                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span style={{ fontWeight: 700, fontSize: 14.5 }}>{dev.deviceName}</span>
                                  <span
                                    style={{
                                      fontSize: 10.5,
                                      fontWeight: 700,
                                      padding: '2px 7px',
                                      borderRadius: 6,
                                      background: 'rgba(255, 212, 0, 0.14)',
                                      color: 'var(--accent)',
                                    }}
                                  >
                                    {badgeText}
                                  </span>
                                  {dev.isOnline && (
                                    <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600 }}>
                                      ● В сети
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 2 }}>
                                  {dev.clientLabel}
                                </div>
                                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                                  📍 {dev.locationLabel} • Активность:{' '}
                                  {new Date(dev.lastActiveAt).toLocaleString('ru-RU', {
                                    day: '2-digit',
                                    month: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              className="btn btn-compact"
                              style={{
                                borderColor: 'var(--danger)',
                                color: 'var(--danger)',
                                fontWeight: 700,
                              }}
                              onClick={() => handleTerminateDevice(dev.sessionId, dev.deviceName)}
                              disabled={terminatingId !== null}
                            >
                              {terminatingId === dev.sessionId ? 'Завершаем…' : 'Завершить сеанс'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      ) : (
      <>
      <div className="section-title">Профиль</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
          <div
            className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
            style={{
              width: 64,
              height: 64,
              fontSize: 24,
              backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <button
              type="button"
              className="btn"
              style={{ width: 'auto' }}
              onClick={() => fileInputRef.current?.click()}
              disabled={avatarUploading}
            >
              {avatarUploading ? 'Загружаем…' : 'Сменить аватар'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleAvatarChange}
            />
          </div>
        </div>

        <form onSubmit={handleSaveProfile}>
          <div className="field">
            <label>Юзернейм</label>
            <div className="input-prefix">
              <span>@</span>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} />
            </div>
          </div>
          <div className="field">
            <label>Отображаемое имя</label>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="field">
            <label>О себе</label>
            <textarea
              className="input"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              placeholder="Пара слов о себе…"
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
            Сохранить
          </button>
        </form>

        {/* Эмодзи-статус (справа рядом с ником) */}
        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                ✨ Эмодзи-статус (справа рядом с ником):{' '}
                <span style={{ color: 'var(--accent)', fontSize: 17 }}>{emojiStatus || 'Нет'}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Выберите любой эмодзи или флаг — он будет виден всем рядом с вашим именем в чатах и профиле
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                className="btn btn-compact"
                onClick={() => setShowEmojiStatusPicker((v) => !v)}
              >
                😀 Все эмодзи / 🏳️ Флаги
              </button>
              {emojiStatus && (
                <button
                  type="button"
                  className="btn btn-compact"
                  onClick={async () => {
                    setEmojiStatus(null);
                    await setUserEmojiStatus(profile.id, null, profile.username);
                    setNotice('Эмодзи-статус сброшен');
                    setTimeout(() => setNotice(null), 1500);
                  }}
                >
                  ✕ Сбросить
                </button>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {EMOJI_STATUS_PRESETS.map((preset) => (
              <button
                key={preset.emoji}
                type="button"
                title={preset.label}
                onClick={async () => {
                  setEmojiStatus(preset.emoji);
                  await setUserEmojiStatus(profile.id, preset.emoji, profile.username);
                  setNotice(`Установлен эмодзи-статус ${preset.emoji}`);
                  setTimeout(() => setNotice(null), 1500);
                }}
                style={{
                  padding: '5px 10px',
                  borderRadius: 10,
                  border:
                    emojiStatus === preset.emoji ? '2px solid var(--accent)' : '1px solid var(--border)',
                  background:
                    emojiStatus === preset.emoji ? 'rgba(255, 212, 0, 0.16)' : 'var(--bg)',
                  cursor: 'pointer',
                  fontSize: 15,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  color: 'var(--text)',
                }}
              >
                <span>{preset.emoji}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{preset.label}</span>
              </button>
            ))}
          </div>

          {showEmojiStatusPicker && (
            <div style={{ marginTop: 12 }}>
              <EmojiPicker
                title="Выберите эмодзи-статус или флаг"
                onClose={() => setShowEmojiStatusPicker(false)}
                onSelect={async (emoji) => {
                  setShowEmojiStatusPicker(false);
                  setEmojiStatus(emoji);
                  await setUserEmojiStatus(profile.id, emoji, profile.username);
                  setNotice(`Установлен эмодзи-статус ${emoji}`);
                  setTimeout(() => setNotice(null), 1500);
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Выбор микрофона, камеры и разрешений для ПК и Веб */}
      <div className="section-title">🎙️📹 Микрофон, камера и разрешения (ПК и Веб)</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Настройте устройства ввода/вывода для звонков, голосовых сообщений, видеокружков и эфиров, а также проверьте разрешения:
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
            padding: '10px 14px',
            borderRadius: 12,
            background: 'var(--surface-raised)',
            border: '1px solid var(--border)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
            <span>
              🎙️ Микрофон:{' '}
              <b
                style={{
                  color:
                    micPermission === 'granted'
                      ? '#22c55e'
                      : micPermission === 'denied'
                        ? 'var(--danger)'
                        : 'var(--accent)',
                }}
              >
                {micPermission === 'granted'
                  ? 'Разрешено ✓'
                  : micPermission === 'denied'
                    ? 'Заблокировано ✕'
                    : 'Ожидает запроса'}
              </b>
            </span>
            <span>
              📹 Камера:{' '}
              <b
                style={{
                  color:
                    camPermission === 'granted'
                      ? '#22c55e'
                      : camPermission === 'denied'
                        ? 'var(--danger)'
                        : 'var(--accent)',
                }}
              >
                {camPermission === 'granted'
                  ? 'Разрешено ✓'
                  : camPermission === 'denied'
                    ? 'Заблокировано ✕'
                    : 'Ожидает запроса'}
              </b>
            </span>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary btn-compact"
              onClick={requestMicAndCameraPermissions}
            >
              🔓 Запросить доступ к микрофону и камере
            </button>
            <button
              type="button"
              className="btn btn-compact"
              onClick={refreshHardwareDevices}
            >
              🔄 Обновить устройства
            </button>
          </div>
        </div>

        <div className="field">
          <label>🎙️ Микрофон (устройство записи голоса)</label>
          <select
            className="input"
            value={selectedAudioInput}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedAudioInput(val);
              savePreferredMediaDevices({ audioInputId: val });
              setNotice('Выбранный микрофон сохранён');
              setTimeout(() => setNotice(null), 1500);
            }}
          >
            <option value="">По умолчанию (Системный микрофон)</option>
            {audioInputs.map((d, idx) => (
              <option key={d.deviceId || idx} value={d.deviceId}>
                {d.label || `Микрофон #${idx + 1}`}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>📹 Камера (устройство видеозахвата)</label>
          <select
            className="input"
            value={selectedVideoInput}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedVideoInput(val);
              savePreferredMediaDevices({ videoInputId: val });
              setNotice('Выбранная камера сохранена');
              setTimeout(() => setNotice(null), 1500);
            }}
          >
            <option value="">По умолчанию (Системная камера)</option>
            {videoInputs.map((d, idx) => (
              <option key={d.deviceId || idx} value={d.deviceId}>
                {d.label || `Камера #${idx + 1}`}
              </option>
            ))}
          </select>
        </div>

        {audioOutputs.length > 0 && (
          <div className="field">
            <label>🔊 Динамики / Наушники (вывод звука в звонках)</label>
            <select
              className="input"
              value={selectedAudioOutput}
              onChange={(e) => {
                const val = e.target.value;
                setSelectedAudioOutput(val);
                savePreferredMediaDevices({ audioOutputId: val });
                setNotice('Устройство вывода звука сохранено');
                setTimeout(() => setNotice(null), 1500);
              }}
            >
              <option value="">По умолчанию (Системный динамик)</option>
              {audioOutputs.map((d, idx) => (
                <option key={d.deviceId || idx} value={d.deviceId}>
                  {d.label || `Динамики #${idx + 1}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <button
            type="button"
            className={`btn btn-compact ${testingMic ? 'btn-primary' : ''}`}
            onClick={toggleMicTest}
          >
            {testingMic ? '⏹ Остановить проверку микрофона' : '🎤 Проверить микрофон'}
          </button>
          <button
            type="button"
            className={`btn btn-compact ${testingCam ? 'btn-primary' : ''}`}
            onClick={toggleCamTest}
          >
            {testingCam ? '⏹ Остановить проверку камеры' : '📹 Проверить камеру'}
          </button>
        </div>

        {testingMic && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
              Уровень сигнала микрофона: <b style={{ color: 'var(--accent)' }}>{micVolumePct}%</b>
            </div>
            <div
              style={{
                height: 10,
                borderRadius: 999,
                background: 'var(--surface-raised)',
                border: '1px solid var(--border)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${micVolumePct}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #22c55e, #ffd400, #ef4444)',
                  transition: 'width 0.08s linear',
                }}
              />
            </div>
          </div>
        )}

        {testingCam && (
          <div
            style={{
              marginTop: 12,
              maxWidth: 360,
              borderRadius: 12,
              overflow: 'hidden',
              border: '2px solid var(--accent)',
              background: '#000',
            }}
          >
            <video
              ref={testCamVideoRef}
              muted
              playsInline
              autoPlay
              style={{ width: '100%', height: 210, objectFit: 'cover', display: 'block' }}
            />
          </div>
        )}
      </div>

      <div className="section-title">Тема оформления</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 16 }}>
          Выберите цветовую тему интерфейса. Включает фирменную тёмно-жёлтую тему PixChats и стили с официального сайта Pixset Studio:
        </p>
        <div className="theme-picker-grid">
          {PIXSET_THEMES.map((item) => {
            const isSelected = theme === item.id || (theme === 'dark' && item.id === 'pixchats') || (theme === 'byte_blaster' && item.id === 'byteblaster');
            return (
              <button
                key={item.id}
                type="button"
                className={`theme-card ${isSelected ? 'active' : ''}`}
                onClick={() => handleThemeChange(item.id as AppTheme)}
              >
                <div className="theme-preview-dots">
                  <span className="dot-primary" style={{ background: item.accent }} />
                  <span className="dot-bg" style={{ background: item.bg }} />
                  <span className="dot-card" style={{ background: item.surface }} />
                </div>
                <div className="theme-card-name">
                  {item.name}
                  {isSelected && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>}
                </div>
                <div className="theme-card-desc">{item.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="section-title">Внешний вид чатов и обои</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Настройте фоновые обои в диалогах, размер шрифта и скругление углов пузырей сообщений:
        </p>

        <div className="theme-picker-grid" style={{ marginBottom: 16 }}>
          {WALLPAPER_PRESETS.map((wp) => {
            const active = appearance.wallpaper === wp.id;
            return (
              <button
                key={wp.id}
                type="button"
                className={`theme-card ${active ? 'active' : ''}`}
                onClick={() => handleUpdateAppearance({ wallpaper: wp.id as WallpaperPresetId })}
              >
                <div
                  style={{
                    height: 36,
                    borderRadius: 8,
                    marginBottom: 8,
                    border: '1px solid var(--border)',
                    background: wp.previewCss,
                    backgroundSize: wp.id === 'starfield' ? '18px 18px' : 'cover',
                  }}
                />
                <div className="theme-card-name">
                  {wp.name}
                  {active && <span style={{ color: 'var(--accent)', marginLeft: 6 }}>✓</span>}
                </div>
                <div className="theme-card-desc">{wp.desc}</div>
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <button
            type="button"
            className={`btn ${appearance.wallpaper === 'custom' ? 'btn-primary' : ''}`}
            style={{ width: 'auto' }}
            onClick={() => wallpaperInputRef.current?.click()}
          >
            🖼️ Загрузить свои обои чата (Base64)
          </button>
          <input
            ref={wallpaperInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleCustomWallpaperUpload}
          />
          {appearance.wallpaper === 'custom' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span>Затемнение фона: {appearance.wallpaperDimming}%</span>
              <input
                type="range"
                min={0}
                max={85}
                value={appearance.wallpaperDimming}
                onChange={(e) => handleUpdateAppearance({ wallpaperDimming: Number(e.target.value) })}
              />
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <div
            className="field"
            style={{
              marginBottom: 0,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Размер текста сообщений</label>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'var(--accent)',
                  color: '#000',
                }}
              >
                {appearance.fontSize} px
              </span>
            </div>
            <input
              type="range"
              min={11}
              max={24}
              step={1}
              value={appearance.fontSize}
              onChange={(e) => handleUpdateAppearance({ fontSize: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              <span>11 px (Мелкий)</span>
              <span>14 px (Стандарт)</span>
              <span>24 px (Крупный)</span>
            </div>
          </div>

          <div
            className="field"
            style={{
              marginBottom: 0,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ margin: 0, fontWeight: 700, fontSize: 13 }}>Углы пузырей сообщений</label>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: 6,
                  background: 'var(--accent)',
                  color: '#000',
                }}
              >
                {appearance.bubbleRadius} px
              </span>
            </div>
            <input
              type="range"
              min={2}
              max={28}
              step={1}
              value={appearance.bubbleRadius}
              onChange={(e) => handleUpdateAppearance({ bubbleRadius: Number(e.target.value) })}
              style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              <span>2 px (Острые)</span>
              <span>14 px (Стандарт)</span>
              <span>28 px (Округлые)</span>
            </div>
          </div>
        </div>

        {/* Живое превью пузырей сообщений */}
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>
            Предпросмотр сообщений ({appearance.fontSize} px, скругление {appearance.bubbleRadius} px):
          </div>
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '78%',
              padding: '9px 13px',
              background: 'var(--surface-raised)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontSize: `${appearance.fontSize}px`,
              borderRadius: `${appearance.bubbleRadius}px`,
              borderBottomLeftRadius: 4,
            }}
          >
            Привет! Теперь размер текста и углы пузырей плавно настраиваются ползунками 🎚️
          </div>
          <div
            style={{
              alignSelf: 'flex-end',
              maxWidth: '78%',
              padding: '9px 13px',
              background: 'var(--bubble-mine)',
              border: '1px solid rgba(255, 212, 0, 0.28)',
              color: 'var(--bubble-mine-text)',
              fontSize: `${appearance.fontSize}px`,
              borderRadius: `${appearance.bubbleRadius}px`,
              borderBottomRightRadius: 4,
            }}
          >
            Отлично выглядит! Всё меняется мгновенно ✨
          </div>
        </div>
      </div>

      <div className="section-title">Защита входа PIN-кодом (App Lock) и Скрытые чаты</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 14 }}>
          Установите секретный PIN-код для входа в приложение и автоблокировки экрана. Также этот PIN-код открывает ваши скрытые чаты, если ввести его в строку поиска чатов.
        </p>

        <form onSubmit={handleSaveAppLock}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-secondary)',
              border: `1px solid ${appLock.enabled ? 'var(--accent)' : 'var(--border)'}`,
              marginBottom: 14,
              cursor: 'pointer',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>🔐 Включить блокировку приложения по PIN-коду</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Запрашивать PIN-код при запуске и после бездействия
              </div>
            </div>
            <input
              type="checkbox"
              checked={appLock.enabled}
              onChange={(e) => setAppLock((prev) => ({ ...prev, enabled: e.target.checked }))}
              style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Секретный PIN-код (4–8 символов)</label>
              <input
                type="password"
                className="input"
                maxLength={8}
                placeholder="Например: 2580"
                value={pinDraft}
                onChange={(e) => setPinDraft(e.target.value)}
              />
            </div>

            <div className="field" style={{ marginBottom: 0 }}>
              <label>Автоблокировка при бездействии</label>
              <select
                className="input"
                value={appLock.autoLockMinutes}
                onChange={(e) =>
                  setAppLock((prev) => ({
                    ...prev,
                    autoLockMinutes: Number(e.target.value) as 0 | 1 | 5 | 15,
                  }))
                }
              >
                <option value={1}>Через 1 минуту</option>
                <option value={5}>Через 5 минут</option>
                <option value={15}>Через 15 минут</option>
                <option value={0}>Только при перезапуске или по кнопке 🔒</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
              Сохранить настройки PIN
            </button>
            {appLock.enabled && appLock.pinCode && (
              <button
                type="button"
                className="btn"
                style={{ width: 'auto' }}
                onClick={() => lockSessionNow()}
              >
                🔒 Заблокировать экран сейчас
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="section-title">Уведомления</div>
      <div className="card" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Настройте, какие именно уведомления вы хотите получать (разрешение запрашивается автоматически на всех устройствах):
        </p>

        {[
          {
            key: 'enabled' as const,
            title: 'Все уведомления',
            desc: 'Главный переключатель всех системных и внутриприложенческих уведомлений',
          },
          {
            key: 'directMessages' as const,
            title: 'Личные сообщения',
            desc: 'Новые входящие сообщения в личных диалогах',
          },
          {
            key: 'incomingCalls' as const,
            title: 'Входящие звонки',
            desc: 'Звуковой вызов и всплывающее окно при входящем аудио- или видеозвонке',
          },
          {
            key: 'groupMessages' as const,
            title: 'Группы и каналы',
            desc: 'Новые сообщения в групповых чатах и каналах',
          },
          {
            key: 'mentions' as const,
            title: 'Упоминания (@username)',
            desc: 'Уведомлять, когда вас отмечают через @ даже если уведомления групп выключены',
          },
          {
            key: 'friendRequests' as const,
            title: 'Заявки в друзья',
            desc: 'Новые запросы в друзья и уведомления о принятых заявках',
          },
          {
            key: 'chatInvites' as const,
            title: 'Приглашения в чаты',
            desc: 'Когда вас добавляют в новую группу или канал',
          },
          {
            key: 'accountEvents' as const,
            title: 'Статус аккаунта и бейджи',
            desc: 'Изменение роли, получение галочки верификации или бейджа Pixset Studio',
          },
          {
            key: 'sound' as const,
            title: 'Звуковой сигнал',
            desc: 'Проигрывать мелодию при поступлении нового уведомления',
          },
        ].map((item) => {
          const isMaster = item.key === 'enabled';
          const isDisabled = !isMaster && !notifPrefs.enabled;
          const checked = Boolean(notifPrefs[item.key]);

          return (
            <label
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '10px 12px',
                borderRadius: 10,
                background: isMaster ? 'var(--surface-raised)' : 'var(--bg-secondary)',
                border: `1px solid ${checked && !isDisabled ? 'var(--border-accent, var(--border))' : 'var(--border)'}`,
                opacity: isDisabled ? 0.5 : 1,
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>{item.title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.desc}</div>
              </div>
              <input
                type="checkbox"
                checked={checked}
                disabled={isDisabled}
                onChange={(e) => handleToggleNotifPref(item.key, e.target.checked)}
                style={{
                  width: 20,
                  height: 20,
                  accentColor: 'var(--accent)',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  flexShrink: 0,
                }}
              />
            </label>
          );
        })}

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px',
            borderRadius: 10,
            background: 'var(--surface-raised)',
            border: `1px solid ${desktopAutoStart ? 'var(--accent)' : 'var(--border)'}`,
            cursor: 'pointer',
            marginTop: 4,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
              🖥️ Автозапуск при старте ПК и фоновый режим (.exe)
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              В версии для Windows (.exe) программа автоматически запускается вместе с компьютером, работает в системном трее в фоне и непрерывно ждёт новых сообщений, звонков и уведомлений.
            </div>
          </div>
          <input
            type="checkbox"
            checked={desktopAutoStart}
            onChange={(e) => handleToggleDesktopAutoStart(e.target.checked)}
            style={{
              width: 20,
              height: 20,
              accentColor: 'var(--accent)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            padding: '12px',
            borderRadius: 10,
            background: 'var(--surface-raised)',
            border: `1px solid ${desktopLaunchMinimized ? 'var(--accent)' : 'var(--border)'}`,
            cursor: 'pointer',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>
              🗕 Запускать приложение свёрнутым на ПК
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              На компьютере приложение PixChats по умолчанию запускается в свёрнутом виде, чтобы не отвлекать поверх окон. Вы можете отключить эту настройку в любой момент.
            </div>
          </div>
          <input
            type="checkbox"
            checked={desktopLaunchMinimized}
            onChange={(e) => handleToggleDesktopLaunchMinimized(e.target.checked)}
            style={{
              width: 20,
              height: 20,
              accentColor: 'var(--accent)',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          />
        </label>
      </div>

      <div className="section-title">Учётная запись Pixset Studio</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Интеграция с единым порталом Pixset Studio (pixset-studio.github.io). Привязка аккаунта подтверждает статус разработчика/сотрудника и синхронизирует профиль.
        </p>

        {pixsetAccount ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                className="avatar"
                style={{
                  width: 44,
                  height: 44,
                  backgroundImage: pixsetAccount.avatar_url ? `url(${pixsetAccount.avatar_url})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {!pixsetAccount.avatar_url && pixsetAccount.nickname.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  @{pixsetAccount.nickname}
                  {pixsetAccount.is_admin && (
                    <span style={{ fontSize: 11, background: 'var(--accent)', color: '#000', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>
                      Сотрудник Pixset Studio
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {pixsetAccount.email || 'Аккаунт студии подключён'}
                </div>
              </div>
            </div>

            <button className="btn" style={{ width: 'auto', color: 'var(--danger)' }} onClick={handleUnlinkPixset}>
              Отвязать
            </button>
          </div>
        ) : (
          <div>
            {!showPixsetForm ? (
              <button
                className="btn btn-primary"
                style={{ width: 'auto' }}
                onClick={() => setShowPixsetForm(true)}
              >
                ⚡ Привязать аккаунт Pixset Studio
              </button>
            ) : (
              <form onSubmit={handleLinkPixsetStudio} style={{ marginTop: 12 }}>
                <div className="field">
                  <label>Никнейм или Email Pixset Studio</label>
                  <input
                    className="input"
                    value={pixsetLogin}
                    onChange={(e) => setPixsetLogin(e.target.value)}
                    placeholder="никнейм или email"
                    required
                  />
                </div>
                <div className="field">
                  <label>Пароль</label>
                  <input
                    className="input"
                    type="password"
                    value={pixsetPassword}
                    onChange={(e) => setPixsetPassword(e.target.value)}
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={pixsetLoading}>
                    {pixsetLoading ? 'Проверяем…' : 'Подтвердить привязку'}
                  </button>
                  <button type="button" className="btn" style={{ width: 'auto' }} onClick={() => setShowPixsetForm(false)}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      <div className="section-title">Способы входа</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Привяжите дополнительный способ входа — пригодится, если забудете пароль или потеряете доступ к одному из аккаунтов.
        </p>
        <div className="btn-row" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
          <button className="btn" onClick={() => handleLinkProvider('google')} disabled={linkedProviders.includes('google')}>
            {linkedProviders.includes('google') ? '✓ Google привязан' : 'Привязать Google'}
          </button>
        </div>

        {!linkedProviders.includes('email') && (
          <form onSubmit={handleLinkEmailPassword}>
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Привязать вход по email и паролю:</p>
            <div className="field">
              <label>Email</label>
              <input className="input" type="email" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} required />
            </div>
            <div className="field">
              <label>Пароль</label>
              <input
                className="input"
                type="password"
                value={linkPassword}
                onChange={(e) => setLinkPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
            <button type="submit" className="btn" style={{ width: 'auto' }}>
              Привязать email
            </button>
          </form>
        )}

        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 13.5 }}>Пароль от аккаунта</span>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Забыли пароль или хотите изменить его на новый?
            </p>
          </div>
          <Link
            href="/reset-password"
            className="btn"
            style={{ width: 'auto', padding: '6px 14px', fontSize: 12.5, borderColor: 'var(--accent)', color: 'var(--accent)' }}
          >
            Сбросить / изменить пароль →
          </Link>
        </div>
      </div>

      <div className="section-title">Приватность</div>
      <div className="card">
        <div className="field">
          <label>Кто может писать мне первым</label>
          <select
            className="input"
            value={whoCanMessage}
            onChange={(e) => setWhoCanMessage(e.target.value as any)}
          >
            <option value="everyone">Все</option>
            <option value="friends_only">Только друзья</option>
            <option value="nobody">Никто (даже друзья)</option>
          </select>
        </div>

        <div className="field">
          <label>Кто видит моё время последнего захода</label>
          <select
            className="input"
            value={showLastSeen}
            onChange={(e) => setShowLastSeen(e.target.value as any)}
          >
            <option value="everyone">Всем</option>
            <option value="friends_only">Друзьям</option>
            <option value="nobody">Некому</option>
          </select>
        </div>

        <div className="field">
          <label>Кто может добавлять меня в группы и каналы</label>
          <select
            className="input"
            value={whoCanAdd}
            onChange={(e) => setWhoCanAdd(e.target.value as any)}
          >
            <option value="everyone">Все</option>
            <option value="friends_only">Только друзья</option>
            <option value="nobody">Никто</option>
          </select>
        </div>

        <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleSavePrivacy}>
          Сохранить приватность
        </button>
      </div>

      <div className="section-title">🔐 Двухфакторная аутентификация (2FA / Облачный пароль)</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
          Защитите свой аккаунт дополнительным облачным паролем при входе с новых устройств.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, cursor: 'pointer' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Включить облачный пароль (2FA)</span>
          <input
            type="checkbox"
            checked={twoFactor.enabled}
            onChange={(e) => {
              const enabled = e.target.checked;
              const next = { ...twoFactor, enabled };
              setTwoFactor(next);
              save2FAConfig(next);
              setNotice(enabled ? 'Двухфакторная защита включена 🔐' : 'Двухфакторная защита отключена');
              setTimeout(() => setNotice(null), 1500);
            }}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
        </label>

        {twoFactor.enabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label>Облачный пароль 2FA</label>
              <input
                type="password"
                className="input"
                value={twoFactorPassDraft}
                onChange={(e) => setTwoFactorPassDraft(e.target.value)}
                placeholder="Введите 2FA пароль…"
              />
            </div>
            <div className="field">
              <label>Подсказка к паролю</label>
              <input
                type="text"
                className="input"
                value={twoFactorHintDraft}
                onChange={(e) => setTwoFactorHintDraft(e.target.value)}
                placeholder="Подсказка (не обязательна)…"
              />
            </div>
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto' }}
              onClick={() => {
                if (!twoFactorPassDraft.trim()) {
                  setError('Пароль 2FA не может быть пустым');
                  setTimeout(() => setError(null), 2000);
                  return;
                }
                const next: TwoFactorConfig = {
                  enabled: true,
                  passwordHash: twoFactorPassDraft.trim(),
                  hint: twoFactorHintDraft.trim(),
                  recoveryCode: `REC-${Date.now().toString(36).toUpperCase()}`,
                  updatedAt: new Date().toISOString(),
                };
                setTwoFactor(next);
                save2FAConfig(next);
                setTwoFactorPassDraft('');
                setNotice('Облачный 2FA пароль успешно сохранён!');
                setTimeout(() => setNotice(null), 1800);
              }}
            >
              Сохранить облачный пароль
            </button>
          </div>
        )}
      </div>

      <div className="section-title">🌐 Автопереводчик сообщений</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Автоматический перевод входящих сообщений</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Показывать кнопку и плашку автоперевода для сообщений
            </div>
          </div>
          <input
            type="checkbox"
            checked={autoTranslate}
            onChange={(e) => {
              const enabled = e.target.checked;
              setAutoTranslate(enabled);
              setAutoTranslatePref(enabled);
              setNotice(enabled ? 'Автопереводчик включён 🌐' : 'Автопереводчик отключён');
              setTimeout(() => setNotice(null), 1500);
            }}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
        </label>
      </div>
      <div className="section-title">🛡️ Защита от скриншотов и сохранения</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Защита контента и сохранений</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Запрещает выделение текста, сохранение фото/видео по правому клику и перетаскивание файлов из чатов
            </div>
          </div>
          <input
            type="checkbox"
            checked={screenshotGuard}
            onChange={(e) => {
              const enabled = e.target.checked;
              setScreenshotGuard(enabled);
              setScreenshotGuardEnabled(enabled);
              setNotice(enabled ? 'Защита от скриншотов и сохранения включена 🛡️' : 'Защита от скриншотов отключена');
              setTimeout(() => setNotice(null), 1500);
            }}
            style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
          />
        </label>
      </div>

      <div className="section-title">🔄 Обновления и справка</div>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
          Нативные клиенты Windows (.exe) и Android (.apk) автоматически проверяют выход новой версии PixChats, показывают список изменений («Что нового») и обновляются поверх текущей установки.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary btn-compact"
            onClick={() => {
              triggerManualUpdateCheck();
              setNotice('Запущена проверка новой версии PixChats…');
              setTimeout(() => setNotice(null), 2000);
            }}
          >
            🔄 Проверить обновления
          </button>
          <Link href="/faq" className="btn btn-compact" style={{ textDecoration: 'none' }}>
            ❓ Вопросы и ответы (FAQ)
          </Link>
        </div>
      </div>
      </>
      )}
    </main>
    <BottomNav />
    </DesktopShell>
  );
}
