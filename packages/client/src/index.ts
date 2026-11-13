/**
 * Public barrel export for `@yafl/client` — private, never published.
 * Shared apiClient/deviceFlow/credentialStore consumed by apps/cli today,
 * and available to apps/mcp later (both esbuild bundles inline this module,
 * so it never appears as a dependency of either published tarball).
 */
export {
  callApi,
  ApiError,
  listTransfers,
  deleteTransfer,
  type ApiClientOptions,
  type TransferListItem,
} from './apiClient.js'
export {
  requestAndPoll,
  DeviceFlowExpiredError,
  DeviceFlowDeniedError,
  type DevicePrompt,
  type DeviceFlowResult,
  type DeviceFlowOptions,
} from './deviceFlow.js'
export {
  save,
  load,
  configPathFor,
  keyPrefix,
  type Credentials,
  type CredentialStoreOptions,
} from './credentialStore.js'
export {
  composeKey,
  resolveKey,
  PasswordRequiredError,
  type ComposedKey,
  type ParsedShareUrl,
} from './passwordKey.js'
export { sanitizeFilename, resolveCollision, collisionCandidate } from './fsSafety.js'
export {
  MAX_TRANSFER_SIZE,
  readDirOrFile,
  uploadEncrypted,
  resolveShareLink,
  downloadDecrypt,
  writeDecrypted,
  MissingKeyError,
  R2TransferError,
} from './transferPipeline.js'
export { assertSecureApiUrl, InsecureApiUrlError } from './apiUrl.js'
