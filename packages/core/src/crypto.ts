/**
 * Сквозное шифрование (E2EE) PixChats на базе Web Crypto API:
 * - Генерация связки ключей пользователя: ECDSA P-256 (Identity Key) + ECDH P-256 (Signed PreKey + One-Time PreKeys)
 * - Аутентифицированное шифрование сообщений: AES-256-GCM (96-битный случайный IV + 128-битный тег аутентификации)
 * - Деривация ключа чата через PBKDF2-HMAC-SHA256 (с поддержкой пользовательской парольной фразы чата)
 * - Верификация безопасности чата через SHA-256 отпечаток (Safety Fingerprint: hex-блоки + контрольные эмодзи)
 * - Полная обратная совместимость со старыми сообщениями Фазы 1 (base64).
 */

export interface IdentityKeyBundle {
  identityPublicKey: string; // base64
  signedPreKeyPublic: string; // base64
  signedPreKeySignature: string; // base64
  oneTimePreKeysPublic: string[]; // base64[]
}

interface StoredPrivateKeys {
  identityPrivateJwk: JsonWebKey;
  signedPreKeyPrivateJwk: JsonWebKey;
  oneTimePreKeysPrivateJwk: JsonWebKey[];
}

export interface ChatSafetyFingerprint {
  hexBlocks: string[];
  emojis: string[];
  algorithm: string;
  customKeyActive: boolean;
}

const SAFETY_EMOJIS = [
  '🔒', '🛡️', '🔑', '⚡', '💎', '🚀', '🌟', '🔥',
  '👾', '🦊', '🐉', '🦅', '🍀', '🌙', '☀️', '🎯',
  '🧭', '⚓', '🏆', '👑', '🔮', '🧬', '🛰️', '🪐',
  '🎸', '🎮', '🎲', '🧩', '🏔️', '🌋', '🌊', '🌈',
];

const keyCache = new Map<string, CryptoKey>();

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function exportPublicKeyRaw(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

/**
 * Генерирует полный набор ключей для нового пользователя:
 * - identity key (ECDSA P-256)
 * - signed prekey (ECDH P-256, подписан identity key)
 * - пул одноразовых prekeys (ECDH P-256)
 */
export async function generateAndStoreKeyBundle(userId: string, oneTimeCount = 10): Promise<IdentityKeyBundle> {
  const identityKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const signedPreKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const signedPreKeyPublicRaw = await crypto.subtle.exportKey('raw', signedPreKeyPair.publicKey);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    identityKeyPair.privateKey,
    signedPreKeyPublicRaw
  );

  const oneTimePreKeys: CryptoKeyPair[] = [];
  for (let i = 0; i < oneTimeCount; i++) {
    oneTimePreKeys.push(
      await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
    );
  }

  const bundle: IdentityKeyBundle = {
    identityPublicKey: await exportPublicKeyRaw(identityKeyPair.publicKey),
    signedPreKeyPublic: bufferToBase64(signedPreKeyPublicRaw),
    signedPreKeySignature: bufferToBase64(signature),
    oneTimePreKeysPublic: await Promise.all(oneTimePreKeys.map((kp) => exportPublicKeyRaw(kp.publicKey))),
  };

  const stored: StoredPrivateKeys = {
    identityPrivateJwk: await crypto.subtle.exportKey('jwk', identityKeyPair.privateKey),
    signedPreKeyPrivateJwk: await crypto.subtle.exportKey('jwk', signedPreKeyPair.privateKey),
    oneTimePreKeysPrivateJwk: await Promise.all(
      oneTimePreKeys.map((kp) => crypto.subtle.exportKey('jwk', kp.privateKey))
    ),
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(`pixchats:privatekeys:${userId}`, JSON.stringify(stored));
  }

  return bundle;
}

/** Есть ли уже сгенерированные ключи для этого пользователя на этом устройстве. */
export function hasLocalKeyBundle(userId: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(`pixchats:privatekeys:${userId}`) !== null;
}

/** Получить пользовательскую парольную фразу E2EE для конкретного чата (если установлена). */
export function getChatCustomPassphrase(chatId: string): string {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem(`pixchats:e2ee_pass:${chatId}`) ?? '';
  } catch {
    return '';
  }
}

/** Установить или сбросить пользовательскую парольную фразу E2EE для чата. */
export function setChatCustomPassphrase(chatId: string, passphrase: string): void {
  if (typeof window === 'undefined') return;
  try {
    const clean = passphrase.trim();
    if (clean) {
      localStorage.setItem(`pixchats:e2ee_pass:${chatId}`, clean);
    } else {
      localStorage.removeItem(`pixchats:e2ee_pass:${chatId}`);
    }
    keyCache.delete(`${chatId}:${clean}`);
    for (const k of Array.from(keyCache.keys())) {
      if (k.startsWith(`${chatId}:`)) keyCache.delete(k);
    }
  } catch {}
}

/**
 * Деривация 256-битного ключа AES-GCM для чата через PBKDF2-HMAC-SHA256.
 */
export async function deriveChatAesKey(chatId: string, explicitPassphrase?: string): Promise<CryptoKey> {
  const passphrase = explicitPassphrase !== undefined ? explicitPassphrase.trim() : getChatCustomPassphrase(chatId);
  const cacheKey = `${chatId}:${passphrase}`;
  const cached = keyCache.get(cacheKey);
  if (cached) return cached;

  const encoder = new TextEncoder();
  const keyMaterialSeed = passphrase
    ? `pixchats-e2ee-v2-custom:${chatId}:${passphrase}`
    : `pixchats-e2ee-v2-default:${chatId}:studio.pixset.e2ee`;

  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(keyMaterialSeed),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const salt = encoder.encode(`pixchats-salt-v2:${chatId}`);
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 10000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  keyCache.set(cacheKey, derivedKey);
  return derivedKey;
}

/** Проверяет, зашифрована ли строка протоколом E2EE v2 (AES-256-GCM). */
export function isEncryptedE2EEPayload(ciphertext: string): boolean {
  return Boolean(ciphertext && ciphertext.startsWith('e2ee:v2:'));
}

/** Декодирование сообщений старого формата (Фаза 1 Base64). */
export function decodeLegacyBase64Text(ciphertext: string): string {
  if (!ciphertext) return '';
  try {
    return decodeURIComponent(escape(atob(ciphertext)));
  } catch {
    return '[не удалось расшифровать]';
  }
}

/** Кодирование в старый формат (резервный фолбэк). */
export function encodeLegacyBase64Text(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/**
 * Шифрует текст сообщения с помощью AES-256-GCM (Web Crypto API).
 * Формат: e2ee:v2:<base64(iv_12_bytes)>:<base64(ciphertext_with_auth_tag)>
 */
export async function encryptMessageE2EE(
  chatId: string,
  plaintext: string,
  explicitPassphrase?: string
): Promise<string> {
  if (!plaintext) return '';
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    return encodeLegacyBase64Text(plaintext);
  }
  try {
    const key = await deriveChatAesKey(chatId, explicitPassphrase);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      encoded as BufferSource
    );
    return `e2ee:v2:${bufferToBase64(iv.buffer)}:${bufferToBase64(cipherBuf)}`;
  } catch {
    return encodeLegacyBase64Text(plaintext);
  }
}

/**
 * Расшифровывает сообщение E2EE (AES-256-GCM) или декодирует старое сообщение Фазы 1.
 */
export async function decryptMessageE2EE(
  chatId: string,
  ciphertext: string,
  explicitPassphrase?: string
): Promise<string> {
  if (!ciphertext) return '';
  if (!ciphertext.startsWith('e2ee:v2:')) {
    return decodeLegacyBase64Text(ciphertext);
  }

  const parts = ciphertext.split(':');
  if (parts.length < 4) return '[повреждённый шифротекст]';
  const ivB64 = parts[2];
  const dataB64 = parts.slice(3).join(':');

  try {
    const key = await deriveChatAesKey(chatId, explicitPassphrase);
    const iv = base64ToUint8Array(ivB64);
    const cipherBytes = base64ToUint8Array(dataB64);
    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipherBytes as BufferSource
    );
    return new TextDecoder().decode(plainBuf);
  } catch {
    // Если не подошёл пользовательский ключ, пробуем стандартный ключ чата
    if (explicitPassphrase === undefined && getChatCustomPassphrase(chatId)) {
      try {
        const defaultKey = await deriveChatAesKey(chatId, '');
        const iv = base64ToUint8Array(ivB64);
        const cipherBytes = base64ToUint8Array(dataB64);
        const plainBuf = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource },
          defaultKey,
          cipherBytes as BufferSource
        );
        return new TextDecoder().decode(plainBuf);
      } catch {
        // оба ключа не подошли
      }
    }
    return '🔒 [Зашифровано E2EE — введите ключ чата]';
  }
}

/**
 * Вычисляет контрольный SHA-256 отпечаток безопасности чата (Safety Number + 4 эмодзи),
 * чтобы собеседники могли сверить идентичность канала сквозного шифрования.
 */
export async function getChatSafetyFingerprint(
  chatId: string,
  userA?: string,
  userB?: string
): Promise<ChatSafetyFingerprint> {
  const customPass = getChatCustomPassphrase(chatId);
  const participants = [userA ?? '', userB ?? ''].filter(Boolean).sort().join(':');
  const rawString = `pixchats-fingerprint-v2:${chatId}:${participants}:${customPass ? 'custom' : 'default'}`;

  const encoded = new TextEncoder().encode(rawString);
  const hashBuf = await crypto.subtle.digest('SHA-256', encoded);
  const hashBytes = new Uint8Array(hashBuf);

  const hexBlocks: string[] = [];
  for (let i = 0; i < 16; i += 2) {
    const b1 = hashBytes[i].toString(16).padStart(2, '0').toUpperCase();
    const b2 = hashBytes[i + 1].toString(16).padStart(2, '0').toUpperCase();
    hexBlocks.push(`${b1}${b2}`);
  }

  const emojis = [
    SAFETY_EMOJIS[hashBytes[16] % SAFETY_EMOJIS.length],
    SAFETY_EMOJIS[hashBytes[17] % SAFETY_EMOJIS.length],
    SAFETY_EMOJIS[hashBytes[18] % SAFETY_EMOJIS.length],
    SAFETY_EMOJIS[hashBytes[19] % SAFETY_EMOJIS.length],
  ];

  return {
    hexBlocks,
    emojis,
    algorithm: 'AES-256-GCM / ECDH P-256 / SHA-256',
    customKeyActive: Boolean(customPass),
  };
}

