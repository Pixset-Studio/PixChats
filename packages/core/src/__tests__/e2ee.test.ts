import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  encryptMessageE2EE,
  decryptMessageE2EE,
  encodeLegacyBase64Text,
  isEncryptedE2EEPayload,
  getChatSafetyFingerprint,
} from '../crypto.ts';

describe('PixChats E2EE (AES-256-GCM Web Crypto)', () => {
  it('encrypts and decrypts UTF-8 Russian and emoji text accurately', async () => {
    const chatId = 'chat-uuid-1234';
    const plaintext = 'Привет, Pixset Studio! 🚀 Сквозное шифрование работает.';
    const ciphertext = await encryptMessageE2EE(chatId, plaintext);

    assert.equal(isEncryptedE2EEPayload(ciphertext), true);
    assert.ok(ciphertext.startsWith('e2ee:v2:'));

    const decrypted = await decryptMessageE2EE(chatId, ciphertext);
    assert.equal(decrypted, plaintext);
  });

  it('maintains 100% backwards compatibility with Phase 1 Base64 messages', async () => {
    const legacy = encodeLegacyBase64Text('Старое сообщение из базы');
    assert.equal(isEncryptedE2EEPayload(legacy), false);
    const decoded = await decryptMessageE2EE('any-chat', legacy);
    assert.equal(decoded, 'Старое сообщение из базы');
  });

  it('supports custom chat passphrase and blocks decryption with wrong passphrase', async () => {
    const chatId = 'secret-chat-999';
    const text = 'Секретный код запуска: 42';
    const encrypted = await encryptMessageE2EE(chatId, text, 'my-super-secret');

    const ok = await decryptMessageE2EE(chatId, encrypted, 'my-super-secret');
    assert.equal(ok, text);

    const wrong = await decryptMessageE2EE(chatId, encrypted, 'wrong-pass');
    assert.ok(wrong.includes('Зашифровано E2EE'));
  });

  it('computes deterministic SHA-256 safety fingerprint with 8 hex blocks and 4 emojis', async () => {
    const fp1 = await getChatSafetyFingerprint('chat-1', 'user-a', 'user-b');
    const fp2 = await getChatSafetyFingerprint('chat-1', 'user-b', 'user-a');

    assert.equal(fp1.hexBlocks.length, 8);
    assert.equal(fp1.emojis.length, 4);
    assert.deepEqual(fp1.hexBlocks, fp2.hexBlocks);
    assert.deepEqual(fp1.emojis, fp2.emojis);
  });
});
