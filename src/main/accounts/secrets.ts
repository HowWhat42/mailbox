import { safeStorage } from 'electron'

export interface AccountSecret {
  password?: string
  refreshToken?: string
}

/** Encrypts a string with the OS keychain (DPAPI on Windows, Keychain on macOS). */
export async function sealString(text: string): Promise<Buffer> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("Le chiffrement du système n'est pas disponible : impossible de stocker les identifiants en sécurité.")
  }
  return safeStorage.encryptStringAsync(text)
}

/**
 * Decrypts a blob sealed by `sealString` (or by the older synchronous API). When the OS rotated its
 * key, the plain text is sealed again and handed to `reseal` so the caller stores the fresh blob.
 */
export async function openString(blob: Uint8Array, reseal: (fresh: Buffer) => void): Promise<string> {
  const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(blob))
  if (shouldReEncrypt) reseal(await sealString(result))
  return result
}

export function sealSecret(secret: AccountSecret): Promise<Buffer> {
  return sealString(JSON.stringify(secret))
}

export async function openSecret(blob: Uint8Array, reseal: (fresh: Buffer) => void): Promise<AccountSecret> {
  return JSON.parse(await openString(blob, reseal)) as AccountSecret
}
