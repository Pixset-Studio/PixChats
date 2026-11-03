/**
 * Глобальный стор мини-плеера музыки и голосовых сообщений.
 * Позволяет слушать голосовые сообщения и аудио-треки непрерывно при переходе между чатами и вкладками,
 * поддерживает плейлист чата с автопереключением треков.
 */

export interface GlobalAudioTrack {
  id: string;
  src: string;
  title: string;
  senderName: string;
  chatId: string;
  chatTitle: string;
}

export interface GlobalAudioState {
  track: GlobalAudioTrack | null;
  playlist: GlobalAudioTrack[];
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
}

let globalAudioEl: HTMLAudioElement | null = null;
let currentState: GlobalAudioState = {
  track: null,
  playlist: [],
  playing: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,
};

function notifyListeners() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('pixchats:global_audio_state', {
      detail: { ...currentState, playlist: [...currentState.playlist] },
    })
  );
}

function ensureAudioElement(): HTMLAudioElement | null {
  if (typeof window === 'undefined') return null;
  if (!globalAudioEl) {
    globalAudioEl = new Audio();
    globalAudioEl.preload = 'metadata';

    globalAudioEl.addEventListener('timeupdate', () => {
      currentState.currentTime = globalAudioEl?.currentTime || 0;
      notifyListeners();
    });

    globalAudioEl.addEventListener('loadedmetadata', () => {
      currentState.duration = Number.isFinite(globalAudioEl?.duration) ? globalAudioEl!.duration : 0;
      notifyListeners();
    });

    globalAudioEl.addEventListener('play', () => {
      currentState.playing = true;
      notifyListeners();
    });

    globalAudioEl.addEventListener('pause', () => {
      currentState.playing = false;
      notifyListeners();
    });

    globalAudioEl.addEventListener('ended', () => {
      currentState.playing = false;
      currentState.currentTime = 0;
      // Автопереход к следующему треку в плейлисте чата
      if (currentState.playlist.length > 1 && currentState.track) {
        const idx = currentState.playlist.findIndex((t) => t.id === currentState.track?.id);
        if (idx >= 0 && idx + 1 < currentState.playlist.length) {
          playGlobalAudioTrack(currentState.playlist[idx + 1], currentState.playlist);
          return;
        }
      }
      notifyListeners();
    });
  }
  return globalAudioEl;
}

export function getGlobalAudioState(): GlobalAudioState {
  return { ...currentState, playlist: [...currentState.playlist] };
}

export function playGlobalAudioTrack(
  track: GlobalAudioTrack,
  playlist?: GlobalAudioTrack[]
): void {
  const audio = ensureAudioElement();
  if (!audio) return;

  if (Array.isArray(playlist) && playlist.length > 0) {
    currentState.playlist = playlist;
  } else if (!currentState.playlist.some((t) => t.id === track.id)) {
    currentState.playlist = [track];
  }

  if (currentState.track?.id === track.id && audio.src) {
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
    return;
  }

  currentState.track = track;
  currentState.currentTime = 0;
  currentState.duration = 0;
  audio.src = track.src;
  audio.playbackRate = currentState.playbackRate;
  audio.play().catch(() => {});
  notifyListeners();
}

export function playNextGlobalAudioTrack(): void {
  if (!currentState.track || currentState.playlist.length <= 1) return;
  const idx = currentState.playlist.findIndex((t) => t.id === currentState.track?.id);
  const nextIdx = (idx + 1) % currentState.playlist.length;
  playGlobalAudioTrack(currentState.playlist[nextIdx], currentState.playlist);
}

export function playPrevGlobalAudioTrack(): void {
  if (!currentState.track || currentState.playlist.length <= 1) return;
  const idx = currentState.playlist.findIndex((t) => t.id === currentState.track?.id);
  const prevIdx = (idx - 1 + currentState.playlist.length) % currentState.playlist.length;
  playGlobalAudioTrack(currentState.playlist[prevIdx], currentState.playlist);
}

export function toggleGlobalAudioPlayPause(): void {
  const audio = ensureAudioElement();
  if (!audio || !currentState.track) return;
  if (audio.paused) {
    audio.play().catch(() => {});
  } else {
    audio.pause();
  }
}

export function seekGlobalAudio(seconds: number): void {
  const audio = ensureAudioElement();
  if (!audio || !currentState.track) return;
  audio.currentTime = Math.max(0, seconds);
  currentState.currentTime = audio.currentTime;
  notifyListeners();
}

export function cycleGlobalAudioSpeed(): number {
  const speeds = [1, 1.5, 2];
  const next = speeds[(speeds.indexOf(currentState.playbackRate) + 1) % speeds.length];
  currentState.playbackRate = next;
  if (globalAudioEl) {
    globalAudioEl.playbackRate = next;
  }
  notifyListeners();
  return next;
}

export function closeGlobalAudioPlayer(): void {
  if (globalAudioEl) {
    globalAudioEl.pause();
    globalAudioEl.src = '';
  }
  currentState = {
    track: null,
    playlist: [],
    playing: false,
    currentTime: 0,
    duration: 0,
    playbackRate: currentState.playbackRate,
  };
  notifyListeners();
}
