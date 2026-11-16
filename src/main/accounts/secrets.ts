import { safeStorage } from 'electron'

export interface AccountSecret {
  password?: string
  refreshToken?: string
}

export function sealSecret(secret: AccountSecret): Buffer {
  const json = JSON.stringify(secret)
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Le chiffrement du système n'est pas disponible : impossible de stocker les identifiants en sécurité.")
  }
  return safeStorage.encryptString(json)
}

export function openSecret(blob: Uint8Array): AccountSecret {
  return JSON.parse(safeStorage.decryptString(Buffer.from(blob))) as AccountSecret
}
