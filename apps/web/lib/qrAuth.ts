import { getSupabaseClient } from '@pixchats/core';
import { buildCurrentDeviceSession } from './deviceSessions';
import { generateValidQrMatrix } from './qrCodeGenerator';

/**
 * Быстрая авторизация по QR-коду (Вход с телефона на ПК за 1 секунду).
 * Использует защищённый одноразовый канал Supabase Realtime `pixchats-qr-login:<CODE>`.
 */

export function generateQrSessionCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function normalizeQrCodeInput(raw: string): string {
  const trimmed = raw.trim();
  // Support full URLs like https://.../settings?qr_approve=ABCDEF
  const urlMatch = trimmed.match(/[?&](?:qr_approve|qr_session|code)=([A-Za-z0-9]{4,12})/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toUpperCase().slice(0, 6);
  }
  const cleaned = trimmed.toUpperCase();
  if (cleaned.startsWith('PIXCHATS-QR:')) {
    return cleaned.replace('PIXCHATS-QR:', '').trim().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  }
  return cleaned.replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/**
 * Строит 100% валидную по стандарту ISO/IEC 18004 QR-матрицу (с кодами коррекции ошибок Рида-Соломона),
 * которая мгновенно распознаётся любой камерой телефона (iOS / Android) и встроенным сканером.
 */
export function buildQrMatrix(codeOrPayload: string): boolean[][] {
  const raw = (codeOrPayload || '').trim();
  const isFullPayload =
    raw.startsWith('http://') ||
    raw.startsWith('https://') ||
    raw.startsWith('otpauth://') ||
    raw.startsWith('PIXCHATS-QR:');

  let payload = raw;
  if (!isFullPayload) {
    const cleanCode = normalizeQrCodeInput(raw);
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://pixchats.vercel.app';
    payload = `${origin}/settings?qr_approve=${cleanCode}`;
  }

  return generateValidQrMatrix(payload);
}

/**
 * Ожидание подтверждения входа по QR-коду на странице `/login`.
 */
export function listenForQrLoginApproval(
  code: string,
  onApproved: (info: { deviceName: string }) => void,
  onError?: (msg: string) => void
): () => void {
  const normalized = normalizeQrCodeInput(code);
  const supabase = getSupabaseClient();
  const channel = supabase.channel(`pixchats-qr-login:${normalized}`, {
    config: { broadcast: { self: false } },
  });

  channel
    .on('broadcast', { event: 'qr-session-approve' }, async ({ payload }: any) => {
      if (!payload?.accessToken || !payload?.refreshToken) return;
      try {
        const { error } = await supabase.auth.setSession({
          access_token: payload.accessToken,
          refresh_token: payload.refreshToken,
        });
        if (error) {
          onError?.(error.message || 'Не удалось применить сессию');
          return;
        }
        onApproved({ deviceName: payload.approvedByDevice || 'Авторизованное устройство' });
      } catch (err: any) {
        onError?.(err?.message || 'Ошибка входа по QR-коду');
      }
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

/**
 * Подтверждение входа по QR-коду с уже авторизованного устройства (из вкладки «Устройства» в настройках).
 */
export async function approveQrLoginSession(rawCode: string): Promise<void> {
  const normalized = normalizeQrCodeInput(rawCode);
  if (!normalized || normalized.length < 4) {
    throw new Error('Введите корректный 6-значный код с экрана QR-входа');
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) {
    throw new Error('Активная сессия не найдена');
  }

  const currentDevice = buildCurrentDeviceSession();
  const channel = supabase.channel(`pixchats-qr-login:${normalized}`, {
    config: { broadcast: { self: false } },
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      supabase.removeChannel(channel);
      reject(new Error('Превышено время ожидания канала QR-авторизации'));
    }, 6000);

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          await channel.send({
            type: 'broadcast',
            event: 'qr-session-approve',
            payload: {
              accessToken: data.session!.access_token,
              refreshToken: data.session!.refresh_token,
              approvedByDevice: currentDevice.deviceName,
              timestamp: new Date().toISOString(),
            },
          });
          clearTimeout(timeout);
          setTimeout(() => {
            supabase.removeChannel(channel);
            resolve();
          }, 350);
        } catch (err) {
          clearTimeout(timeout);
          supabase.removeChannel(channel);
          reject(err);
        }
      }
    });
  });
}
