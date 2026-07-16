/**
 * ВАЖНО: это временная реализация на Web Crypto API для Фазы 1.
 * В Фазе 2 весь этот файл заменяется на libsignal-client (настоящий X3DH + Double Ratchet).
 * Задача Фазы 1 — завести сам механизм генерации/хранения ключей и отправку публичной
 * части на сервер, чтобы в Фазе 2 не пришлось трогать схему БД и flow регистрации.
 *
 * Приватные ключи НИКОГДА не покидают браузер — хранятся в localStorage под ключом
 * pixchats:privatekeys:<userId> (в Фазе 2 переедет в IndexedDB, т.к. появится больше данных
 * сессий Double Ratchet).
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

function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function exportPublicKeyRaw(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToBase64(raw);
}

/**
 * Генерирует полный набор ключей для нового пользователя:
 * - identity key (ECDSA P-256, может подписывать — аналог Ed25519 identity key в Signal)
 * - signed prekey (ECDH P-256, подписан identity key)
 * - пул одноразовых prekeys (ECDH P-256)
 *
 * Возвращает публичную часть (для отправки в Supabase) и сохраняет приватную часть локально.
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
