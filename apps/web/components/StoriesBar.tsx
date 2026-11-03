'use client';

import React, { useEffect, useState, useRef } from 'react';
import { getSupabaseClient, uploadMessageFile } from '@pixchats/core';
import type { Profile } from '@pixchats/core';

interface AdminChannelOption {
  id: string;
  title: string;
  username: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
}
import {
  loadActiveStories,
  getCachedStories,
  saveCachedStories,
  publishNewStory,
  deleteStoryById,
  toggleStoryReaction,
  recordStoryView,
  getViewedStoryIds,
  STORY_GRADIENTS,
  STORY_FILTERS,
  type StoryItem,
} from '../lib/stories';
import { compressImageToDataUrl } from '../lib/fileStorage';
import { VerifiedBadge } from './VerifiedBadge';
import { EmojiPicker } from './EmojiPicker';
import { EmojiOrFlag } from './EmojiOrFlag';
import {
  getPreferredAudioConstraints,
  getPreferredVideoConstraints,
} from '../lib/mediaDevicesStore';
import { isMobilePhoneDevice } from '../lib/nativePlatform';
import {
  getUserPremiumStatus,
  getMaxDailyStoriesForUser,
  isUserInCloseFriends,
  syncExtendedProfilesFromCloud,
} from '../lib/premiumAndFeatures';

interface StoriesBarProps {
  profile: Profile;
}

interface UserStoryGroup {
  userId: string;
  userName: string;
  userUsername: string;
  userAvatar: string | null;
  isVerified?: boolean;
  isChannelStory?: boolean;
  channelId?: string;
  stories: StoryItem[];
  hasUnviewed: boolean;
}

const STORY_REACTIONS = ['❤️', '🔥', '😂', '😍', '👏', '🎉', '🇷🇺', '🇰🇿'];
const BRUSH_COLORS = ['#ffd400', '#ffffff', '#ef4444', '#22c55e', '#38bdf8', '#ec4899', '#a855f7', '#000000'];

function formatStoryAgo(iso: string): string {
  const diffMin = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const hours = Math.floor(diffMin / 60);
  return `${hours} ч. назад`;
}

function isVideoStory(story: StoryItem): boolean {
  if (story.mediaType === 'video') return true;
  if (!story.mediaUrl) return false;
  return (
    story.mediaUrl.startsWith('data:video/') ||
    /\.(mp4|webm|mov|m4v)(\?|$)/i.test(story.mediaUrl)
  );
}

export function StoriesBar({ profile }: StoriesBarProps) {
  const [stories, setStories] = useState<StoryItem[]>(() => getCachedStories());
  const [viewedIds, setViewedIds] = useState<Set<string>>(() => getViewedStoryIds());

  // Модалка создания истории + Внутренний редактор
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [selectedGradient, setSelectedGradient] = useState(STORY_GRADIENTS[0].css);
  const [privacy, setPrivacy] = useState<'all' | 'friends' | 'close_friends'>('all');
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video' | 'none'>('none');
  const [rawVideoFile, setRawVideoFile] = useState<File | null>(null);
  const [videoMuted, setVideoMuted] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Встроенная камера для съёмки фото или записи видео прямо в окне Историй
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('user');
  const [cameraZoom, setCameraZoom] = useState<number>(1);
  const [cameraExpanded, setCameraExpanded] = useState<boolean>(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [recordingSec, setRecordingSec] = useState(0);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Внутренний редактор историй (Фильтры / Текст на экране / Рисование кистью)
  const [editorTab, setEditorTab] = useState<'none' | 'filters' | 'text' | 'draw'>('none');
  const [selectedFilterCss, setSelectedFilterCss] = useState<string>('none');
  const [overlayText, setOverlayText] = useState('');
  const [overlayColor, setOverlayColor] = useState('#ffffff');
  const [overlaySize, setOverlaySize] = useState(22);
  const [overlayY, setOverlayY] = useState(50);
  const [overlayBg, setOverlayBg] = useState(true);

  // Холст для рисования поверх истории
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isDrawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [brushColor, setBrushColor] = useState('#ffd400');
  const [brushSize, setBrushSize] = useState(5);
  const [drawHistory, setDrawHistory] = useState<string[]>([]);
  const [drawingDataUrl, setDrawingDataUrl] = useState<string | null>(null);

  // Модалка полноэкранного просмотра историй
  const [activeGroupUserId, setActiveGroupUserId] = useState<string | null>(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewerMuted, setViewerMuted] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [storyNotice, setStoryNotice] = useState<string | null>(null);
  const viewerVideoRef = useRef<HTMLVideoElement | null>(null);

  // Каналы, где пользователь владелец или администратор (для публикации историй от имени канала)
  const [adminChannels, setAdminChannels] = useState<AdminChannelOption[]>([]);
  const [selectedPublisherChannelId, setSelectedPublisherChannelId] = useState<string>(''); // '' = личный профиль
  const [chatPartnerUserIds, setChatPartnerUserIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    const refreshStories = () => {
      loadActiveStories().then((loaded) => {
        if (mounted) {
          setStories(loaded);
          setViewedIds(getViewedStoryIds());
        }
      });
    };
    refreshStories();

    (async () => {
      try {
        const supabase = getSupabaseClient();
        const { data: myMemberships } = await supabase
          .from('chat_members')
          .select('chat_id')
          .eq('user_id', profile.id);

        if (myMemberships && myMemberships.length > 0) {
          const myChatIds = myMemberships.map((m: any) => m.chat_id);
          const { data: partners } = await supabase
            .from('chat_members')
            .select('user_id')
            .in('chat_id', myChatIds)
            .neq('user_id', profile.id);

          if (partners && mounted) {
            setChatPartnerUserIds(new Set(partners.map((p: any) => p.user_id)));
          }
        }

        const { data: memberRows } = await supabase
          .from('chat_members')
          .select('chat_id, member_role')
          .eq('user_id', profile.id)
          .in('member_role', ['owner', 'admin']);
        const chatIds = (memberRows ?? []).map((r: any) => r.chat_id);
        if (chatIds.length === 0) return;
        const { data: chatsData } = await supabase
          .from('chats')
          .select('id, type, title, username, avatar_url, is_verified')
          .in('id', chatIds)
          .eq('type', 'channel');
        if (!mounted || !chatsData) return;
        setAdminChannels(
          chatsData.map((c: any) => ({
            id: c.id,
            title: c.title || 'Канал',
            username: c.username ?? null,
            avatarUrl: c.avatar_url ?? null,
            isVerified: Boolean(c.is_verified),
          }))
        );
      } catch {
        // ignore
      }
    })();

    const onLocalUpdate = (e: Event) => {
      const custom = e as CustomEvent<{ stories: StoryItem[] }>;
      if (custom.detail?.stories) {
        setStories(custom.detail.stories);
        setViewedIds(getViewedStoryIds());
      }
    };
    const onOpenChannelStudio = (e: Event) => {
      const custom = e as CustomEvent<{ channelId?: string }>;
      if (custom.detail?.channelId) {
        setSelectedPublisherChannelId(custom.detail.channelId);
      }
      setShowCreateModal(true);
    };
    window.addEventListener('pixchats:stories_updated', onLocalUpdate);
    window.addEventListener('pixchats:open_story_studio', onOpenChannelStudio);

    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('pixchats-stories-global')
      .on('broadcast', { event: 'stories-sync' }, (data: any) => {
        if (data?.payload?.stories && Array.isArray(data.payload.stories)) {
          const merged = saveCachedStories(data.payload.stories);
          if (mounted) {
            setStories(merged);
            setViewedIds(getViewedStoryIds());
          }
        } else {
          refreshStories();
        }
      })
      .on('broadcast', { event: 'stories-request-sync' }, () => {
        const cached = getCachedStories();
        if (cached.length > 0) {
          void channel.send({
            type: 'broadcast',
            event: 'stories-sync',
            payload: { stories: cached },
          });
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.send({
            type: 'broadcast',
            event: 'stories-request-sync',
            payload: {},
          });
        }
      });

    return () => {
      mounted = false;
      window.removeEventListener('pixchats:stories_updated', onLocalUpdate);
      window.removeEventListener('pixchats:open_story_studio', onOpenChannelStudio);
      supabase.removeChannel(channel);
    };
  }, [profile.id]);

  // Группируем истории по пользователям
  const groups: UserStoryGroup[] = React.useMemo(() => {
    const map = new Map<string, StoryItem[]>();
    for (const s of stories) {
      const list = map.get(s.userId) || [];
      list.push(s);
      map.set(s.userId, list);
    }

    const result: UserStoryGroup[] = [];
    map.forEach((userStories, uid) => {
      const isMine = uid === profile.id;
      const isChatPartner = chatPartnerUserIds.has(uid);
      const isChannel = uid.startsWith('channel:');

      // По требованию: истории в общей ленте видны ТОЛЬКО если это вы, ваш собеседник по чату или канал
      if (!isMine && !isChatPartner && !isChannel) {
        return;
      }

      // Фильтрация историй «Близкие друзья» (close_friends)
      const visibleStories = userStories.filter((st) => {
        if (st.privacy === 'close_friends' && !isMine && !isChannel) {
          return isUserInCloseFriends(uid, profile.id);
        }
        return true;
      });
      if (visibleStories.length === 0) return;

      const sortedAsc = [...visibleStories].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const first = sortedAsc[0];
      const hasUnviewed = sortedAsc.some((st) => {
        const isViewed =
          viewedIds.has(st.id) ||
          (Array.isArray(st.viewers) && st.viewers.includes(profile.id));
        return !isViewed;
      });
      result.push({
        userId: uid,
        userName: uid === profile.id ? 'Моя история' : first.userName,
        userUsername: first.userUsername,
        userAvatar: uid === profile.id ? profile.avatar_url : first.userAvatar,
        isVerified: first.isVerified,
        isChannelStory: Boolean(first.isChannelStory || uid.startsWith('channel:')),
        channelId: first.channelId,
        stories: sortedAsc,
        hasUnviewed,
      });
    });

    result.sort((a, b) => {
      if (a.userId === profile.id) return -1;
      if (b.userId === profile.id) return 1;
      if (a.hasUnviewed && !b.hasUnviewed) return -1;
      if (!a.hasUnviewed && b.hasUnviewed) return 1;
      return 0;
    });

    return result;
  }, [stories, viewedIds, profile, chatPartnerUserIds]);

  const activeGroup = groups.find((g) => g.userId === activeGroupUserId) || null;
  const activeStory = activeGroup?.stories[activeStoryIndex] || null;

  // Записываем просмотр при открытии истории
  useEffect(() => {
    if (!activeStory) return;
    setViewedIds((prev) => {
      const next = new Set(prev);
      next.add(activeStory.id);
      return next;
    });
    setStories((prev) =>
      prev.map((s) =>
        s.id === activeStory.id
          ? { ...s, viewers: Array.from(new Set([...(s.viewers || []), profile.id])) }
          : s
      )
    );
    void recordStoryView(activeStory.id, profile.id);
  }, [activeStory?.id, profile.id]);

  // Автоматический таймер переключения истории (5.5 секунд для фото/текста, либо по длительности видео)
  useEffect(() => {
    if (!activeStory || paused) return;
    const isVid = isVideoStory(activeStory);
    if (isVid) {
      const fallbackTimer = setInterval(() => {
        const vid = viewerVideoRef.current;
        if (vid && vid.duration && Number.isFinite(vid.duration) && vid.duration > 0) {
          const pct = Math.min(100, (vid.currentTime / vid.duration) * 100);
          setProgress(pct);
        } else {
          setProgress((prev) => {
            if (prev >= 100) {
              goNextStory();
              return 0;
            }
            return prev + 1.2;
          });
        }
      }, 100);
      return () => clearInterval(fallbackTimer);
    }

    const stepMs = 55;
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          goNextStory();
          return 0;
        }
        return prev + 1;
      });
    }, stepMs);
    return () => clearInterval(timer);
  }, [activeStory?.id, paused, activeGroupUserId, activeStoryIndex]);

  function openGroupViewer(group: UserStoryGroup) {
    const firstUnviewedIdx = group.stories.findIndex((s) => !viewedIds.has(s.id));
    setActiveGroupUserId(group.userId);
    setActiveStoryIndex(firstUnviewedIdx >= 0 ? firstUnviewedIdx : 0);
    setProgress(0);
    setPaused(false);
  }

  function closeViewer() {
    setActiveGroupUserId(null);
    setActiveStoryIndex(0);
    setProgress(0);
  }

  function goNextStory() {
    if (!activeGroup) return;
    if (activeStoryIndex + 1 < activeGroup.stories.length) {
      setActiveStoryIndex(activeStoryIndex + 1);
      setProgress(0);
    } else {
      const currentGroupIdx = groups.findIndex((g) => g.userId === activeGroup.userId);
      if (currentGroupIdx >= 0 && currentGroupIdx + 1 < groups.length) {
        const nextGroup = groups[currentGroupIdx + 1];
        setActiveGroupUserId(nextGroup.userId);
        setActiveStoryIndex(0);
        setProgress(0);
      } else {
        closeViewer();
      }
    }
  }

  function goPrevStory() {
    if (!activeGroup) return;
    if (activeStoryIndex > 0) {
      setActiveStoryIndex(activeStoryIndex - 1);
      setProgress(0);
    } else {
      const currentGroupIdx = groups.findIndex((g) => g.userId === activeGroup.userId);
      if (currentGroupIdx > 0) {
        const prevGroup = groups[currentGroupIdx - 1];
        setActiveGroupUserId(prevGroup.userId);
        setActiveStoryIndex(prevGroup.stories.length - 1);
        setProgress(0);
      } else {
        setProgress(0);
      }
    }
  }

  function stopStoryCamera() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
    mediaRecorderRef.current = null;
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setIsRecordingVideo(false);
    setRecordingSec(0);
    setCameraOpen(false);
  }

  async function startStoryCamera(facing: 'user' | 'environment' = cameraFacing) {
    stopStoryCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: getPreferredVideoConstraints({ facingMode: facing, width: { ideal: 1080 }, height: { ideal: 1920 } }),
        audio: getPreferredAudioConstraints(),
      });
      cameraStreamRef.current = stream;
      setCameraFacing(facing);
      setCameraOpen(true);
      setTimeout(() => {
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          void cameraVideoRef.current.play().catch(() => {});
        }
      }, 60);
    } catch {
      try {
        const fallback = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        cameraStreamRef.current = fallback;
        setCameraOpen(true);
        setTimeout(() => {
          if (cameraVideoRef.current) {
            cameraVideoRef.current.srcObject = fallback;
            void cameraVideoRef.current.play().catch(() => {});
          }
        }, 60);
      } catch {}
    }
  }

  function capturePhotoFromCamera() {
    const vid = cameraVideoRef.current;
    if (!vid) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 720;
    canvas.height = vid.videoHeight || 1280;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (cameraFacing === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
    setMediaPreview(dataUrl);
    setMediaType('image');
    setRawVideoFile(null);
    stopStoryCamera();
  }

  function startVideoRecordingInStory() {
    const stream = cameraStreamRef.current;
    if (!stream || isRecordingVideo) return;
    try {
      recordedChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? 'video/webm;codecs=vp8,opus'
        : MediaRecorder.isTypeSupported('video/mp4')
          ? 'video/mp4'
          : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'video/webm' });
        if (blob.size > 200) {
          const ext = (recorder.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
          const file = new File([blob], `story-video-${Date.now()}.${ext}`, {
            type: recorder.mimeType || 'video/webm',
          });
          const localUrl = URL.createObjectURL(blob);
          setRawVideoFile(file);
          setMediaPreview(localUrl);
          setMediaType('video');
        }
        stopStoryCamera();
      };
      recorder.start(200);
      mediaRecorderRef.current = recorder;
      setIsRecordingVideo(true);
      setRecordingSec(0);
    } catch {}
  }

  function stopVideoRecordingInStory() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {}
    }
  }

  useEffect(() => {
    if (!isRecordingVideo) return;
    const t = setInterval(() => {
      setRecordingSec((prev) => {
        if (prev >= 14) {
          stopVideoRecordingInStory();
          return 15;
        }
        return prev + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [isRecordingVideo]);

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (file.type.startsWith('video/')) {
        setRawVideoFile(file);
        const objUrl = URL.createObjectURL(file);
        setMediaPreview(objUrl);
        setMediaType('video');
      } else {
        const compressed = await compressImageToDataUrl(file, 1080, 0.82);
        setMediaPreview(compressed);
        setMediaType('image');
        setRawVideoFile(null);
      }
    } catch {}
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function getCanvasCoords(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = drawCanvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function handleCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (editorTab !== 'draw') return;
    e.stopPropagation();
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
    isDrawingRef.current = true;
    const pt = getCanvasCoords(e);
    lastPointRef.current = pt;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = brushColor;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, brushSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function handleCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDrawingRef.current || editorTab !== 'draw') return;
    const canvas = drawCanvasRef.current;
    const last = lastPointRef.current;
    if (!canvas || !last) return;
    const pt = getCanvasCoords(e);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = brushColor;
      ctx.lineWidth = brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
    lastPointRef.current = pt;
  }

  function handleCanvasPointerUp() {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    lastPointRef.current = null;
    const canvas = drawCanvasRef.current;
    if (canvas) {
      const dataUrl = canvas.toDataURL('image/png');
      setDrawHistory((prev) => [...prev.slice(-12), dataUrl]);
      setDrawingDataUrl(dataUrl);
    }
  }

  function handleUndoDrawing() {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (drawHistory.length <= 1) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setDrawHistory([]);
      setDrawingDataUrl(null);
      return;
    }

    const nextHistory = drawHistory.slice(0, -1);
    const prevDataUrl = nextHistory[nextHistory.length - 1];
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
    };
    img.src = prevDataUrl;
    setDrawHistory(nextHistory);
    setDrawingDataUrl(prevDataUrl);
  }

  function handleClearDrawing() {
    const canvas = drawCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
    setDrawHistory([]);
    setDrawingDataUrl(null);
  }

  function resetCreateModal() {
    stopStoryCamera();
    setShowCreateModal(false);
    setDraftText('');
    setMediaPreview(null);
    setMediaType('none');
    setRawVideoFile(null);
    setVideoMuted(false);
    setEditorTab('none');
    setSelectedFilterCss('none');
    setOverlayText('');
    setOverlayColor('#ffffff');
    setOverlaySize(22);
    setOverlayY(50);
    setOverlayBg(true);
    setDrawHistory([]);
    setDrawingDataUrl(null);
  }

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!draftText.trim() && !mediaPreview && !overlayText.trim() && !drawingDataUrl) return;
    setPublishError(null);

    const targetChannel = selectedPublisherChannelId
      ? adminChannels.find((ch) => ch.id === selectedPublisherChannelId)
      : null;

    // Проверка лимита 1 история в сутки без подписки PixChats Premium
    if (!targetChannel) {
      const maxDaily = getMaxDailyStoriesForUser(profile.id, profile.username);
      const myActivePersonalCount = stories.filter(
        (s) => s.userId === profile.id && !s.isChannelStory
      ).length;
      if (myActivePersonalCount >= maxDaily) {
        setPublishError(
          '⭐ Без подписки PixChats Premium можно выкладывать не более 1 истории в день. С Premium доступно безлимитное количество историй!'
        );
        return;
      }
    }

    setPublishing(true);
    try {
      let finalMediaUrl = mediaPreview;
      if (mediaType === 'video' && rawVideoFile) {
        try {
          const uploaded = await uploadMessageFile(`stories-${profile.id}`, rawVideoFile);
          finalMediaUrl = uploaded.url;
        } catch {
          if (rawVideoFile.size <= 8 * 1024 * 1024) {
            finalMediaUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = reject;
              reader.readAsDataURL(rawVideoFile);
            });
          }
        }
      }

      await publishNewStory({
        userId: targetChannel ? `channel:${targetChannel.id}` : profile.id,
        authorUserId: profile.id,
        channelId: targetChannel ? targetChannel.id : undefined,
        isChannelStory: Boolean(targetChannel),
        userName: targetChannel ? targetChannel.title : profile.display_name,
        userUsername: targetChannel ? targetChannel.username || 'channel' : profile.username,
        userAvatar: targetChannel ? targetChannel.avatarUrl || null : profile.avatar_url,
        isVerified: targetChannel ? Boolean(targetChannel.isVerified) : profile.is_verified,
        mediaUrl: finalMediaUrl,
        mediaType: finalMediaUrl ? (mediaType === 'video' ? 'video' : 'image') : 'none',
        videoMuted,
        filterCss: selectedFilterCss !== 'none' ? selectedFilterCss : undefined,
        overlayText: overlayText.trim() || undefined,
        overlayColor,
        overlaySize,
        overlayY,
        overlayBg,
        drawingDataUrl,
        bgGradient: selectedGradient,
        text: draftText,
        privacy,
      });
      const refreshed = await loadActiveStories();
      setStories(refreshed);
      resetCreateModal();
    } finally {
      setPublishing(false);
    }
  }

  const myGroup = groups.find((g) => g.userId === profile.id);

  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          overflowX: 'auto',
          padding: '6px 2px 12px',
          marginBottom: 8,
          borderBottom: '1px solid var(--border)',
          scrollbarWidth: 'none',
        }}
      >
        {/* Кнопка создания истории */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 5,
            cursor: 'pointer',
            flexShrink: 0,
            width: 64,
          }}
          onClick={() => {
            if (myGroup) {
              openGroupViewer(myGroup);
            } else {
              setShowCreateModal(true);
            }
          }}
        >
          <div style={{ position: 'relative', width: 54, height: 54 }}>
            <div
              style={{
                width: 54,
                height: 54,
                borderRadius: '50%',
                padding: 2,
                background: myGroup
                  ? (myGroup.hasUnviewed
                      ? 'linear-gradient(135deg, #ffd400, #f59e0b, #ec4899)'
                      : 'var(--border)')
                  : 'var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.3s ease',
              }}
            >
              <div
                className={`avatar ${!profile.avatar_url ? 'avatar-fallback' : ''}`}
                style={{
                  width: 48,
                  height: 48,
                  fontSize: 18,
                  border: '2px solid var(--bg)',
                  backgroundImage: profile.avatar_url ? `url(${profile.avatar_url})` : undefined,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {!profile.avatar_url && profile.display_name.slice(0, 1).toUpperCase()}
              </div>
            </div>

            {!myGroup && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowCreateModal(true);
                }}
                title="Опубликовать фото или видео в историю"
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: 'var(--accent)',
                  color: '#09090b',
                  border: '2px solid var(--bg)',
                  fontWeight: 900,
                  fontSize: 14,
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                +
              </button>
            )}
          </div>
          <span
            style={{
              fontSize: 11,
              color: 'var(--text)',
              fontWeight: 600,
              maxWidth: 64,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {myGroup ? 'Моя история' : 'История'}
          </span>
        </div>

        {/* Кружочки историй других пользователей */}
        {groups
          .filter((g) => g.userId !== profile.id)
          .map((group) => (
            <div
              key={group.userId}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5,
                cursor: 'pointer',
                flexShrink: 0,
                width: 64,
              }}
              onClick={() => openGroupViewer(group)}
            >
              <div
                style={{
                  width: 54,
                  height: 54,
                  borderRadius: '50%',
                  padding: 2.5,
                  background: group.hasUnviewed
                    ? group.stories.some((st) => st.privacy === 'close_friends')
                      ? 'linear-gradient(135deg, #22c55e 0%, #10b981 50%, #4ade80 100%)'
                      : 'linear-gradient(135deg, #ffd400 0%, #f59e0b 50%, #ec4899 100%)'
                    : 'rgba(255,255,255,0.18)',
                  boxShadow: group.hasUnviewed
                    ? group.stories.some((st) => st.privacy === 'close_friends')
                      ? '0 0 12px rgba(34, 197, 94, 0.45)'
                      : '0 0 12px rgba(255, 212, 0, 0.28)'
                    : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.2s ease',
                }}
              >
                <div
                  className={`avatar ${!group.userAvatar ? 'avatar-fallback' : ''}`}
                  style={{
                    width: 47,
                    height: 47,
                    fontSize: 17,
                    border: '2px solid var(--bg)',
                    backgroundImage: group.userAvatar ? `url(${group.userAvatar})` : undefined,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                >
                  {!group.userAvatar && group.userName.slice(0, 1).toUpperCase()}
                </div>
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: group.hasUnviewed ? 'var(--text)' : 'var(--text-muted)',
                  fontWeight: group.hasUnviewed ? 700 : 500,
                  maxWidth: 64,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {group.userName}
              </span>
            </div>
          ))}
      </div>

      {/* Модальное окно создания истории с записью фото/видео и встроенным редактором */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={resetCreateModal}>
          <div
            className="modal-card"
            style={{ maxWidth: 460, width: '95%', maxHeight: '92vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <h3 style={{ margin: 0, fontSize: 17 }}>✨ Студия историй (24 часа)</h3>
              <button
                type="button"
                className="btn-ghost"
                style={{ width: 'auto', padding: '4px 8px' }}
                onClick={resetCreateModal}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handlePublish}>
              {/* Выбор автора истории: Личный профиль или Канал */}
              {adminChannels.length > 0 && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: '8px 10px',
                    borderRadius: 12,
                    background: 'var(--surface-raised)',
                    border: '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    📢 Опубликовать от имени:
                  </span>
                  <select
                    className="input"
                    value={selectedPublisherChannelId}
                    onChange={(e) => setSelectedPublisherChannelId(e.target.value)}
                    style={{ width: 'auto', flex: 1, maxWidth: 230, padding: '5px 10px', fontSize: 12.5 }}
                  >
                    <option value="">👤 {profile.display_name} (Личный профиль)</option>
                    {adminChannels.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        📢 {ch.title} (Канал)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Превью истории ИЛИ живая камера (с поддержкой увеличения и зума) */}
              <div
                style={{
                  position: 'relative',
                  height: cameraOpen && cameraExpanded ? 480 : 310,
                  borderRadius: 16,
                  background: selectedGradient,
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 20,
                  marginBottom: 12,
                  border: '1px solid var(--border)',
                  userSelect: 'none',
                  transition: 'height 0.22s ease',
                }}
              >
                {cameraOpen ? (
                  <div style={{ position: 'absolute', inset: 0, background: '#000' }}>
                    <video
                      ref={cameraVideoRef}
                      autoPlay
                      muted
                      playsInline
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        transform: `${cameraFacing === 'user' ? 'scaleX(-1)' : ''} scale(${cameraZoom})`,
                        transition: 'transform 0.15s ease',
                      }}
                    />
                    {/* Верхняя панель управления зумом и размером камеры */}
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        right: 10,
                        zIndex: 15,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        background: 'rgba(0,0,0,0.68)',
                        padding: '4px 10px',
                        borderRadius: 999,
                      }}
                    >
                      <span style={{ fontSize: 11, color: '#ffd400', fontWeight: 700 }}>
                        🔍 {cameraZoom.toFixed(1)}x
                      </span>
                      <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.1}
                        value={cameraZoom}
                        onChange={(e) => setCameraZoom(Number(e.target.value))}
                        style={{ width: 72, accentColor: '#ffd400', cursor: 'pointer' }}
                        title="Приблизить камеру (Zoom)"
                      />
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ width: 'auto', padding: '2px 6px', fontSize: 11.5, color: '#fff' }}
                        onClick={() => setCameraExpanded((v) => !v)}
                        title={cameraExpanded ? 'Уменьшить окно камеры' : 'Увеличить окно камеры'}
                      >
                        {cameraExpanded ? '🗕 Меньше' : '🗖 Крупнее'}
                      </button>
                    </div>
                    {isRecordingVideo && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 12,
                          left: 12,
                          background: 'rgba(220, 38, 38, 0.9)',
                          color: '#fff',
                          padding: '4px 10px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span>● REC</span>
                        <span>00:{String(recordingSec).padStart(2, '0')} / 00:15</span>
                      </div>
                    )}

                    <div
                      style={{
                        position: 'absolute',
                        bottom: 12,
                        left: 12,
                        right: 12,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                      }}
                    >
                      {isMobilePhoneDevice() && (
                        <button
                          type="button"
                          className="btn"
                          style={{ width: 'auto', padding: '7px 12px', fontSize: 12, background: 'rgba(0,0,0,0.65)', color: '#fff' }}
                          onClick={() => void startStoryCamera(cameraFacing === 'user' ? 'environment' : 'user')}
                        >
                          🔄 Камера
                        </button>
                      )}
                      {!isRecordingVideo && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={{ width: 'auto', padding: '7px 14px', fontSize: 12, fontWeight: 700 }}
                          onClick={capturePhotoFromCamera}
                        >
                          📸 Сделать фото
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{
                          width: 'auto',
                          padding: '7px 14px',
                          fontSize: 12,
                          fontWeight: 700,
                          background: isRecordingVideo ? '#fff' : '#dc2626',
                          color: isRecordingVideo ? '#dc2626' : '#fff',
                          borderColor: '#dc2626',
                        }}
                        onClick={isRecordingVideo ? stopVideoRecordingInStory : startVideoRecordingInStory}
                      >
                        {isRecordingVideo ? '⏹ Стоп видео' : '🔴 Записать видео'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        style={{ width: 'auto', padding: '7px 10px', fontSize: 12, background: 'rgba(0,0,0,0.65)', color: '#fff' }}
                        onClick={stopStoryCamera}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    {mediaPreview && mediaType === 'video' && (
                      <video
                        src={mediaPreview}
                        autoPlay
                        loop
                        playsInline
                        muted={videoMuted}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          filter: selectedFilterCss !== 'none' ? selectedFilterCss : undefined,
                        }}
                      />
                    )}
                    {mediaPreview && mediaType !== 'video' && (
                      <img
                        src={mediaPreview}
                        alt="Превью"
                        style={{
                          position: 'absolute',
                          inset: 0,
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          filter: selectedFilterCss !== 'none' ? selectedFilterCss : undefined,
                        }}
                      />
                    )}

                    {/* Холст для рисования кистью поверх истории */}
                    <canvas
                      ref={drawCanvasRef}
                      width={540}
                      height={960}
                      onPointerDown={handleCanvasPointerDown}
                      onPointerMove={handleCanvasPointerMove}
                      onPointerUp={handleCanvasPointerUp}
                      onPointerCancel={handleCanvasPointerUp}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        width: '100%',
                        height: '100%',
                        zIndex: editorTab === 'draw' ? 12 : 4,
                        cursor: editorTab === 'draw' ? 'crosshair' : 'default',
                        touchAction: editorTab === 'draw' ? 'none' : 'auto',
                        pointerEvents: editorTab === 'draw' ? 'auto' : 'none',
                      }}
                    />

                    {/* Стикер-текст поверх истории из редактора */}
                    {overlayText.trim() && (
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: `${overlayY}%`,
                          transform: 'translate(-50%, -50%)',
                          zIndex: 8,
                          color: overlayColor,
                          fontSize: overlaySize,
                          fontWeight: 800,
                          textAlign: 'center',
                          padding: overlayBg ? '6px 14px' : '2px 6px',
                          borderRadius: 10,
                          background: overlayBg ? 'rgba(0, 0, 0, 0.62)' : 'transparent',
                          textShadow: '0 2px 10px rgba(0,0,0,0.85)',
                          maxWidth: '88%',
                          wordBreak: 'break-word',
                          pointerEvents: 'none',
                        }}
                      >
                        {overlayText}
                      </div>
                    )}

                    {/* Основная подпись снизу или по центру */}
                    {draftText.trim() ? (
                      <div
                        style={{
                          position: 'relative',
                          zIndex: 6,
                          marginTop: mediaPreview ? 'auto' : 0,
                          color: '#fff',
                          fontWeight: 700,
                          fontSize: mediaPreview ? 15 : 20,
                          textAlign: 'center',
                          textShadow: '0 2px 12px rgba(0,0,0,0.85)',
                          background: mediaPreview ? 'rgba(0,0,0,0.52)' : 'transparent',
                          padding: mediaPreview ? '8px 14px' : 0,
                          borderRadius: 12,
                          maxWidth: '92%',
                          wordBreak: 'break-word',
                          pointerEvents: 'none',
                        }}
                      >
                        {draftText}
                      </div>
                    ) : !mediaPreview && !overlayText.trim() && !drawingDataUrl ? (
                      <div
                        style={{
                          position: 'relative',
                          zIndex: 2,
                          color: 'rgba(255,255,255,0.65)',
                          fontSize: 13.5,
                          textAlign: 'center',
                          pointerEvents: 'none',
                        }}
                      >
                        Выберите фото/видео из галереи, снимите на камеру или напишите текст…
                      </div>
                    ) : null}

                    {mediaPreview && (
                      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 15, display: 'flex', gap: 6 }}>
                        {mediaType === 'video' && (
                          <button
                            type="button"
                            className="btn"
                            style={{
                              width: 'auto',
                              padding: '4px 10px',
                              fontSize: 11.5,
                              background: 'rgba(0,0,0,0.72)',
                              color: '#fff',
                            }}
                            onClick={() => setVideoMuted((v) => !v)}
                          >
                            {videoMuted ? '🔇 Без звука' : '🔊 Со звуком'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn"
                          style={{
                            width: 'auto',
                            padding: '4px 10px',
                            fontSize: 11.5,
                            background: 'rgba(0,0,0,0.72)',
                            color: '#fff',
                          }}
                          onClick={() => {
                            setMediaPreview(null);
                            setMediaType('none');
                            setRawVideoFile(null);
                          }}
                        >
                          ✕ Убрать медиа
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Источники медиа: Галерея (Фото/Видео) + Живая Камера */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,video/*"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
                <button
                  type="button"
                  className="btn"
                  style={{ width: 'auto', flex: 1, fontSize: 12, padding: '7px 10px' }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  🖼️ Фото / Видео из галереи
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    width: 'auto',
                    flex: 1,
                    fontSize: 12,
                    padding: '7px 10px',
                    borderColor: cameraOpen ? 'var(--accent)' : undefined,
                    color: cameraOpen ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => (cameraOpen ? stopStoryCamera() : void startStoryCamera())}
                >
                  📸 Камера (Фото / Видео)
                </button>
              </div>

              {/* Панель инструментов Внутреннего Редактора Историй */}
              <div
                style={{
                  display: 'flex',
                  gap: 6,
                  marginBottom: 10,
                  background: 'var(--bg-secondary)',
                  padding: 5,
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 12,
                    borderColor: editorTab === 'filters' ? 'var(--accent)' : 'transparent',
                    color: editorTab === 'filters' ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => setEditorTab(editorTab === 'filters' ? 'none' : 'filters')}
                >
                  🎨 Фильтры
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 12,
                    borderColor: editorTab === 'text' ? 'var(--accent)' : 'transparent',
                    color: editorTab === 'text' ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => setEditorTab(editorTab === 'text' ? 'none' : 'text')}
                >
                  🔤 Текст-стикер
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    fontSize: 12,
                    borderColor: editorTab === 'draw' ? 'var(--accent)' : 'transparent',
                    color: editorTab === 'draw' ? 'var(--accent)' : undefined,
                  }}
                  onClick={() => setEditorTab(editorTab === 'draw' ? 'none' : 'draw')}
                >
                  ✏️ Рисовать
                </button>
              </div>

              {/* Вкладка 1: Фильтры */}
              {editorTab === 'filters' && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    marginBottom: 10,
                  }}
                >
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                    Цветокоррекция и видео/фото фильтр:
                  </div>
                  <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                    {STORY_FILTERS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        className="btn"
                        style={{
                          width: 'auto',
                          padding: '5px 10px',
                          fontSize: 11.5,
                          whiteSpace: 'nowrap',
                          borderColor: selectedFilterCss === f.css ? 'var(--accent)' : undefined,
                          color: selectedFilterCss === f.css ? 'var(--accent)' : undefined,
                        }}
                        onClick={() => setSelectedFilterCss(f.css)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Вкладка 2: Стикер-текст поверх экрана */}
              {editorTab === 'text' && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    marginBottom: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <input
                    type="text"
                    className="input"
                    placeholder="Крупная надпись поверх истории…"
                    value={overlayText}
                    onChange={(e) => setOverlayText(e.target.value)}
                    maxLength={80}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {BRUSH_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setOverlayColor(c)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: c,
                          border: overlayColor === c ? '2px solid var(--accent)' : '1px solid var(--border)',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                    <button
                      type="button"
                      className="btn"
                      style={{ width: 'auto', padding: '3px 8px', fontSize: 11, marginLeft: 'auto' }}
                      onClick={() => setOverlayBg((v) => !v)}
                    >
                      {overlayBg ? 'Подложка: Вкл' : 'Подложка: Выкл'}
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11.5 }}>
                    <span>Размер:</span>
                    <input
                      type="range"
                      min={14}
                      max={36}
                      value={overlaySize}
                      onChange={(e) => setOverlaySize(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    <span>Высота:</span>
                    <input
                      type="range"
                      min={15}
                      max={85}
                      value={overlayY}
                      onChange={(e) => setOverlayY(Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>
              )}

              {/* Вкладка 3: Кисть и рисование по истории */}
              {editorTab === 'draw' && (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    marginBottom: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>
                    ✏️ Проведите пальцем или мышью прямо по превью истории выше, чтобы рисовать!
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {BRUSH_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setBrushColor(c)}
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: c,
                          border: brushColor === c ? '2px solid var(--accent)' : '1px solid var(--border)',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                    <input
                      type="range"
                      min={2}
                      max={18}
                      value={brushSize}
                      onChange={(e) => setBrushSize(Number(e.target.value))}
                      style={{ width: 70 }}
                      title="Толщина кисти"
                    />
                    <button
                      type="button"
                      className="btn"
                      style={{ width: 'auto', padding: '3px 8px', fontSize: 11 }}
                      onClick={handleUndoDrawing}
                      disabled={drawHistory.length === 0}
                    >
                      ↩ Отменить
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ width: 'auto', padding: '3px 8px', fontSize: 11 }}
                      onClick={handleClearDrawing}
                      disabled={!drawingDataUrl}
                    >
                      🗑️ Очистить
                    </button>
                  </div>
                </div>
              )}

              {/* Выбор фонового градиента (если без медиа) */}
              {!mediaPreview && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Фон:</span>
                  {STORY_GRADIENTS.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setSelectedGradient(g.css)}
                      title={g.label}
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        background: g.css,
                        border: selectedGradient === g.css ? '2px solid var(--accent)' : '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              )}

              <div className="field" style={{ marginBottom: 10 }}>
                <input
                  className="input"
                  placeholder="Подпись к истории (до 240 символов)…"
                  maxLength={240}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Кто видит историю:</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      width: 'auto',
                      padding: '4px 10px',
                      fontSize: 12,
                      borderColor: privacy === 'all' ? 'var(--accent)' : undefined,
                      color: privacy === 'all' ? 'var(--accent)' : undefined,
                    }}
                    onClick={() => setPrivacy('all')}
                  >
                    🌍 Все
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      width: 'auto',
                      padding: '4px 10px',
                      fontSize: 12,
                      borderColor: privacy === 'friends' ? 'var(--accent)' : undefined,
                      color: privacy === 'friends' ? 'var(--accent)' : undefined,
                    }}
                    onClick={() => setPrivacy('friends')}
                  >
                    👥 Друзья
                  </button>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      width: 'auto',
                      padding: '4px 10px',
                      fontSize: 12,
                      borderColor: privacy === 'close_friends' ? '#22c55e' : undefined,
                      color: privacy === 'close_friends' ? '#22c55e' : undefined,
                    }}
                    onClick={() => setPrivacy('close_friends')}
                  >
                    💚 Близкие друзья
                  </button>
                </div>
              </div>

              {publishError && (
                <div
                  style={{
                    marginBottom: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'rgba(255, 212, 0, 0.14)',
                    border: '1px solid var(--accent)',
                    color: 'var(--accent)',
                    fontSize: 12.5,
                    fontWeight: 700,
                  }}
                >
                  {publishError}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ width: 'auto' }}
                  onClick={resetCreateModal}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: 'auto' }}
                  disabled={
                    publishing ||
                    (!draftText.trim() && !mediaPreview && !overlayText.trim() && !drawingDataUrl)
                  }
                >
                  {publishing ? 'Публикуем…' : 'Опубликовать ✨'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Полноэкранный просмотрщик историй (с поддержкой видео, звука и слоёв редактора) */}
      {activeGroup && activeStory && (
        <div
          className="modal-overlay story-viewer-overlay"
          style={{ zIndex: 9999, background: 'rgba(5, 5, 7, 0.96)' }}
          onClick={closeViewer}
        >
          <div
            className="story-viewer-dialog"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            style={{
              background: activeStory.bgGradient || STORY_GRADIENTS[0].css,
              border: '1px solid var(--border)',
            }}
          >
            {/* Полоски прогресса сверху */}
            <div style={{ position: 'relative', zIndex: 10, padding: 'calc(14px + env(safe-area-inset-top, 0px)) 16px 0' }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                {activeGroup.stories.map((st, idx) => {
                  const fillPct =
                    idx < activeStoryIndex ? 100 : idx === activeStoryIndex ? progress : 0;
                  return (
                    <div
                      key={st.id}
                      style={{
                        flex: 1,
                        height: 3,
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.26)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${fillPct}%`,
                          height: '100%',
                          background: '#ffd400',
                          transition: idx === activeStoryIndex ? 'width 0.06s linear' : 'none',
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Шапка автора истории */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div
                    className={`avatar ${!activeStory.userAvatar ? 'avatar-fallback' : ''}`}
                    style={{
                      width: 36,
                      height: 36,
                      fontSize: 14,
                      backgroundImage: activeStory.userAvatar ? `url(${activeStory.userAvatar})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      border: '1.5px solid var(--accent)',
                    }}
                  >
                    {!activeStory.userAvatar && activeStory.userName.slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13.5, color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{activeStory.userName}</span>
                      {activeStory.isVerified && <VerifiedBadge size={13} />}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.72)' }}>
                      {formatStoryAgo(activeStory.createdAt)} ·{' '}
                      {activeStory.privacy === 'friends' ? '👥 Для друзей' : '🌍 Публичная'}
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {isVideoStory(activeStory) && (
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ width: 'auto', padding: '4px 8px', color: '#fff', fontSize: 14 }}
                      onClick={() => setViewerMuted((v) => !v)}
                      title={viewerMuted ? 'Включить звук' : 'Выключить звук'}
                    >
                      {viewerMuted || activeStory.videoMuted ? '🔇' : '🔊'}
                    </button>
                  )}
                  {activeStory.userId === profile.id && (
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: 'auto',
                        padding: '4px 8px',
                        fontSize: 11.5,
                        background: 'rgba(0,0,0,0.55)',
                        color: '#fff',
                      }}
                      onClick={() => {
                        setShowCreateModal(true);
                        closeViewer();
                      }}
                    >
                      + Ещё
                    </button>
                  )}
                  {(activeStory.userId === profile.id ||
                    activeStory.authorUserId === profile.id ||
                    profile.role === 'developer' ||
                    profile.role === 'admin') && (
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: 'auto',
                        padding: '4px 8px',
                        fontSize: 11.5,
                        background: 'rgba(220,38,38,0.75)',
                        color: '#fff',
                        borderColor: 'transparent',
                      }}
                      onClick={async () => {
                        const updated = await deleteStoryById(activeStory.id);
                        setStories(updated);
                        if (activeGroup.stories.length <= 1) {
                          closeViewer();
                        } else {
                          goNextStory();
                        }
                      }}
                      title="Удалить эту историю"
                    >
                      🗑️
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ width: 'auto', padding: '4px 8px', color: '#fff', fontSize: 16 }}
                    onClick={closeViewer}
                  >
                    ✕
                  </button>
                </div>
              </div>
            </div>

            {/* Медиа истории (Фото или Видео) + Слои редактора */}
            {activeStory.mediaUrl && isVideoStory(activeStory) ? (
              <video
                ref={viewerVideoRef}
                src={activeStory.mediaUrl}
                autoPlay
                playsInline
                muted={Boolean(viewerMuted || activeStory.videoMuted)}
                onEnded={() => goNextStory()}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                  zIndex: 1,
                  filter: activeStory.filterCss && activeStory.filterCss !== 'none' ? activeStory.filterCss : undefined,
                }}
              />
            ) : activeStory.mediaUrl ? (
              <img
                src={activeStory.mediaUrl}
                alt="История"
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  background: '#000',
                  zIndex: 1,
                  filter: activeStory.filterCss && activeStory.filterCss !== 'none' ? activeStory.filterCss : undefined,
                }}
              />
            ) : null}

            {/* Слой рисунка кистью из редактора */}
            {activeStory.drawingDataUrl && (
              <img
                src={activeStory.drawingDataUrl}
                alt=""
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  zIndex: 2,
                  pointerEvents: 'none',
                }}
              />
            )}

            {/* Слой стикер-текста из редактора */}
            {activeStory.overlayText && (
              <div
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: `${activeStory.overlayY ?? 50}%`,
                  transform: 'translate(-50%, -50%)',
                  zIndex: 3,
                  color: activeStory.overlayColor || '#ffffff',
                  fontSize: activeStory.overlaySize || 22,
                  fontWeight: 800,
                  textAlign: 'center',
                  padding: activeStory.overlayBg !== false ? '6px 14px' : '2px 6px',
                  borderRadius: 10,
                  background: activeStory.overlayBg !== false ? 'rgba(0, 0, 0, 0.62)' : 'transparent',
                  textShadow: '0 2px 10px rgba(0,0,0,0.85)',
                  maxWidth: '88%',
                  wordBreak: 'break-word',
                  pointerEvents: 'none',
                }}
              >
                {activeStory.overlayText}
              </div>
            )}

            {/* Невидимые зоны навигации влево / вправо */}
            <div
              onClick={goPrevStory}
              style={{
                position: 'absolute',
                top: 70,
                bottom: 90,
                left: 0,
                width: '32%',
                zIndex: 5,
                cursor: 'pointer',
              }}
            />
            <div
              onClick={goNextStory}
              style={{
                position: 'absolute',
                top: 70,
                bottom: 90,
                right: 0,
                width: '68%',
                zIndex: 5,
                cursor: 'pointer',
              }}
            />

            {/* Центральный / нижний текст истории */}
            {activeStory.text && (
              <div
                style={{
                  position: 'relative',
                  zIndex: 4,
                  margin: activeStory.mediaUrl ? 'auto 16px 12px' : 'auto 24px',
                  padding: activeStory.mediaUrl ? '10px 14px' : 0,
                  borderRadius: 12,
                  background: activeStory.mediaUrl ? 'rgba(0,0,0,0.62)' : 'transparent',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: activeStory.mediaUrl ? 15 : 22,
                  textAlign: 'center',
                  lineHeight: 1.4,
                  textShadow: '0 2px 12px rgba(0,0,0,0.8)',
                  wordBreak: 'break-word',
                }}
              >
                {activeStory.text}
              </div>
            )}

            {/* Уведомление об ограничении реакций */}
            {storyNotice && (
              <div
                style={{
                  position: 'absolute',
                  bottom: 68,
                  left: 16,
                  right: 16,
                  zIndex: 25,
                  background: 'rgba(24, 24, 27, 0.94)',
                  border: '1px solid var(--accent)',
                  color: '#ffd400',
                  padding: '8px 12px',
                  borderRadius: 12,
                  fontSize: 12,
                  fontWeight: 700,
                  textAlign: 'center',
                }}
              >
                {storyNotice}
              </div>
            )}

            {/* Полноценный выбор эмодзи и флагов для реакции на историю */}
            {showReactionPicker && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: 'absolute',
                  bottom: 62,
                  right: 12,
                  zIndex: 30,
                }}
              >
                <EmojiPicker
                  title="Реакция на историю (вкл. 🏳️ Флаги)"
                  onClose={() => {
                    setShowReactionPicker(false);
                    setPaused(false);
                  }}
                  onSelect={async (emoji) => {
                    setShowReactionPicker(false);
                    setPaused(false);
                    const isPrem = getUserPremiumStatus(profile.id, profile.username).active;
                    const updated = await toggleStoryReaction(activeStory.id, emoji, profile.id, {
                      isDeveloper: profile.role === 'developer',
                      isPremium: isPrem,
                      onLimitReached: (maxAllowed) => {
                        setStoryNotice(
                          maxAllowed === 1
                            ? '⭐ Без PixChats Premium доступна 1 реакция на историю (с Premium — до 3 реакций!)'
                            : 'Максимум 3 реакции на одну историю'
                        );
                        setTimeout(() => setStoryNotice(null), 3200);
                      },
                    });
                    setStories(updated);
                  }}
                />
              </div>
            )}

            {/* Нижняя панель просмотров и быстрых реакций */}
            <div
              style={{
                position: 'relative',
                zIndex: 10,
                padding: '10px 14px calc(14px + env(safe-area-inset-bottom, 0px))',
                background: 'linear-gradient(to top, rgba(0,0,0,0.88), transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.85)', fontWeight: 600, flexShrink: 0 }}>
                👁️ {activeStory.viewers?.length || 1}
              </div>

              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {Array.from(
                  new Set([...STORY_REACTIONS, ...Object.keys(activeStory.reactions || {})])
                ).map((emoji) => {
                  const users = activeStory.reactions?.[emoji] || [];
                  const reactedByMe = users.includes(profile.id);
                  return (
                    <button
                      key={emoji}
                      type="button"
                      onClick={async () => {
                        const isPrem = getUserPremiumStatus(profile.id, profile.username).active;
                        const updated = await toggleStoryReaction(activeStory.id, emoji, profile.id, {
                          isDeveloper: profile.role === 'developer',
                          isPremium: isPrem,
                          onLimitReached: (maxAllowed) => {
                            setStoryNotice(
                              maxAllowed === 1
                                ? '⭐ Без PixChats Premium доступна 1 реакция на историю (с Premium — до 3 реакций!)'
                                : 'Максимум 3 реакции на одну историю'
                            );
                            setTimeout(() => setStoryNotice(null), 3200);
                          },
                        });
                        setStories(updated);
                      }}
                      style={{
                        background: reactedByMe ? 'rgba(255, 212, 0, 0.28)' : 'rgba(255,255,255,0.12)',
                        border: reactedByMe ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.2)',
                        borderRadius: 999,
                        padding: '4px 8px',
                        fontSize: 13.5,
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <EmojiOrFlag char={emoji} size={15} />
                      {users.length > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700 }}>{users.length}</span>
                      )}
                    </button>
                  );
                })}
                <button
                  type="button"
                  title="Ещё реакции и флаги"
                  onClick={() => {
                    setShowReactionPicker((v) => {
                      const next = !v;
                      setPaused(next);
                      return next;
                    });
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.16)',
                    border: '1px solid rgba(255,255,255,0.28)',
                    borderRadius: 999,
                    padding: '4px 9px',
                    fontSize: 13,
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 800,
                  }}
                >
                  ➕🏳️
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
