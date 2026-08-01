/**
 * Public barrel export for `@yafl/crypto` — the single shared AES-256-GCM
 * WebCrypto module consumed unmodified by the MCP server (Phase 3, Node) and
 * the web UI (Phase 4, browser).
 */
export { generateKey, encryptBytes, decryptBytes } from './aesGcm.js'
export { encryptMeta, decryptMeta, type TransferMeta } from './metadata.js'
export {
  keyToFragment,
  keyFromFragment,
  saltToFragment,
  buildShareUrl,
  buildRetrievalCode,
  buildRetrievalCommand,
  buildLinkArtifacts,
  parseShareUrl,
  type V2ShareUrlOptions,
} from './fragment.js'
export { toBase64Url, fromBase64Url } from './base64url.js'
export { deriveKeyFromPassword, PBKDF2_ITERATIONS } from './deriveKey.js'
export { zipEntries, type ZipEntry } from './zip.js'
