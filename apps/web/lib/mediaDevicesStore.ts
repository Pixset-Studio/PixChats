export interface PreferredMediaDevices {
  audioInputId: string; // '' means system default
  videoInputId: string; // '' means system default
  audioOutputId: string; // '' means system default
}

const MEDIA_DEVICES_STORAGE_KEY = 'pixchats:media_devices:v1';

export function getPreferredMediaDevices(): PreferredMediaDevices {
  if (typeof window === 'undefined') {
    return { audioInputId: '', videoInputId: '', audioOutputId: '' };
  }
  try {
    const raw = window.localStorage.getItem(MEDIA_DEVICES_STORAGE_KEY);
    if (!raw) return { audioInputId: '', videoInputId: '', audioOutputId: '' };
    const parsed = JSON.parse(raw);
    return {
      audioInputId: typeof parsed?.audioInputId === 'string' ? parsed.audioInputId : '',
      videoInputId: typeof parsed?.videoInputId === 'string' ? parsed.videoInputId : '',
      audioOutputId: typeof parsed?.audioOutputId === 'string' ? parsed.audioOutputId : '',
    };
  } catch {
    return { audioInputId: '', videoInputId: '', audioOutputId: '' };
  }
}

export function savePreferredMediaDevices(next: Partial<PreferredMediaDevices>): PreferredMediaDevices {
  const current = getPreferredMediaDevices();
  const updated: PreferredMediaDevices = {
    audioInputId: next.audioInputId !== undefined ? next.audioInputId : current.audioInputId,
    videoInputId: next.videoInputId !== undefined ? next.videoInputId : current.videoInputId,
    audioOutputId: next.audioOutputId !== undefined ? next.audioOutputId : current.audioOutputId,
  };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MEDIA_DEVICES_STORAGE_KEY, JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent('pixchats-media-devices-changed', { detail: updated }));
    } catch {
      // ignore
    }
  }
  return updated;
}

export function getPreferredAudioConstraints(extra?: MediaTrackConstraints): MediaTrackConstraints {
  const { audioInputId } = getPreferredMediaDevices();
  const base: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: false,
    autoGainControl: true,
    ...extra,
  };
  if (audioInputId) {
    base.deviceId = { ideal: audioInputId };
  }
  return base;
}

export function getPreferredVideoConstraints(extra?: MediaTrackConstraints): MediaTrackConstraints {
  const { videoInputId } = getPreferredMediaDevices();
  const base: MediaTrackConstraints = {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    ...extra,
  };
  if (videoInputId) {
    base.deviceId = { ideal: videoInputId };
  }
  return base;
}
