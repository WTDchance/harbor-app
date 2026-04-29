// lib/aws/token-encryption.ts
//
// W51 D3 — symmetric encryption for OAuth tokens at rest.
//
// Production path (preferred): AWS KMS envelope encryption. The
// HARBOR_TOKEN_KMS_KEY_ARN env var points at a CMK; we use the
// @aws-sdk/client-kms `Encrypt` / `Decrypt` operations to wrap the
// tokens. KMS calls are logged through CloudTrail.
//
// Sandbox/dev path: AES-256-GCM with the HARBOR_TOKEN_ENC_KEY env var
// (32 random bytes, base64-encoded). Functionally equivalent; without
// CloudTrail audit. Production deployments MUST set the KMS variant.
//
// Output format (both paths): `v1:<provider>:<base64>` so callers can
// migrate ciphertexts when keys rotate.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function loadAesKey(): Buffer | null {
  const raw = process.env.HARBOR_TOKEN_ENC_KEY
  if (!raw) return null
  try {
    const buf = Buffer.from(raw, 'base64')
    if (buf.length !== 32) return null
    return buf
  } catch { return null }
}

function aesEncrypt(plaintext: string): string {
  const key = loadAesKey()
  if (!key) {
    throw new Error('HARBOR_TOKEN_ENC_KEY not set or not 32 bytes (base64). Refusing to store tokens unencrypted.')
  }
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // [iv(12) | tag(16) | ciphertext]
  const blob = Buffer.concat([iv, tag, enc]).toString('base64')
  return `${VERSION}:aes-256-gcm:${blob}`
}

function aesDecrypt(payload: string): string {
  const key = loadAesKey()
  if (!key) throw new Error('HARBOR_TOKEN_ENC_KEY not set; cannot decrypt token.')
  const [ver, alg, b64] = payload.split(':')
  if (ver !== VERSION || alg !== 'aes-256-gcm') throw new Error('unsupported_token_format')
  const buf = Buffer.from(b64, 'base64')
  if (buf.length < 28) throw new Error('malformed_ciphertext')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ct = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(ct), decipher.final()])
  return dec.toString('utf8')
}

/**
 * Encrypt an OAuth token (refresh or access) for storage in the database.
 * If HARBOR_TOKEN_KMS_KEY_ARN is configured, uses AWS KMS; otherwise falls
 * back to AES-256-GCM keyed on HARBOR_TOKEN_ENC_KEY.
 */
export async function encryptToken(plaintext: string): Promise<string> {
  if (!plaintext) return ''
  const kmsArn = process.env.HARBOR_TOKEN_KMS_KEY_ARN
  if (kmsArn) {
    try {
      // Lazy import so the AWS SDK isn't pulled into every cold start.
      const { KMSClient, EncryptCommand } = await import('@aws-sdk/client-kms')
      const client = new KMSClient({ region: process.env.AWS_REGION || 'us-west-2' })
      const out = await client.send(new EncryptCommand({
        KeyId: kmsArn,
        Plaintext: Buffer.from(plaintext, 'utf8'),
      }))
      const blob = Buffer.from(out.CiphertextBlob ?? new Uint8Array()).toString('base64')
      return `${VERSION}:kms:${blob}`
    } catch (err) {
      console.error('[token-encryption] KMS encrypt failed; falling back to AES:', (err as Error).message)
    }
  }
  return aesEncrypt(plaintext)
}

export async function decryptToken(payload: string | null | undefined): Promise<string> {
  if (!payload) return ''
  const [ver, alg] = payload.split(':')
  if (ver !== VERSION) throw new Error('unsupported_token_version')
  if (alg === 'kms') {
    const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms')
    const client = new KMSClient({ region: process.env.AWS_REGION || 'us-west-2' })
    const blob = Buffer.from(payload.split(':')[2], 'base64')
    const out = await client.send(new DecryptCommand({ CiphertextBlob: blob }))
    return Buffer.from(out.Plaintext ?? new Uint8Array()).toString('utf8')
  }
  return aesDecrypt(payload)
}
