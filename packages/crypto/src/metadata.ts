import { encryptBytes, decryptBytes } from './aesGcm.js'

/** Filename + content-type carried alongside a transfer (CRYP-03). */
export type TransferMeta = {
  name: string
  type: string
}

/**
 * Encrypts `meta` (filename + content-type) into its own opaque AES-GCM blob
 * so the server can store it but never read it (CRYP-03). This calls
 * `encryptBytes` independently of any file-blob encryption happening
 * elsewhere — it gets its own fresh IV from its own `crypto.getRandomValues`
 * call inside `encryptBytes`, and must never share an IV variable with the
 * file-content encryption (RESEARCH.md Pitfall 2 explicit warning).
 */
export async function encryptMeta(key: Uint8Array, meta: TransferMeta): Promise<Uint8Array> {
  const json = JSON.stringify(meta)
  return encryptBytes(key, new TextEncoder().encode(json))
}

/**
 * Decrypts a metadata blob produced by `encryptMeta` back into the original
 * `{ name, type }` object. Inherits `decryptBytes`'s tamper detection — a
 * corrupted or tampered metadata blob throws rather than returning malformed
 * data.
 */
export async function decryptMeta(key: Uint8Array, blob: Uint8Array): Promise<TransferMeta> {
  const bytes = await decryptBytes(key, blob)
  return JSON.parse(new TextDecoder().decode(bytes)) as TransferMeta
}
