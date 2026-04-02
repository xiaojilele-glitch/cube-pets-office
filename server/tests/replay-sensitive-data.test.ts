import { describe, it, expect } from 'vitest';
import {
  encryptMessage,
  decryptMessage,
  generateEncryptionKey,
  maskSensitiveData,
} from '../replay/sensitive-data.js';

describe('sensitive-data', () => {
  /* ─── Encryption / Decryption ─── */

  describe('encryptMessage / decryptMessage', () => {
    it('round-trips plaintext through encrypt → decrypt', () => {
      const key = generateEncryptionKey();
      const plaintext = 'Hello, sensitive world! 你好世界 🔐';
      const encrypted = encryptMessage(plaintext, key);
      const decrypted = decryptMessage(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('returns base64-encoded ciphertext, iv, and tag', () => {
      const key = generateEncryptionKey();
      const encrypted = encryptMessage('test', key);
      // base64 strings should not be empty
      expect(encrypted.ciphertext.length).toBeGreaterThan(0);
      expect(encrypted.iv.length).toBeGreaterThan(0);
      expect(encrypted.tag.length).toBeGreaterThan(0);
      // should be valid base64
      expect(() => Buffer.from(encrypted.ciphertext, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.iv, 'base64')).not.toThrow();
      expect(() => Buffer.from(encrypted.tag, 'base64')).not.toThrow();
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const key = generateEncryptionKey();
      const a = encryptMessage('same', key);
      const b = encryptMessage('same', key);
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('fails to decrypt with wrong key', () => {
      const key1 = generateEncryptionKey();
      const key2 = generateEncryptionKey();
      const encrypted = encryptMessage('secret', key1);
      expect(() => decryptMessage(encrypted, key2)).toThrow();
    });

    it('fails to decrypt with tampered ciphertext', () => {
      const key = generateEncryptionKey();
      const encrypted = encryptMessage('secret', key);
      // flip a character in ciphertext
      const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -1) + 'X' };
      expect(() => decryptMessage(tampered, key)).toThrow();
    });

    it('handles empty string', () => {
      const key = generateEncryptionKey();
      const encrypted = encryptMessage('', key);
      expect(decryptMessage(encrypted, key)).toBe('');
    });
  });

  describe('generateEncryptionKey', () => {
    it('returns a 32-byte Buffer', () => {
      const key = generateEncryptionKey();
      expect(Buffer.isBuffer(key)).toBe(true);
      expect(key.length).toBe(32);
    });

    it('generates unique keys', () => {
      const a = generateEncryptionKey();
      const b = generateEncryptionKey();
      expect(a.equals(b)).toBe(false);
    });
  });

  /* ─── Data Masking ─── */

  describe('maskSensitiveData', () => {
    it('masks password=xxx patterns', () => {
      expect(maskSensitiveData('password=abc123')).toBe('password=***');
      expect(maskSensitiveData('pwd=secret')).toBe('pwd=***');
      expect(maskSensitiveData('passwd=mypass')).toBe('passwd=***');
    });

    it('masks password in JSON-like strings', () => {
      const input = '{"password":"s3cret","user":"admin"}';
      const result = maskSensitiveData(input);
      expect(result).toContain('"password":"***"');
      expect(result).toContain('"user":"admin"');
    });

    it('masks email addresses', () => {
      const result = maskSensitiveData('contact: alice@example.com');
      expect(result).not.toContain('alice@example.com');
      expect(result).toContain('@example.com');
    });

    it('masks Chinese phone numbers', () => {
      const result = maskSensitiveData('call 13812345678');
      expect(result).not.toContain('13812345678');
      expect(result).toContain('138****5678');
    });

    it('masks international phone numbers', () => {
      const result = maskSensitiveData('phone: +86-138-1234-5678');
      expect(result).not.toContain('+86-138-1234-5678');
      expect(result).toContain('****5678');
    });

    it('masks Bearer tokens', () => {
      const result = maskSensitiveData('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig');
      expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(result).toContain('Bearer ***');
    });

    it('masks api_key patterns', () => {
      expect(maskSensitiveData('api_key=sk-abc123xyz')).toBe('api_key=***');
      expect(maskSensitiveData('token=mytoken123')).toBe('token=***');
      expect(maskSensitiveData('secret=topsecret')).toBe('secret=***');
    });

    it('masks credit card numbers', () => {
      const result = maskSensitiveData('card: 4111111111111111');
      expect(result).toContain('4111****1111');
      expect(result).not.toContain('4111111111111111');
    });

    it('returns text unchanged when no sensitive data present', () => {
      const text = 'This is a normal log message with no secrets.';
      expect(maskSensitiveData(text)).toBe(text);
    });

    it('handles empty string', () => {
      expect(maskSensitiveData('')).toBe('');
    });

    it('masks multiple sensitive items in one string', () => {
      const input = 'user=admin password=secret email: test@example.com phone: 13900001111';
      const result = maskSensitiveData(input);
      expect(result).not.toContain('secret');
      expect(result).not.toContain('test@example.com');
      expect(result).not.toContain('13900001111');
    });
  });
});
