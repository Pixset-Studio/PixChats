import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isRecordPremiumActive,
  isBirthdayToday,
  encodeTableMessage,
  parseTableMessage,
  encodeAlbumMessage,
  parseAlbumMessage,
  parseTimecodeToSeconds,
  generatePixsetAvatarSvgDataUrl,
  type PremiumRecord,
} from './premiumAndFeatures';

test('isRecordPremiumActive evaluates permanent and time-bounded Premium records', () => {
  const now = new Date('2026-11-03T12:00:00Z').getTime();

  const permanentRecord: PremiumRecord = {
    userId: 'u_perm',
    expiresAt: null,
    grantedAt: '2026-11-01T00:00:00Z',
  };
  assert.equal(isRecordPremiumActive(permanentRecord, now), true);

  const activeTimedRecord: PremiumRecord = {
    userId: 'u_active',
    expiresAt: '2026-12-01T00:00:00Z',
    grantedAt: '2026-11-01T00:00:00Z',
  };
  assert.equal(isRecordPremiumActive(activeTimedRecord, now), true);

  const expiredRecord: PremiumRecord = {
    userId: 'u_expired',
    expiresAt: '2026-10-01T00:00:00Z',
    grantedAt: '2026-09-01T00:00:00Z',
  };
  assert.equal(isRecordPremiumActive(expiredRecord, now), false);
  assert.equal(isRecordPremiumActive(null, now), false);
});

test('isBirthdayToday matches month and day regardless of year', () => {
  const refDate = new Date(2026, 10, 3); // Nov 3, 2026 (month is 0-indexed: 10 = November)
  assert.equal(isBirthdayToday('2001-11-03', refDate), true);
  assert.equal(isBirthdayToday('11-03', refDate), true);
  assert.equal(isBirthdayToday('2001-11-04', refDate), false);
  assert.equal(isBirthdayToday('', refDate), false);
  assert.equal(isBirthdayToday(null, refDate), false);
});

test('encodeTableMessage and parseTableMessage round-trip table and caption', () => {
  const payload = {
    headers: ['Имя', 'Статус'],
    rows: [
      ['Алексей', 'Premium'],
      ['Мария', 'Онлайн'],
    ],
  };
  const encoded = encodeTableMessage(payload, 'Список участников');
  const parsed = parseTableMessage(encoded);
  assert.ok(parsed);
  assert.deepEqual(parsed.table, payload);
  assert.equal(parsed.caption, 'Список участников');
  assert.equal(parseTableMessage('Обычное сообщение'), null);
});

test('encodeAlbumMessage and parseAlbumMessage round-trip photo album payload', () => {
  const album = {
    images: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
    caption: 'Отпуск 2026',
    spoiler: true,
  };
  const encoded = encodeAlbumMessage(album);
  const parsed = parseAlbumMessage(encoded);
  assert.ok(parsed);
  assert.deepEqual(parsed.images, album.images);
  assert.equal(parsed.caption, 'Отпуск 2026');
  assert.equal(parsed.spoiler, true);
});

test('parseTimecodeToSeconds converts MM:SS and HH:MM:SS into seconds', () => {
  assert.equal(parseTimecodeToSeconds('00:15'), 15);
  assert.equal(parseTimecodeToSeconds('01:25'), 85);
  assert.equal(parseTimecodeToSeconds('01:02:03'), 3723);
  assert.equal(parseTimecodeToSeconds('01:99'), null);
  assert.equal(parseTimecodeToSeconds('invalid'), null);
});

test('generatePixsetAvatarSvgDataUrl generates deterministic SVG data URLs for pixel and 3d styles', () => {
  const pixel1 = generatePixsetAvatarSvgDataUrl({ seed: 'pixuser', bgIndex: 0, style: 'pixel' });
  const pixel2 = generatePixsetAvatarSvgDataUrl({ seed: 'pixuser', bgIndex: 0, style: 'pixel' });
  const threeD = generatePixsetAvatarSvgDataUrl({ seed: 'pixuser', bgIndex: 1, style: '3d' });

  assert.equal(pixel1, pixel2);
  assert.ok(pixel1.startsWith('data:image/svg+xml;utf8,'));
  assert.ok(threeD.startsWith('data:image/svg+xml;utf8,'));
  assert.notEqual(pixel1, threeD);
});

test('parseProfileAdminEnvelope and parseProfileUserEnvelope preserve cross-device Premium and Favorite Music audioUrl', async () => {
  const { parseProfileAdminEnvelope, parseProfileUserEnvelope, hydrateProfileRowEnvelopes } = await import(
    '@pixchats/core'
  );

  const adminEnvRaw = `pxadm:v1:${JSON.stringify({
    premium: {
      userId: 'u_cross_device',
      username: 'crossuser',
      grantedBy: 'admin',
      grantedAt: '2026-11-03T10:00:00Z',
      expiresAt: null,
      revoked: false,
      note: 'VIP тест',
    },
    frozen_reason: 'Проверка безопасности',
  })}`;

  const parsedAdm = parseProfileAdminEnvelope(adminEnvRaw);
  assert.ok(parsedAdm.premium);
  assert.equal(parsedAdm.premium?.userId, 'u_cross_device');
  assert.equal(parsedAdm.premium?.expiresAt, null);
  assert.equal(parsedAdm.frozen_reason, 'Проверка безопасности');

  const userEnvRaw = `pxext:v1:${JSON.stringify({
    birthDate: '2000-05-15',
    musicStatus: {
      title: 'Starlight',
      artist: 'Pixset Synth',
      audioUrl: 'https://example.com/audio/starlight.mp3',
      fileName: 'starlight.mp3',
    },
  })}`;

  const parsedUser = parseProfileUserEnvelope(userEnvRaw);
  assert.equal(parsedUser.birthDate, '2000-05-15');
  assert.equal(parsedUser.musicStatus?.title, 'Starlight');
  assert.equal(parsedUser.musicStatus?.artist, 'Pixset Synth');
  assert.equal(parsedUser.musicStatus?.audioUrl, 'https://example.com/audio/starlight.mp3');
  assert.equal(parsedUser.musicStatus?.fileName, 'starlight.mp3');

  const hydratedRow = hydrateProfileRowEnvelopes({
    id: 'u_cross_device',
    username: 'crossuser',
    display_name: 'Cross User',
    public_signed_prekey: adminEnvRaw,
    signed_prekey_signature: userEnvRaw,
  });
  assert.equal(hydratedRow.frozen_reason, 'Проверка безопасности');
});

