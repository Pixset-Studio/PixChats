'use client';

import React, { useEffect, useRef, useState } from 'react';
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
  isStaff,
  isDeveloperProfile,
} from '@pixchats/core';
import type { Profile, PixsetStudioAccount, AppTheme } from '@pixchats/core';
import { BottomNav } from '../../components/BottomNav';
import { DesktopShell } from '../../components/DesktopShell';
import { NameWithBadges } from '../../components/NameBadges';
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
import {
  ensureNotificationPermissionEverywhere,
  requestPermissionNow,
  isMobilePhoneDevice,
  isDesktopOrPcDevice,
} from '../../lib/nativePlatform';
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
import { PasswordInput } from '../../components/PasswordInput';
import {
  getCustomFolders,
  createCustomFolder,
  deleteCustomFolder,
  type CustomChatFolder,
} from '../../lib/chatFolders';
import {
  getUserPremiumStatus,
  syncPremiumRegistryFromCloud,
  formatPremiumRemaining,
  getExtendedProfile,
  saveExtendedProfile,
  syncExtendedProfilesFromCloud,
  hydratePremiumAndExtendedFromProfileRow,
  uploadFavoriteMusicAudio,
  BANNER_PRESETS,
  generatePixsetAvatarSvgDataUrl,
  getUnreadFirstSortEnabled,
  setUnreadFirstSortEnabled,
  getStrangerRequestsFilterEnabled,
  setStrangerRequestsFilterEnabled,
  getPowerSaverConfig,
  savePowerSaverConfig,
  getDataStorageConfig,
  saveDataStorageConfig,
  getIndexedDbCacheStats,
  clearIndexedDbMediaCache,
  type ExtendedProfileData,
  type PowerSaverConfig,
  type DataStorageConfig,
} from '../../lib/premiumAndFeatures';

type SettingsCategoryId =
  | 'menu'
  | 'account'
  | 'chats'
  | 'privacy'
  | 'notifications'
  | 'data'
  | 'folders'
  | 'devices'
  | 'power'
  | 'language'
  | 'premium';

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wallpaperInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const initialCachedMe = getCachedCurrentProfile();
  const [profile, setProfile] = useState<Profile | null>(initialCachedMe);
  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>('menu');

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

  const musicFileInputRef = useRef<HTMLInputElement>(null);
  // Extended profile (Birthday, Music Status, Cover Banner)
  const [extProfile, setExtProfile] = useState<ExtendedProfileData>(() =>
    getExtendedProfile(initialCachedMe?.id, initialCachedMe?.username)
  );
  const [birthDateDraft, setBirthDateDraft] = useState(extProfile.birthDate || '');
  const [musicTitleDraft, setMusicTitleDraft] = useState(extProfile.musicStatus?.title || '');
  const [musicArtistDraft, setMusicArtistDraft] = useState(extProfile.musicStatus?.artist || '');
  const [musicAudioUrlDraft, setMusicAudioUrlDraft] = useState(extProfile.musicStatus?.audioUrl || '');
  const [musicFileNameDraft, setMusicFileNameDraft] = useState(extProfile.musicStatus?.fileName || '');
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [showAvatarGenerator, setShowAvatarGenerator] = useState(false);
  const [avatarSeed, setAvatarSeed] = useState(initialCachedMe?.username || 'pixset');
  const [avatarStyle, setAvatarStyle] = useState<'pixel' | '3d'>('pixel');

  // Premium status
  const [isPremium, setIsPremium] = useState<boolean>(() =>
    getUserPremiumStatus(initialCachedMe?.id, initialCachedMe?.username).active
  );
  const [premiumExpiresAt, setPremiumExpiresAt] = useState<string | null>(() =>
    getUserPremiumStatus(initialCachedMe?.id, initialCachedMe?.username).expiresAt
  );

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
  const [twoFactorPassDraft, setTwoFactorPassDraft] = useState(() => get2FAConfig().passwordHash || '');
  const [twoFactorHintDraft, setTwoFactorHintDraft] = useState(() => get2FAConfig().hint || '');
  const [autoTranslate, setAutoTranslate] = useState(getAutoTranslatePref());
  const [uiLanguage, setUiLanguage] = useState<'ru' | 'en'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('pixchats:ui_lang') as 'ru' | 'en') || 'ru';
    }
    return 'ru';
  });
  const [screenshotGuard, setScreenshotGuard] = useState(isScreenshotGuardEnabled());
  const [strangerFilter, setStrangerFilter] = useState(() => getStrangerRequestsFilterEnabled());

  // Folders & Unread First
  const [customFolders, setCustomFolders] = useState<CustomChatFolder[]>(() => getCustomFolders());
  const [newFolderName, setNewFolderName] = useState('');
  const [unreadFirstSort, setUnreadFirstSort] = useState(() => getUnreadFirstSortEnabled());

  // Power Saver & Data/Storage
  const [powerSaver, setPowerSaver] = useState<PowerSaverConfig>(() => getPowerSaverConfig());
  const [dataConfig, setDataConfig] = useState<DataStorageConfig>(() => getDataStorageConfig());
  const [cacheStats, setCacheStats] = useState<{ count: number; totalBytes: number }>({ count: 0, totalBytes: 0 });

  // Devices & Camera
  const [deviceSessions, setDeviceSessions] = useState<DeviceSessionInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [terminatingId, setTerminatingId] = useState<string | null>(null);
  const [qrInputCode, setQrInputCode] = useState('');
  const [qrApproving, setQrApproving] = useState(false);
  const [qrCameraOpen, setQrCameraOpen] = useState(false);
  const qrVideoRef = useRef<HTMLVideoElement>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);

  // Emoji Status
  const [emojiStatus, setEmojiStatus] = useState<string | null>(() =>
    initialCachedMe ? getUserEmojiStatus(initialCachedMe.id, initialCachedMe.username) : null
  );
  const [showEmojiStatusPicker, setShowEmojiStatusPicker] = useState(false);

  // Hardware audio/video + Camera Zoom & Enlarge
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
  const [testCamFacing, setTestCamFacing] = useState<'user' | 'environment'>('user');
  const [testCamZoom, setTestCamZoom] = useState<number>(1);
  const [testCamEnlarged, setTestCamEnlarged] = useState<boolean>(false);
  const [qrCamFacing, setQrCamFacing] = useState<'environment' | 'user'>('environment');
  const [isMobilePhone, setIsMobilePhone] = useState<boolean>(() => isMobilePhoneDevice());
  const [isPcDevice, setIsPcDevice] = useState<boolean>(() => isDesktopOrPcDevice());
  const testCamVideoRef = useRef<HTMLVideoElement | null>(null);
  const testMicStreamRef = useRef<MediaStream | null>(null);
  const testCamStreamRef = useRef<MediaStream | null>(null);
  const testMicRafRef = useRef<number | null>(null);

  useEffect(() => {
    setIsMobilePhone(isMobilePhoneDevice());
    setIsPcDevice(isDesktopOrPcDevice());
    void getIndexedDbCacheStats().then(setCacheStats);
  }, []);

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

  async function startCamTestWithFacing(facing: 'user' | 'environment') {
    if (testCamStreamRef.current) {
      testCamStreamRef.current.getTracks().forEach((t) => t.stop());
      testCamStreamRef.current = null;
    }
    try {
      const videoConstraints =
        isMobilePhone
          ? { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }
          : selectedVideoInput
            ? { deviceId: { exact: selectedVideoInput }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { width: { ideal: 1280 }, height: { ideal: 720 } };
      const stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints,
        audio: false,
      });
      testCamStreamRef.current = stream;
      setTestCamFacing(facing);
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

  async function toggleCamTest() {
    if (testingCam) {
      stopHardwareTests();
      return;
    }
    await startCamTestWithFacing(testCamFacing);
  }

  async function flipCamTest() {
    const nextFacing = testCamFacing === 'user' ? 'environment' : 'user';
    await startCamTestWithFacing(nextFacing);
  }

  function applyTestCamZoom(nextZoom: number) {
    setTestCamZoom(nextZoom);
    try {
      const track = testCamStreamRef.current?.getVideoTracks()?.[0];
      if (track && typeof track. getCapabilities === 'function') {
        const caps = track.getCapabilities() as any;
        if (caps && 'zoom' in caps) {
          const minZ = caps.zoom?.min ?? 1;
          const maxZ = caps.zoom?.max ?? 3;
          const clamped = Math.max(minZ, Math.min(maxZ, nextZoom));
          void track.applyConstraints({ advanced: [{ zoom: clamped } as any] }).catch(() => {});
        }
      }
    } catch {}
  }

  useEffect(() => {
    void refreshHardwareDevices();
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qrApproveParam = params.get('qr_approve');
      const catParam = params.get('cat') as SettingsCategoryId | null;
      if (catParam) {
        setActiveCategory(catParam);
      }
      if (qrApproveParam) {
        const clean = normalizeQrCodeInput(qrApproveParam);
        if (clean) {
          setActiveCategory('devices');
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
      setThemeState(getCurrentTheme());
      setWhoCanMessage(me.privacy_who_can_message);
      setShowLastSeen(me.privacy_show_last_seen);
      setWhoCanAdd(me.privacy_who_can_add_to_groups);

      hydratePremiumAndExtendedFromProfileRow(me);
      const prem = getUserPremiumStatus(me.id, me.username);
      setIsPremium(prem.active);
      setPremiumExpiresAt(prem.expiresAt);
      const ext = getExtendedProfile(me.id, me.username);
      setExtProfile(ext);
      setBirthDateDraft(ext.birthDate || '');
      setMusicTitleDraft(ext.musicStatus?.title || '');
      setMusicArtistDraft(ext.musicStatus?.artist || '');
      setMusicAudioUrlDraft(ext.musicStatus?.audioUrl || '');
      setMusicFileNameDraft(ext.musicStatus?.fileName || '');

      void syncPremiumRegistryFromCloud(false).then(() => {
        const p2 = getUserPremiumStatus(me.id, me.username);
        setIsPremium(p2.active);
        setPremiumExpiresAt(p2.expiresAt);
      });
      void syncExtendedProfilesFromCloud(false).then(() => {
        const ext2 = getExtendedProfile(me.id, me.username);
        setExtProfile(ext2);
        setBirthDateDraft(ext2.birthDate || '');
        setMusicTitleDraft(ext2.musicStatus?.title || '');
        setMusicArtistDraft(ext2.musicStatus?.artist || '');
        setMusicAudioUrlDraft(ext2.musicStatus?.audioUrl || '');
        setMusicFileNameDraft(ext2.musicStatus?.fileName || '');
      });

      try {
        setLinkedProviders((await getLinkedIdentities()).map((i) => i.provider));
      } catch {}
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
          ? 'Автозапуск со стартом системы (.exe) включён'
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
          ? 'Работа в фоне со старта системы (в системном трее без открытия окна) включена'
          : 'Приложение на ПК будет сразу открывать окно при запуске'
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
      const nextExt = await saveExtendedProfile(
        profile.id,
        {
          birthDate: birthDateDraft || null,
          musicStatus:
            musicTitleDraft.trim() || musicAudioUrlDraft.trim()
              ? {
                  title: musicTitleDraft.trim() || musicFileNameDraft.replace(/\.[^/.]+$/, '') || 'Любимый трек',
                  artist: musicArtistDraft.trim() || 'PixMusic',
                  audioUrl: musicAudioUrlDraft.trim() || null,
                  fileName: musicFileNameDraft.trim() || null,
                }
              : null,
        },
        username
      );
      setExtProfile(nextExt);
      setProfile({ ...profile, display_name: displayName, username, bio });
      setNotice('✅ Данные аккаунта, день рождения и любимая музыка сохранены!');
      setTimeout(() => setNotice(null), 2000);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить');
    }
  }

  async function handleMusicFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploadingMusic(true);
    setError(null);
    try {
      const { audioUrl, fileName } = await uploadFavoriteMusicAudio(profile.id, file);
      setMusicAudioUrlDraft(audioUrl);
      setMusicFileNameDraft(fileName);
      if (!musicTitleDraft.trim()) {
        setMusicTitleDraft(fileName.replace(/\.[^/.]+$/, ''));
      }
      setNotice(`🎵 Аудиофайл «${fileName}» загружен! Нажмите «Сохранить изменения аккаунта», чтобы закрепить его.`);
      setTimeout(() => setNotice(null), 3500);
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить аудиофайл');
    } finally {
      setUploadingMusic(false);
      if (musicFileInputRef.current) musicFileInputRef.current.value = '';
    }
  }

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (!profile || !e.target.files?.[0]) return;
    setAvatarUploading(true);
    setError(null);
    try {
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

  async function handleApplyGeneratedAvatar() {
    if (!profile) return;
    setAvatarUploading(true);
    try {
      const svgUrl = generatePixsetAvatarSvgDataUrl(avatarSeed || profile.username, avatarStyle);
      await updateProfile(profile.id, { avatarUrl: svgUrl });
      setProfile({ ...profile, avatar_url: svgUrl });
      setShowAvatarGenerator(false);
      setNotice('🎨 Сгенерированная аватарка Pixset Studio установлена!');
      setTimeout(() => setNotice(null), 2000);
    } catch (err: any) {
      setError(err?.message || 'Ошибка сохранения аватара');
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
      setNotice('Настройки конфиденциальности сохранены');
      setTimeout(() => setNotice(null), 1600);
    } catch (err: any) {
      setError(err.message ?? 'Не удалось сохранить');
    }
  }

  if (!profile) return null;

  const userIsStaff = isStaff(profile);
  const userIsDeveloper = isDeveloperProfile(profile);

  const CATEGORY_META: Record<Exclude<SettingsCategoryId, 'menu'>, { title: string; icon: string }> = {
    account: { title: 'Аккаунт', icon: '👤' },
    chats: { title: 'Настройки чатов', icon: '💬' },
    privacy: { title: 'Конфиденциальность', icon: '🔑' },
    notifications: { title: 'Уведомления', icon: '🔊' },
    data: { title: 'Данные и память', icon: '🥧' },
    folders: { title: 'Папки с чатами', icon: '📁' },
    devices: { title: 'Устройства', icon: '💻' },
    power: { title: 'Энергосбережение', icon: '🔋' },
    language: { title: 'Язык', icon: '🌐' },
    premium: { title: 'PixChats Premium', icon: '⭐' },
  };

  return (
    <DesktopShell>
      <main className="container-wide with-bottom-nav">
        <header className="app-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {activeCategory !== 'menu' && (
              <button
                type="button"
                className="btn btn-ghost btn-compact"
                style={{ width: 'auto', padding: '6px 12px', fontWeight: 700 }}
                onClick={() => {
                  stopHardwareTests();
                  setActiveCategory('menu');
                }}
              >
                ← Назад
              </button>
            )}
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 20, margin: 0 }}>
              {activeCategory === 'menu'
                ? 'Настройки'
                : `${CATEGORY_META[activeCategory].icon} ${CATEGORY_META[activeCategory].title}`}
            </h1>
          </div>
          <Link href="/chats/" className="btn btn-ghost" style={{ width: 'auto' }}>
            ← К чатам
          </Link>
        </header>

        {notice && <p className="notice">{notice}</p>}
        {error && <p className="error">{error}</p>}

        {/* ГЛАВНОЕ МЕНЮ КАТЕГОРИЙ НАСТРОЕК (как на скриншоте) */}
        {activeCategory === 'menu' && (
          <div>
            {/* Шапка профиля в настройках */}
            <div
              className="card"
              style={{
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
                flexWrap: 'wrap',
                background: extProfile.bannerUrl
                  ? `linear-gradient(180deg, rgba(14,14,20,0.68), rgba(14,14,20,0.92)), ${
                      extProfile.bannerUrl.startsWith('data:') || extProfile.bannerUrl.startsWith('http')
                        ? `url(${extProfile.bannerUrl})`
                        : extProfile.bannerUrl
                    }`
                  : undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                <div
                  className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
                  style={{
                    width: 60,
                    height: 60,
                    fontSize: 22,
                    backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    border: '2px solid var(--accent)',
                    flexShrink: 0,
                  }}
                >
                  {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 17, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <NameWithBadges
                      name={profile.display_name}
                      role={profile.role}
                      isVerified={profile.is_verified}
                      isPixsetEmployee={profile.is_pixset_employee}
                      userId={profile.id}
                      username={profile.username}
                    />
                    {isPremium && (
                      <span className="premium-shimmer-badge" style={{ fontSize: 10 }}>
                        ★ Premium
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    @{profile.username}
                    {extProfile.birthDate ? ` • 🎂 ${extProfile.birthDate}` : ''}
                  </div>
                  {extProfile.musicStatus && (
                    <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 3, fontWeight: 600 }}>
                      🎵 {extProfile.musicStatus.title} — {extProfile.musicStatus.artist}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  onClick={() => setActiveCategory('account')}
                >
                  ✏️ Изменить
                </button>
                <Link href="/profile/" className="btn btn-compact">
                  👤 Профиль
                </Link>
              </div>
            </div>

            {/* Список категорий как на скриншоте */}
            <div className="settings-category-list" style={{ marginBottom: 18 }}>
              <button
                type="button"
                className="settings-category-row"
                onClick={() => setActiveCategory('account')}
              >
                <span className="settings-category-icon" style={{ background: '#0ea5e9' }}>
                  👤
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Аккаунт</div>
                  <div className="settings-category-subtitle">
                    Номер, имя пользователя, «О себе», день рождения
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => setActiveCategory('chats')}
              >
                <span className="settings-category-icon" style={{ background: '#f59e0b' }}>
                  💬
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Настройки чатов</div>
                  <div className="settings-category-subtitle">
                    Обои, ночной режим, анимации, размер текста и углы пузырей
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => setActiveCategory('privacy')}
              >
                <span className="settings-category-icon" style={{ background: '#22c55e' }}>
                  🔑
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Конфиденциальность</div>
                  <div className="settings-category-subtitle">
                    Время захода, устройства, ключи доступа, фильтр запросов
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => setActiveCategory('notifications')}
              >
                <span className="settings-category-icon" style={{ background: '#ef4444' }}>
                  🔊
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Уведомления</div>
                  <div className="settings-category-subtitle">
                    Звуки, звонки, счётчик сообщений{isPcDevice ? ', работа в фоне на ПК' : ''}
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => {
                  void getIndexedDbCacheStats().then(setCacheStats);
                  setActiveCategory('data');
                }}
              >
                <span className="settings-category-icon" style={{ background: '#3b82f6' }}>
                  🥧
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Данные и память</div>
                  <div className="settings-category-subtitle">
                    Настройки загрузки медиафайлов, сжатие видео, кэш ({cacheStats.count} файл.)
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => {
                  setCustomFolders(getCustomFolders());
                  setActiveCategory('folders');
                }}
              >
                <span className="settings-category-icon" style={{ background: '#0284c7' }}>
                  📁
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Папки с чатами</div>
                  <div className="settings-category-subtitle">
                    Сортировка чатов по папкам ({customFolders.length}), режим «Сначала непрочитанные»
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => {
                  setActiveCategory('devices');
                  void handleRefreshDevices();
                }}
              >
                <span className="settings-category-icon" style={{ background: '#06b6d4' }}>
                  💻
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Устройства</div>
                  <div className="settings-category-subtitle">
                    Управление активными сеансами ({Math.max(1, deviceSessions.length)}), камера и микрофон
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => setActiveCategory('power')}
              >
                <span className="settings-category-icon" style={{ background: '#f97316' }}>
                  🔋
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Энергосбережение</div>
                  <div className="settings-category-subtitle">
                    Экономия энергии при низком заряде ({powerSaver.enabled ? 'Включено' : 'Выключено'})
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => setActiveCategory('language')}
              >
                <span className="settings-category-icon" style={{ background: '#a855f7' }}>
                  🌐
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title">Язык</div>
                  <div className="settings-category-subtitle">
                    {uiLanguage === 'ru' ? 'Русский' : 'English'} • Автопереводчик {autoTranslate ? 'вкл.' : 'выкл.'}
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>

              <button
                type="button"
                className="settings-category-row"
                onClick={() => setActiveCategory('premium')}
              >
                <span
                  className="settings-category-icon"
                  style={{
                    background: 'linear-gradient(135deg, #ffd400, #f59e0b)',
                    color: '#000',
                  }}
                >
                  ⭐
                </span>
                <div className="settings-category-body">
                  <div className="settings-category-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>PixChats Premium</span>
                    {isPremium && (
                      <span className="premium-shimmer-badge" style={{ fontSize: 10 }}>
                        АКТИВЕН
                      </span>
                    )}
                  </div>
                  <div className="settings-category-subtitle">
                    Эмодзи-статусы, до 3 реакций, безлимитные истории и золотой бейдж
                  </div>
                </div>
                <span className="settings-category-chevron">›</span>
              </button>
            </div>

            {/* На телефоне (и для быстрого доступа в настройках): Панель администратора и AI ассистент */}
            {(userIsStaff || userIsDeveloper) && (
              <div className="settings-category-list" style={{ marginBottom: 18 }}>
                {userIsDeveloper && (
                  <Link href="/ai-assistant/" className="settings-category-row">
                    <span
                      className="settings-category-icon"
                      style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
                    >
                      🤖
                    </span>
                    <div className="settings-category-body">
                      <div className="settings-category-title">AI ассистент (Разработчик)</div>
                      <div className="settings-category-subtitle">
                        Инструменты управления базой, модерацией и агент Antigravity
                      </div>
                    </div>
                    <span className="settings-category-chevron">›</span>
                  </Link>
                )}

                {userIsStaff && (
                  <Link href="/admin/" className="settings-category-row">
                    <span
                      className="settings-category-icon"
                      style={{ background: 'linear-gradient(135deg, #ef4444, #dc2626)' }}
                    >
                      🛡️
                    </span>
                    <div className="settings-category-body">
                      <div className="settings-category-title">Панель администратора</div>
                      <div className="settings-category-subtitle">
                        Управление пользователями, банами, мутами, ролями и PixChats Premium
                      </div>
                    </div>
                    <span className="settings-category-chevron">›</span>
                  </Link>
                )}
              </div>
            )}

            {/* Обновления и FAQ */}
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>🔄 Обновления и справка PixChats</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Проверка новых версий приложения и ответы на частые вопросы
                </div>
              </div>
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
                <Link href="/faq" className="btn btn-compact">
                  ❓ FAQ
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 1: АККАУНТ */}
        {activeCategory === 'account' && (
          <div>
            <div className="section-title">Профиль и личные данные</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
                <div
                  className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
                  style={{
                    width: 68,
                    height: 68,
                    fontSize: 24,
                    backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    border: '2px solid var(--accent)',
                  }}
                >
                  {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={avatarUploading}
                  >
                    {avatarUploading ? 'Загружаем…' : '📷 Сменить аватар'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => setShowAvatarGenerator((v) => !v)}
                  >
                    🎨 Генератор 3D / Пиксель-арт
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

              {showAvatarGenerator && (
                <div
                  style={{
                    marginBottom: 18,
                    padding: 14,
                    borderRadius: 12,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--accent)',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>
                    🎨 Конструктор аватарок в стиле Pixset Studio
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                    <img
                      src={generatePixsetAvatarSvgDataUrl(avatarSeed || profile.username, avatarStyle)}
                      alt="Preview"
                      style={{ width: 64, height: 64, borderRadius: '50%', border: '2px solid var(--accent)' }}
                    />
                    <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className={`btn btn-compact ${avatarStyle === 'pixel' ? 'btn-primary' : ''}`}
                          onClick={() => setAvatarStyle('pixel')}
                        >
                          👾 Пиксель-арт
                        </button>
                        <button
                          type="button"
                          className={`btn btn-compact ${avatarStyle === '3d' ? 'btn-primary' : ''}`}
                          onClick={() => setAvatarStyle('3d')}
                        >
                          🔮 3D Сияние
                        </button>
                        <button
                          type="button"
                          className="btn btn-compact"
                          onClick={() => setAvatarSeed(`${profile.username}-${Math.random().toString(36).slice(2, 6)}`)}
                        >
                          🎲 Случайный
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-compact"
                        onClick={handleApplyGeneratedAvatar}
                        disabled={avatarUploading}
                      >
                        ✨ Установить эту аватарку
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <form onSubmit={handleSaveProfile}>
                <div className="field">
                  <label>Имя пользователя (Юзернейм)</label>
                  <div className="input-prefix">
                    <span>@</span>
                    <input
                      className="input"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))}
                    />
                  </div>
                </div>
                <div className="field">
                  <label>Отображаемое имя</label>
                  <input
                    className="input"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
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

                {/* День рождения */}
                <div className="field">
                  <label>🎂 День рождения (друзья получат уведомление и смогут поздравить вас в 1 клик)</label>
                  <input
                    type="date"
                    className="input"
                    value={birthDateDraft}
                    onChange={(e) => setBirthDateDraft(e.target.value)}
                  />
                </div>

                {/* Музыкальный статус */}
                <div className="field">
                  <label>🎵 Любимая музыка в профиле (можно загрузить файл, чтобы другие могли прослушать)</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                    <input
                      className="input"
                      placeholder="Название трека…"
                      value={musicTitleDraft}
                      onChange={(e) => setMusicTitleDraft(e.target.value)}
                    />
                    <input
                      className="input"
                      placeholder="Исполнитель…"
                      value={musicArtistDraft}
                      onChange={(e) => setMusicArtistDraft(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                    <input
                      ref={musicFileInputRef}
                      type="file"
                      accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                      style={{ display: 'none' }}
                      onChange={handleMusicFileUpload}
                    />
                    <button
                      type="button"
                      className="btn btn-compact"
                      disabled={uploadingMusic}
                      style={{ borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 700 }}
                      onClick={() => musicFileInputRef.current?.click()}
                    >
                      {uploadingMusic ? '⏳ Загрузка трека…' : '📂 Загрузить аудиофайл (MP3/WAV/OGG/M4A)'}
                    </button>
                    {musicAudioUrlDraft && (
                      <button
                        type="button"
                        className="btn btn-compact"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => {
                          setMusicAudioUrlDraft('');
                          setMusicFileNameDraft('');
                        }}
                      >
                        ✕ Удалить аудиофайл
                      </button>
                    )}
                  </div>
                  <input
                    className="input"
                    style={{ marginTop: 8, fontSize: 12 }}
                    placeholder="Или вставьте прямую ссылку на аудиофайл (https://.../track.mp3)…"
                    value={musicAudioUrlDraft}
                    onChange={(e) => setMusicAudioUrlDraft(e.target.value)}
                  />
                  {musicAudioUrlDraft && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '8px 10px',
                        borderRadius: 10,
                        background: 'var(--surface-2)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <div style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>
                        🎧 Прикреплённый трек: {musicFileNameDraft || musicTitleDraft || 'Аудиофайл готов к прослушиванию'}
                      </div>
                      <audio controls preload="metadata" src={musicAudioUrlDraft} style={{ width: '100%', height: 34 }} />
                    </div>
                  )}
                </div>

                <button type="submit" className="btn btn-primary" style={{ width: 'auto' }}>
                  💾 Сохранить изменения аккаунта
                </button>
              </form>

              {/* Кастомный баннер профиля */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>🖼️ Шапка (баннер) профиля</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {BANNER_PRESETS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      className="btn btn-compact"
                      style={{
                        background: b.css,
                        color: '#fff',
                        borderColor: extProfile.bannerUrl === b.css ? 'var(--accent)' : 'var(--border)',
                      }}
                      onClick={async () => {
                        const next = await saveExtendedProfile(profile.id, { bannerUrl: b.css }, profile.username);
                        setExtProfile(next);
                        setNotice(`Установлен баннер «${b.label}»`);
                        setTimeout(() => setNotice(null), 1500);
                      }}
                    >
                      {b.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => bannerInputRef.current?.click()}
                  >
                    📤 Своя картинка
                  </button>
                  <input
                    ref={bannerInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const dataUrl = await fileToBase64Image(file, 960, 0.82, { cropSquare: false });
                      const next = await saveExtendedProfile(profile.id, { bannerUrl: dataUrl }, profile.username);
                      setExtProfile(next);
                      setNotice('Своя обложка профиля установлена!');
                      setTimeout(() => setNotice(null), 1500);
                    }}
                  />
                </div>
              </div>

              {/* Эмодзи-статус — только с PixChats Premium */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                {isPremium ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14 }}>
                          ✨ Эмодзи-статус PixChats Premium:{' '}
                          <span style={{ color: 'var(--accent)', fontSize: 17 }}>{emojiStatus || 'Нет'}</span>
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Отображается справа от вашего имени во всех чатах и профиле
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
                  </>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      flexWrap: 'wrap',
                      padding: '10px 14px',
                      borderRadius: 12,
                      background: 'rgba(255, 212, 0, 0.08)',
                      border: '1px solid rgba(255, 212, 0, 0.3)',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>⭐ Эмодзи-статус доступен в PixChats Premium</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        С подпиской Premium вы сможете ставить любой эмодзи или флаг рядом со своим именем
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-compact"
                      onClick={() => setActiveCategory('premium')}
                    >
                      Подробнее о Premium
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="section-title">Учётная запись Pixset Studio</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>
                Интеграция с единым порталом Pixset Studio (pixset-studio.github.io). Привязка аккаунта подтверждает статус сотрудника студии и синхронизирует профиль.
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
              ) : !showPixsetForm ? (
                <button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => setShowPixsetForm(true)}>
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
                      required
                    />
                  </div>
                  <div className="field">
                    <label>Пароль</label>
                    <PasswordInput
                      className="input"
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

            <div className="section-title">Способы входа и пароль</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="btn-row" style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 }}>
                <button className="btn" onClick={() => handleLinkProvider('google')} disabled={linkedProviders.includes('google')}>
                  {linkedProviders.includes('google') ? '✓ Google привязан' : 'Привязать Google'}
                </button>
              </div>
              {!linkedProviders.includes('email') && (
                <form onSubmit={handleLinkEmailPassword}>
                  <div className="field">
                    <label>Email</label>
                    <input className="input" type="email" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} required />
                  </div>
                  <div className="field">
                    <label>Пароль</label>
                    <PasswordInput
                      className="input"
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
                    Сбросить или сменить пароль входа в PixChats
                  </p>
                </div>
                <Link href="/reset-password" className="btn btn-compact" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                  Сбросить / изменить пароль →
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 2: НАСТРОЙКИ ЧАТОВ */}
        {activeCategory === 'chats' && (
          <div>
            <div className="section-title">Тема оформления</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="theme-picker-grid">
                {PIXSET_THEMES.map((item) => {
                  const isSelected =
                    theme === item.id ||
                    (theme === 'dark' && item.id === 'pixchats') ||
                    (theme === 'byte_blaster' && item.id === 'byteblaster');
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

            <div className="section-title">Обои, размер текста и углы пузырей</div>
            <div className="card" style={{ marginBottom: 24 }}>
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
                  🖼️ Загрузить свои обои чата
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
                    <span>Затемнение: {appearance.wallpaperDimming}%</span>
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
                </div>
              </div>
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 3: КОНФИДЕНЦИАЛЬНОСТЬ */}
        {activeCategory === 'privacy' && (
          <div>
            <div className="section-title">Кто видит мои данные</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <div className="field">
                <label>Кто может писать мне первым</label>
                <select className="input" value={whoCanMessage} onChange={(e) => setWhoCanMessage(e.target.value as any)}>
                  <option value="everyone">Все</option>
                  <option value="friends_only">Только друзья</option>
                  <option value="nobody">Никто (даже друзья)</option>
                </select>
              </div>
              <div className="field">
                <label>Кто видит моё время последнего захода</label>
                <select className="input" value={showLastSeen} onChange={(e) => setShowLastSeen(e.target.value as any)}>
                  <option value="everyone">Всем</option>
                  <option value="friends_only">Друзьям</option>
                  <option value="nobody">Никому</option>
                </select>
              </div>
              <div className="field">
                <label>Кто может добавлять меня в группы и каналы</label>
                <select className="input" value={whoCanAdd} onChange={(e) => setWhoCanAdd(e.target.value as any)}>
                  <option value="everyone">Все</option>
                  <option value="friends_only">Только друзья</option>
                  <option value="nobody">Никто</option>
                </select>
              </div>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'var(--bg-secondary)',
                  border: `1px solid ${strangerFilter ? 'var(--accent)' : 'var(--border)'}`,
                  marginBottom: 14,
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>📩 Фильтр входящих сообщений от незнакомцев</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Новые диалоги от людей не из списка друзей попадают в отдельную вкладку «📩 Запросы»
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={strangerFilter}
                  onChange={(e) => {
                    setStrangerFilter(e.target.checked);
                    setStrangerRequestsFilterEnabled(e.target.checked);
                    setNotice(
                      e.target.checked
                        ? 'Фильтр «📩 Запросы» от незнакомцев включён'
                        : 'Фильтр запросов отключён'
                    );
                    setTimeout(() => setNotice(null), 1600);
                  }}
                  style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                />
              </label>

              <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleSavePrivacy}>
                Сохранить конфиденциальность
              </button>
            </div>

            <div className="section-title">🔐 Защита входа PIN-кодом и Скрытые чаты</div>
            <div className="card" style={{ marginBottom: 24 }}>
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
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Включить блокировку приложения по PIN-коду</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      Этот же PIN-код открывает скрытые чаты при вводе в поиск чатов
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
                    <PasswordInput
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
                    Сохранить PIN
                  </button>
                  {appLock.enabled && appLock.pinCode && (
                    <button type="button" className="btn" style={{ width: 'auto' }} onClick={() => lockSessionNow()}>
                      🔒 Заблокировать сейчас
                    </button>
                  )}
                </div>
              </form>
            </div>

            <div className="section-title">🛡️ Облачный пароль (2FA) и Защита контента</div>
            <div className="card" style={{ marginBottom: 24 }}>
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
                  }}
                  style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                />
              </label>

              {twoFactor.enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
                  <div className="field">
                    <label>Облачный пароль 2FA</label>
                    <PasswordInput
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
                    />
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: 'auto' }}
                    onClick={() => {
                      if (!twoFactorPassDraft.trim()) return;
                      const next: TwoFactorConfig = {
                        enabled: true,
                        passwordHash: twoFactorPassDraft.trim(),
                        hint: twoFactorHintDraft.trim(),
                        recoveryCode: `REC-${Date.now().toString(36).toUpperCase()}`,
                        updatedAt: new Date().toISOString(),
                      };
                      setTwoFactor(next);
                      save2FAConfig(next);
                      setNotice('Облачный 2FA пароль сохранён!');
                      setTimeout(() => setNotice(null), 1800);
                    }}
                  >
                    Сохранить облачный пароль
                  </button>
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border)', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>Защита от скриншотов и копирования</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Запрещает сохранение фото/видео по правому клику и перетаскивание медиафайлов
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={screenshotGuard}
                  onChange={(e) => {
                    const enabled = e.target.checked;
                    setScreenshotGuard(enabled);
                    setScreenshotGuardEnabled(enabled);
                  }}
                  style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                />
              </label>
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 4: УВЕДОМЛЕНИЯ */}
        {activeCategory === 'notifications' && (
          <div>
            <div className="section-title">Настройки уведомлений и звуков</div>
            <div className="card" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { key: 'enabled' as const, title: 'Все уведомления', desc: 'Главный переключатель всех уведомлений' },
                { key: 'directMessages' as const, title: 'Личные сообщения', desc: 'Новые сообщения в личных диалогах' },
                { key: 'incomingCalls' as const, title: 'Входящие звонки', desc: 'Звуковой вызов при аудио- и видеозвонке' },
                { key: 'groupMessages' as const, title: 'Группы и каналы', desc: 'Новые сообщения в группах и каналах' },
                { key: 'mentions' as const, title: 'Упоминания (@username)', desc: 'Когда вас отмечают через @' },
                { key: 'friendRequests' as const, title: 'Заявки в друзья и дни рождения', desc: 'Новые друзья и напоминания о днях рождения друзей' },
                { key: 'chatInvites' as const, title: 'Приглашения в чаты', desc: 'Когда вас добавляют в новую группу' },
                { key: 'accountEvents' as const, title: 'Статус аккаунта и бейджи', desc: 'Изменение роли, верификации или Premium' },
                { key: 'sound' as const, title: 'Звуковой сигнал', desc: 'Проигрывать мелодию уведомления' },
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
                      border: '1px solid var(--border)',
                      opacity: isDisabled ? 0.5 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.desc}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isDisabled}
                      onChange={(e) => handleToggleNotifPref(item.key, e.target.checked)}
                      style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                    />
                  </label>
                );
              })}

              {isPcDevice && (
                <>
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
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>🖥️ Автозапуск при старте Windows (.exe)</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Запускать клиент PixChats автоматически при включении компьютера
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={desktopAutoStart}
                      onChange={(e) => handleToggleDesktopAutoStart(e.target.checked)}
                      style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
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
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        🕶️ Запускать в фоновом режиме (в системном трее без открытия окна)
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        При старте системы приложение работает в фоне в трее (возле часов) без открытия окна и принимает звонки и сообщения
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={desktopLaunchMinimized}
                      onChange={(e) => handleToggleDesktopLaunchMinimized(e.target.checked)}
                      style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                    />
                  </label>
                </>
              )}
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 5: ДАННЫЕ И ПАМЯТЬ */}
        {activeCategory === 'data' && (
          <div>
            <div className="section-title">Автозагрузка медиафайлов и экономия трафика</div>
            <div className="card" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { key: 'autoDownloadPhotos' as const, title: 'Автозагрузка фотографий', desc: 'Сразу показывать фотографии в чатах без нажатия' },
                { key: 'autoDownloadVideos' as const, title: 'Автозагрузка видео и кружочков', desc: 'Предзагружать видеосообщения и видеоролики' },
                { key: 'autoDownloadVoice' as const, title: 'Автозагрузка голосовых сообщений', desc: 'Предзагружать аудиозаписи для мгновенного прослушивания' },
                { key: 'autoDownloadFiles' as const, title: 'Автозагрузка документов и файлов', desc: 'Предзагружать прикреплённые файлы' },
                { key: 'indexedDbCacheEnabled' as const, title: 'Локальное кэширование медиа в IndexedDB', desc: 'Сохранять просмотренные фото и аудио на устройстве для мгновенного открытия и экономии квоты Supabase' },
              ].map((item) => (
                <label
                  key={item.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.desc}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(dataConfig[item.key])}
                    onChange={(e) => {
                      const next = saveDataStorageConfig({ [item.key]: e.target.checked });
                      setDataConfig(next);
                    }}
                    style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                  />
                </label>
              ))}

              <div className="field" style={{ marginTop: 6 }}>
                <label>🎬 Качество сжатия видео при отправке по умолчанию</label>
                <select
                  className="input"
                  value={dataConfig.defaultVideoQuality}
                  onChange={(e) => {
                    const next = saveDataStorageConfig({
                      defaultVideoQuality: e.target.value as '480p' | '720p' | '1080p' | 'original',
                    });
                    setDataConfig(next);
                    setNotice(`Качество видео по умолчанию: ${e.target.value}`);
                    setTimeout(() => setNotice(null), 1500);
                  }}
                >
                  <option value="480p">480p (Максимальная экономия трафика)</option>
                  <option value="720p">720p HD (Рекомендуется — баланс качества и скорости)</option>
                  <option value="1080p">1080p Full HD (Высокое качество)</option>
                  <option value="original">Оригинал (Без сжатия)</option>
                </select>
              </div>
            </div>

            <div className="section-title">Локальное хранилище и кэш IndexedDB</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>
                    📦 Закэшировано файлов: <span style={{ color: 'var(--accent)' }}>{cacheStats.count}</span> (
                    {(cacheStats.totalBytes / (1024 * 1024)).toFixed(2)} МБ)
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Кэш хранит медиафайлы локально в браузере/приложении, чтобы не скачивать их повторно из базы
                  </div>
                </div>
                <button
                  type="button"
                  className="btn btn-compact"
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)', fontWeight: 700 }}
                  onClick={async () => {
                    await clearIndexedDbMediaCache();
                    setCacheStats({ count: 0, totalBytes: 0 });
                    setNotice('🧹 Кэш медиафайлов IndexedDB успешно очищен!');
                    setTimeout(() => setNotice(null), 1800);
                  }}
                >
                  🧹 Очистить кэш
                </button>
              </div>
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 6: ПАПКИ С ЧАТАМИ */}
        {activeCategory === 'folders' && (
          <div>
            <div className="section-title">Режим сортировки и папки</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  padding: '12px',
                  borderRadius: 10,
                  background: 'var(--bg-secondary)',
                  border: `1px solid ${unreadFirstSort ? 'var(--accent)' : 'var(--border)'}`,
                  cursor: 'pointer',
                  marginBottom: 18,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>🔥 Режим «Сначала непрочитанные»</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Автоматически поднимать чаты с непрочитанными сообщениями наверх списка во всех папках
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={unreadFirstSort}
                  onChange={(e) => {
                    setUnreadFirstSort(e.target.checked);
                    setUnreadFirstSortEnabled(e.target.checked);
                    setNotice(
                      e.target.checked
                        ? 'Сортировка «Сначала непрочитанные» включена'
                        : 'Стандартная сортировка по времени последнего сообщения'
                    );
                    setTimeout(() => setNotice(null), 1600);
                  }}
                  style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                />
              </label>

              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>📁 Создать новую папку</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                <input
                  className="input"
                  placeholder="Название папки (напр. Работа, Игры, Важное)…"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  style={{ width: 'auto' }}
                  onClick={() => {
                    if (!newFolderName.trim()) return;
                    createCustomFolder(newFolderName.trim());
                    setCustomFolders(getCustomFolders());
                    setNewFolderName('');
                    setNotice('📁 Папка создана!');
                    setTimeout(() => setNotice(null), 1500);
                  }}
                >
                  + Создать
                </button>
              </div>

              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
                Ваши папки ({customFolders.length})
              </div>
              {customFolders.length === 0 ? (
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  У вас пока нет пользовательских папок. Создайте папку выше и добавляйте в неё чаты через меню чата.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {customFolders.map((f) => (
                    <div
                      key={f.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div>
                        <span style={{ fontWeight: 700 }}>📁 {f.name}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>
                          Чатов: {f.chatIds.length}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-compact"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                        onClick={() => {
                          deleteCustomFolder(f.id);
                          setCustomFolders(getCustomFolders());
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
        )}

        {/* КАТЕГОРИЯ 7: УСТРОЙСТВА + КАМЕРА С УВЕЛИЧЕНИЕМ */}
        {activeCategory === 'devices' && (
          <div>
            <div className="section-title">
              🎙️📹 Микрофон, камера и масштабирование {isMobilePhone ? '(Телефон)' : '(ПК и Веб)'}
            </div>
            <div className="card" style={{ marginBottom: 24 }}>
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
                    <b style={{ color: micPermission === 'granted' ? '#22c55e' : 'var(--accent)' }}>
                      {micPermission === 'granted' ? 'Разрешено ✓' : 'Ожидает запроса'}
                    </b>
                  </span>
                  <span>
                    📹 Камера:{' '}
                    <b style={{ color: camPermission === 'granted' ? '#22c55e' : 'var(--accent)' }}>
                      {camPermission === 'granted' ? 'Разрешено ✓' : 'Ожидает запроса'}
                    </b>
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    onClick={requestMicAndCameraPermissions}
                  >
                    🔓 Запросить доступ
                  </button>
                  {isPcDevice && (
                    <button type="button" className="btn btn-compact" onClick={refreshHardwareDevices}>
                      🔄 Обновить список
                    </button>
                  )}
                </div>
              </div>

              {isPcDevice && (
                <>
                  <div className="field">
                    <label>🎙️ Микрофон</label>
                    <select
                      className="input"
                      value={selectedAudioInput}
                      onChange={(e) => {
                        setSelectedAudioInput(e.target.value);
                        savePreferredMediaDevices({ audioInputId: e.target.value });
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
                    <label>📹 Камера</label>
                    <select
                      className="input"
                      value={selectedVideoInput}
                      onChange={(e) => {
                        setSelectedVideoInput(e.target.value);
                        savePreferredMediaDevices({ videoInputId: e.target.value });
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
                      <label>🔊 Динамики / Наушники</label>
                      <select
                        className="input"
                        value={selectedAudioOutput}
                        onChange={(e) => {
                          setSelectedAudioOutput(e.target.value);
                          savePreferredMediaDevices({ audioOutputId: e.target.value });
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
                </>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button
                  type="button"
                  className={`btn btn-compact ${testingMic ? 'btn-primary' : ''}`}
                  onClick={toggleMicTest}
                >
                  {testingMic ? '⏹ Остановить микрофон' : '🎤 Проверить микрофон'}
                </button>
                <button
                  type="button"
                  className={`btn btn-compact ${testingCam ? 'btn-primary' : ''}`}
                  onClick={toggleCamTest}
                >
                  {testingCam ? '⏹ Остановить камеру' : '📹 Проверить камеру'}
                </button>
                {testingCam && (
                  <button
                    type="button"
                    className="btn btn-compact"
                    onClick={() => setTestCamEnlarged((v) => !v)}
                  >
                    {testCamEnlarged ? '🗕 Обычный размер окна' : '🗖 Увеличить окно камеры'}
                  </button>
                )}
                {isMobilePhone && testingCam && (
                  <button type="button" className="btn btn-compact" onClick={() => void flipCamTest()}>
                    🔄 Перевернуть ({testCamFacing === 'user' ? 'Фронт.' : 'Задняя'})
                  </button>
                )}
              </div>

              {testingMic && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                    Уровень сигнала микрофона: <b style={{ color: 'var(--accent)' }}>{micVolumePct}%</b>
                  </div>
                  <div style={{ height: 10, borderRadius: 999, background: 'var(--surface-raised)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${micVolumePct}%`,
                        height: '100%',
                        background: 'linear-gradient(90deg, #22c55e, #ffd400, #ef4444)',
                      }}
                    />
                  </div>
                </div>
              )}

              {testingCam && (
                <div style={{ marginTop: 14 }}>
                  {/* Ползунок зума камеры 1x - 3x */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      marginBottom: 10,
                      padding: '8px 12px',
                      borderRadius: 10,
                      background: 'var(--bg-secondary)',
                      border: '1px solid var(--border)',
                      maxWidth: testCamEnlarged ? 680 : 380,
                    }}
                  >
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>🔍 Зум камеры: {testCamZoom.toFixed(1)}x</span>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.1}
                      value={testCamZoom}
                      onChange={(e) => applyTestCamZoom(Number(e.target.value))}
                      style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }}
                    />
                    <button
                      type="button"
                      className="btn btn-compact"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => applyTestCamZoom(1)}
                    >
                      1x
                    </button>
                    <button
                      type="button"
                      className="btn btn-compact"
                      style={{ padding: '2px 8px', fontSize: 11 }}
                      onClick={() => applyTestCamZoom(2)}
                    >
                      2x
                    </button>
                  </div>

                  <div
                    style={{
                      maxWidth: testCamEnlarged ? 680 : 380,
                      borderRadius: 14,
                      overflow: 'hidden',
                      border: '2px solid var(--accent)',
                      background: '#000',
                      position: 'relative',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <video
                      ref={testCamVideoRef}
                      muted
                      playsInline
                      autoPlay
                      style={{
                        width: '100%',
                        height: testCamEnlarged ? 420 : 230,
                        objectFit: 'cover',
                        display: 'block',
                        transform: `${testCamFacing === 'user' ? 'scaleX(-1) ' : ''}scale(${testCamZoom})`,
                        transformOrigin: 'center center',
                        transition: 'transform 0.12s ease, height 0.2s ease',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="section-title">📷 Подключить устройство по QR-коду</div>
            <div className="card" style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ flex: 1, minWidth: 160, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700 }}
                  maxLength={8}
                  placeholder="Код с экрана (напр. 8F4K2M)"
                  value={qrInputCode}
                  onChange={(e) => setQrInputCode(e.target.value.toUpperCase())}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-compact"
                  disabled={qrApproving || qrInputCode.trim().length < 4}
                  onClick={async () => {
                    setQrApproving(true);
                    setError(null);
                    try {
                      await approveQrLoginSession(qrInputCode);
                      setQrInputCode('');
                      setNotice('✅ Вход на новом устройстве подтверждён!');
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
              </div>
            </div>

            <div className="section-title">Активные сеансы ({Math.max(1, deviceSessions.length)})</div>
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn btn-compact" onClick={handleRefreshDevices} disabled={devicesLoading}>
                  {devicesLoading ? '⏳ Обновляем…' : '🔄 Обновить список устройств'}
                </button>
                {deviceSessions.filter((d) => !d.isCurrent).length > 0 && (
                  <button
                    type="button"
                    className="btn btn-compact"
                    style={{ borderColor: 'var(--danger)', color: 'var(--danger)', fontWeight: 700 }}
                    onClick={handleTerminateAllOtherDevices}
                  >
                    🛑 Завершить все другие сеансы
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {deviceSessions.map((dev) => (
                  <div
                    key={dev.sessionId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: dev.isCurrent ? 'rgba(255, 212, 0, 0.06)' : 'var(--bg-secondary)',
                      border: `1px solid ${dev.isCurrent ? 'var(--accent)' : 'var(--border)'}`,
                      flexWrap: 'wrap',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                        {dev.deviceName}{' '}
                        {dev.isCurrent && (
                          <span style={{ fontSize: 11, color: '#22c55e', marginLeft: 6 }}>● Это устройство</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        {dev.clientLabel} • {dev.locationLabel}
                      </div>
                    </div>
                    {!dev.isCurrent && (
                      <button
                        type="button"
                        className="btn btn-compact"
                        style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                        onClick={() => handleTerminateDevice(dev.sessionId, dev.deviceName)}
                        disabled={terminatingId !== null}
                      >
                        Завершить
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 8: ЭНЕРГОСБЕРЕЖЕНИЕ */}
        {activeCategory === 'power' && (
          <div>
            <div className="section-title">Режим энергосбережения и оптимизации</div>
            <div className="card" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  padding: '12px',
                  borderRadius: 10,
                  background: 'var(--surface-raised)',
                  border: `1px solid ${powerSaver.enabled ? 'var(--accent)' : 'var(--border)'}`,
                  cursor: 'pointer',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>🔋 Включить режим энергосбережения</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Отключает тяжёлые фоновые эффекты, размытие и плавные анимации для экономии заряда батареи и ресурсов ПК/телефона
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={powerSaver.enabled}
                  onChange={(e) => {
                    const next = savePowerSaverConfig({ enabled: e.target.checked });
                    setPowerSaver(next);
                  }}
                  style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                />
              </label>

              <div className="field" style={{ marginBottom: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>Порог заряда батареи для авто-экономии</label>
                  <b style={{ color: 'var(--accent)' }}>{powerSaver.autoEnableAtBatteryPct}%</b>
                </div>
                <input
                  type="range"
                  min={10}
                  max={50}
                  step={5}
                  value={powerSaver.autoEnableAtBatteryPct}
                  onChange={(e) => {
                    const next = savePowerSaverConfig({ autoEnableAtBatteryPct: Number(e.target.value) });
                    setPowerSaver(next);
                  }}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>

              {[
                { key: 'disableAutoplayMedia' as const, title: 'Отключить автовоспроизведение видео и GIF' },
                { key: 'disableParticlesAndEffects' as const, title: 'Отключить полноэкранные эффекты эмодзи и частицы' },
                { key: 'reduceBlur' as const, title: 'Уменьшить размытие стекла (backdrop-filter)' },
              ].map((item) => (
                <label
                  key={item.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{item.title}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(powerSaver[item.key])}
                    onChange={(e) => {
                      const next = savePowerSaverConfig({ [item.key]: e.target.checked });
                      setPowerSaver(next);
                    }}
                    style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                  />
                </label>
              ))}
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 9: ЯЗЫК */}
        {activeCategory === 'language' && (
          <div>
            <div className="section-title">Язык интерфейса и переводчик</div>
            <div className="card" style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { id: 'ru' as const, label: 'Русский', sub: 'Основной язык интерфейса PixChats' },
                { id: 'en' as const, label: 'English', sub: 'International interface language' },
              ].map((lang) => (
                <button
                  key={lang.id}
                  type="button"
                  onClick={() => {
                    setUiLanguage(lang.id);
                    if (typeof window !== 'undefined') {
                      localStorage.setItem('pixchats:ui_lang', lang.id);
                    }
                    setNotice(`Выбран язык: ${lang.label}`);
                    setTimeout(() => setNotice(null), 1500);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: uiLanguage === lang.id ? 'rgba(255, 212, 0, 0.12)' : 'var(--bg-secondary)',
                    border: `1px solid ${uiLanguage === lang.id ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{lang.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{lang.sub}</div>
                  </div>
                  {uiLanguage === lang.id && <span style={{ color: 'var(--accent)', fontWeight: 800 }}>✓</span>}
                </button>
              ))}

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer',
                  marginTop: 6,
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>🌐 Автоматический перевод сообщений</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Показывать кнопку мгновенного перевода входящих сообщений в чатах
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoTranslate}
                  onChange={(e) => {
                    setAutoTranslate(e.target.checked);
                    setAutoTranslatePref(e.target.checked);
                  }}
                  style={{ width: 20, height: 20, accentColor: 'var(--accent)' }}
                />
              </label>
            </div>
          </div>
        )}

        {/* КАТЕГОРИЯ 10: PIXCHATS PREMIUM */}
        {activeCategory === 'premium' && (
          <div>
            <div
              className="card"
              style={{
                marginBottom: 20,
                background: 'linear-gradient(135deg, rgba(255, 212, 0, 0.18), rgba(245, 158, 11, 0.08), var(--surface))',
                border: '2px solid rgba(255, 212, 0, 0.55)',
                textAlign: 'center',
                padding: '24px 18px',
              }}
            >
              <div style={{ fontSize: 42, marginBottom: 6 }}>⭐</div>
              <h2 style={{ margin: '0 0 6px', fontSize: 22, fontFamily: 'var(--font-display)' }}>
                PixChats <span className="premium-shimmer-badge">★ Premium</span>
              </h2>
              <p style={{ margin: '0 auto 14px', maxWidth: 460, fontSize: 13.5, color: 'var(--text-muted)' }}>
                Эксклюзивная подписка Pixset Studio, открывающая расширенные возможности самовыражения и общения в PixChats.
              </p>

              <div
                style={{
                  display: 'inline-block',
                  padding: '8px 16px',
                  borderRadius: 999,
                  background: isPremium ? '#ffd400' : 'var(--bg-secondary)',
                  color: isPremium ? '#000' : 'var(--text-muted)',
                  fontWeight: 800,
                  fontSize: 13,
                  border: '1px solid var(--border)',
                }}
              >
                {isPremium
                  ? `✅ Ваша подписка активна (${formatPremiumRemaining(premiumExpiresAt)})`
                  : '🔒 Подписка сейчас не активна (выдаётся администрацией PixChats)'}
              </div>
            </div>

            <div className="section-title">Привилегии PixChats Premium</div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
              {[
                {
                  icon: '✨',
                  title: 'Эксклюзивный эмодзи-статус рядом с ником',
                  desc: 'Устанавливайте любой эмодзи или флаг справа от своего имени во всех чатах, группах и профиле.',
                },
                {
                  icon: '❤️',
                  title: 'До 3 реакций на каждое сообщение и историю',
                  desc: 'Обычные пользователи могут поставить 1 реакцию, а с PixChats Premium — сразу до 3 разных реакций на одно сообщение или историю.',
                },
                {
                  icon: '📸',
                  title: 'Безлимитные истории каждый день',
                  desc: 'Публикуйте сколько угодно историй в сутки (без подписки лимит составляет 1 историю в 24 часа).',
                },
                {
                  icon: '👑',
                  title: 'Золотая переливающаяся надпись «★ Premium» в шапке чатов',
                  desc: 'Фирменный переливающийся золотой знак рядом с логотипом PixChats в списке ваших чатов.',
                },
              ].map((feat, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 14,
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 10,
                      background: 'rgba(255, 212, 0, 0.16)',
                      border: '1px solid rgba(255, 212, 0, 0.4)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      flexShrink: 0,
                    }}
                  >
                    {feat.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14.5 }}>{feat.title}</div>
                    <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 3 }}>{feat.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      <BottomNav />
    </DesktopShell>
  );
}
