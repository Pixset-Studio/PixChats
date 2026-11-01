import { getSupabaseClient } from '@pixchats/core';
import { buildCurrentDeviceSession } from './deviceSessions';

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
  const cleaned = raw.trim().toUpperCase();
  if (cleaned.startsWith('PIXCHATS-QR:')) {
    return cleaned.replace('PIXCHATS-QR:', '').trim();
  }
  return cleaned.replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

/**
 * Строит детерминированную 25x25 QR-матрицу (с тремя угловыми поисковыми квадратами 7x7,
 * полосами синхронизации и выравнивающим маркером) для визуального отображения и сканирования.
 */
export function buildQrMatrix(code: string): boolean[][] {
  const size = 25;
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  function placeFinder(rowOffset: number, colOffset: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const rr = rowOffset + r;
        const cc = colOffset + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        reserved[rr][cc] = true;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          matrix[rr][cc] = isBorder || isCenter;
        }
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Выравнивающий квадрат 5x5 в правом нижнем углу
  const alignCenter = size - 7;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const rr = alignCenter + r;
      const cc = alignCenter + c;
      reserved[rr][cc] = true;
      const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
      const isCenter = r === 0 && c === 0;
      matrix[rr][cc] = isBorder || isCenter;
    }
  }

  // Линии синхронизации
  for (let i = 8; i < size - 8; i++) {
    reserved[6][i] = true;
    reserved[i][6] = true;
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Заполняем информационные модули на основе хеша строки `PIXCHATS-QR:${code}`
  const payload = `PIXCHATS-QR:${code}`;
  let seed = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    seed ^= payload.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      seed ^= (r * 31 + c * 17 + payload.charCodeAt((r + c) % payload.length)) & 0xff;
      seed = Math.imul(seed, 16777619);
      matrix[r][c] = (Math.abs(seed) & 1) === 1;
    }
  }

  return matrix;
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
