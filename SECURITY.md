# Security Policy

This document covers the **YAFL MCP client** — the open-source packages published as [`@yafldev/mcp`](https://www.npmjs.com/package/@yafldev/mcp) (an npx-runnable, stdio MCP server) and [`@yafldev/cli`](https://www.npmjs.com/package/@yafldev/cli). These packages are the code in this repository, and they are what performs client-side encryption, key generation, and decryption on your machine.

**Scope of this document and this audit claim.** The client in this repository is open source and can be independently audited. The YAFL **app server and backend are closed source and are *not* covered by this repository.** When we say "auditable," we mean *the MCP client is auditable* — not the whole product. Statements below about backend behaviour describe the security *properties the client relies on and the guarantees that hold even if the backend misbehaves*; they are not claims about backend source you can read.

> **Verification status (2026-08-01).** Every cryptographic claim below has been confirmed against the actual implementation in this repository (`packages/crypto`, `packages/client`) — see the file/function references inline. The only remaining `TODO(maintainer)` items are **policy** decisions (security contact, disclosure SLA, version-support window), not unverified crypto. Two honest, code-confirmed caveats are called out explicitly and must not be papered over: the **`email_link`** feature is a deliberate exception to "the key never reaches the server" (§2), and the **web download page** (the closed frontend, out of this repo) must keep the URL fragment out of analytics (§2, resolved 2026-08-01).

---

## Reporting a vulnerability

**Please report security issues privately. Do not open a public GitHub issue, pull request, or discussion for a suspected vulnerability.**

- **Email:** `security@yafl.dev` — `TODO(maintainer): confirm security contact` (address and, if used, a PGP key / signed-message channel).
- **What to include:** affected package and version, a description of the issue, reproduction steps or a proof of concept, and the impact you believe it has. If the finding involves a specific transfer or link, redact the URL fragment before sending it — the fragment is a decryption key (see the threat model).
- **What we ask of you:** give us a reasonable, good-faith window to investigate and ship a fix before any public disclosure, and avoid privacy violations, data destruction, or service disruption while researching.

### Coordinated disclosure expectations

- We aim to **acknowledge** your report within a few business days and to keep you updated as we triage and fix.
- We follow **coordinated disclosure**: we will agree a disclosure timeline with you, publish a fix, and credit you (if you wish) once users have had a reasonable chance to upgrade. A common default is up to **90 days** from report to public disclosure, shorter for actively exploited issues.
- `TODO(maintainer): confirm the exact acknowledgement SLA, fix-target window, and disclosure timeline you want to commit to publicly.`

### Supported versions

Security fixes are provided for the **latest published release** of `@yafldev/mcp` and `@yafldev/cli`. Older versions are expected to be upgraded to receive fixes.

| Package | Supported |
|---|---|
| `@yafldev/mcp` (latest release) | Yes |
| `@yafldev/cli` (latest release) | Yes |
| Older releases | Upgrade to latest |

`TODO(maintainer): confirm the version-support policy — e.g. whether only the latest minor is supported, or the last N majors, and the minimum supported version line.`

---

## Security model (overview)

YAFL is designed so that **confidentiality of file contents does not depend on trusting the YAFL servers.**

- **Client-side encryption.** Every file is encrypted on your machine, before upload, with a **fresh AES-256-GCM key** generated per transfer (`packages/crypto/src/aesGcm.ts` `generateKey`/`encryptBytes`). If you point a tool at a directory, it is zipped **client-side first** (`packages/client/src/transferPipeline.ts` `readDirOrFile` → `zipEntries`), so the archive — including the inner filenames and structure — is encrypted as a unit.
- **The key never reaches a server** (with one opt-in exception, §2). The AES-256-GCM key travels **only in the share URL's `#fragment`**. Browsers do not transmit the fragment to servers, so the key is never sent to, logged by, or stored on any YAFL server or on storage.
- **Bytes go straight to storage as ciphertext.** File bytes are uploaded directly to object storage (Cloudflare R2) via **pre-signed URLs**. The app server never handles file bytes; storage only ever receives **ciphertext**.
- **The API key is not the decryption key.** Authentication (an API key, obtained via an RFC 8628 device flow) authorizes *management* of transfers for that key. It does **not** grant the ability to read file contents.
- **Optional layers.** An optional **link password** adds a second, derived layer the server never sees. An optional **one-time link** self-destructs after the first successful download.
- **Expiry.** Access stops at **24 hours**; storage cleanup runs as a backstop after that.

The **trust boundary is your own machine (and the machine of whoever you share a link with).** Everything crossing to YAFL's servers or storage is ciphertext plus operational metadata.

---

## Threat model

### Assets

1. **File contents** (the plaintext bytes / the zipped directory). Highest-value asset.
2. **Decryption keys** — the per-file AES-256-GCM key (in the URL fragment) and any password-derived layer.
3. **API keys / device-flow credentials** — authorize creating, listing, and deleting a given agent's transfers.
4. **Transfer metadata** — ids, timestamps, TTL, sizes, ownership (which API key made which transfer), recipient email addresses passed to `email_link`, and encrypted filename/content-type (see the metadata dimension).

### Trust boundary

Encryption and decryption happen **entirely inside the client in this repository**, on the user's machine. Keys are generated locally and, for a recipient, are only ever present locally after being parsed out of the link fragment. **No decryption key crosses the boundary to a YAFL server or to storage** — except the single, opt-in `email_link` flow (§2).

### Adversaries considered

The core question this model answers, per dimension, is what each of these three adversaries **CAN** and **CANNOT** learn or do:

- **A — Compromised app server** (the closed backend is fully controlled by an attacker: metadata database, pre-signed-URL issuance, API surface).
- **B — Compromised storage bucket** (the R2 bucket / object store is fully readable and writable by an attacker).
- **C — Stolen API key** (an attacker has exfiltrated one agent's YAFL API key, e.g. from a compromised VPS).

A design goal of YAFL is that **none of A, B, or C, alone, can read file contents**, because the decryption key is never in any of those places (again, except `email_link`, §2).

---

### 1. Key generation

Each transfer uses a **fresh AES-256-GCM key** generated on the client before upload. A per-file random 256-bit key means keys are not shared across transfers, so a compromise of one transfer's key does not affect any other transfer.

**Confirmed in code:** `generateKey()` fills a 32-byte (256-bit) buffer from the platform CSPRNG — `crypto.getRandomValues(new Uint8Array(32))` — never `Math.random` (`packages/crypto/src/aesGcm.ts:17`). For a v2 (password) link the key is instead derived from PBKDF2 (§7); it is still a full 256-bit AES key.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | Nothing about key material — keys are never sent to it (except a link handed to `email_link`, §2) | Recover or predict any file key |
| B — storage | Nothing about key material — keys never reach storage | Recover or predict any file key |
| C — stolen API key | Nothing about existing transfers' key material | Recover keys for that key's own past transfers (they are not stored server-side) |

---

### 2. Key sharing / distribution — the URL-fragment channel

The decryption key is distributed **only** inside the share URL's `#fragment` (`https://yafl.dev/t/<id>#<key-material>`). This is the single most security-sensitive part of the design, and it deserves the most scrutiny.

**Why the fragment.** By the URL spec, browsers do not send the `#fragment` to the server on navigation, and it is not placed in the `Referer` header sent to the origin. So the key rides along with the link for a human/agent recipient, but the server that stores the transfer never receives it. **Confirmed:** the fragment is assembled and parsed only in `packages/crypto/src/fragment.ts` (`buildShareUrl`/`parseShareUrl`); the client never puts the fragment in an API request body on a normal send or download.

**The link (with fragment) is a bearer secret.** Anyone who obtains the *full* URL including the fragment can decrypt the file (until it expires or, for a one-time link, until it is consumed). There is no additional identity check on the holder of the fragment. Treat a full share link like a password.

**⚠ The one deliberate exception — `email_link`.** If you call `email_link` (MCP tool `apps/mcp/src/tools/emailLink.ts`, CLI `apps/cli/src/commands/email.ts`), the client **sends the full link, fragment and all, to the server** (`POST /:id/email`), and the server puts that link into the email body and delivers it over SMTP. **Confirmed in code**, and documented in-repo as an intentional relaxation. In that one flow:
- the key **passes through the app server's memory** and the outbound **SMTP relay**, and lands in the recipient's mailbox **in cleartext**;
- it is **never written to the database and never logged** (the server holds it only for the duration of the send);
- **no other flow does this** — every normal send/download keeps the key strictly on the endpoints.

If your threat model does not allow the operator or a mail provider to momentarily hold the key, **do not use `email_link`; hand the recipient the link over a channel you trust, or use a password-protected link (the password is never in the email).** A fully-E2EE email path is backlogged, not implemented.

**Other leakage vectors to be aware of (the real risks of this channel):**
- **Agent transcripts / LLM logs.** YAFL is agent-first: the full link (including the key) can land in agent conversation history, tool-call logs, and third-party LLM provider logs. This is the most likely real-world leak for the intended use case.
- **Shell history, terminal scrollback, and CI logs** when links are passed on the command line via `@yafldev/cli`.
- **Browser history and open-tab state** on the recipient's machine if the link is opened in a browser.
- **Copy/paste into chat apps, tickets, or docs**, which may be indexed, logged, or retained.
- **Third-party scripts on the web download page.** If a link is opened in a browser, any script on the download page can read `location.hash`. **Status (2026-08-01):** the client packages *in this repo* parse the fragment locally and never transmit it. The web download page is the **closed frontend, out of this repo's scope**; as of 2026-08-01 its analytics is configured to strip the URL fragment (`discardHashTag`) so the key is not sent to the analytics server. If you self-host or fork the frontend, keep the fragment out of any analytics/telemetry.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | The link **id** (non-fragment path); on a normal flow it never receives the fragment. **Via `email_link` only**, it momentarily holds the full link (with key) to send the email | The `#fragment` key on any non-email flow — not sent, not logged, not stored |
| B — storage | Object identifiers/paths only | The `#fragment` key — never reaches storage |
| C — stolen API key | Can list its own transfers' ids/metadata | The `#fragment` keys for those transfers — not stored server-side, so a stolen key alone cannot reconstruct downloadable links |

---

### 3. IV / nonce handling

AES-256-GCM requires a **unique nonce per encryption under a given key**. Because YAFL uses a **fresh key per file**, a single file encrypted once under its own key avoids cross-file nonce-reuse concerns entirely.

**Confirmed in code** (`packages/crypto/src/aesGcm.ts:34`): `encryptBytes` generates a **fresh 12-byte (96-bit) IV** via `crypto.getRandomValues` **inside** the function on every call — the IV is never accepted as a parameter (threading one in is exactly the nonce-reuse bug the module refuses to allow). The IV is prepended to the ciphertext (`iv‖ciphertext`) so `decryptBytes` recovers it without a side channel. The metadata blob (§5) gets its own independent IV from its own `encryptBytes` call.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | Never sees plaintext or keys; nonce handling is client-side | Exploit nonce reuse (no key access) |
| B — storage | The nonce/IV, prepended to the ciphertext (standard) | Decrypt — the nonce is not secret; the key is what's missing |
| C — stolen API key | Metadata only | Anything requiring the key |

---

### 4. Chunking

**Confirmed in code:** files are encrypted as a **single AES-GCM operation over the whole file** — not streamed or chunked. `uploadEncrypted` reads the file (or the client-side zip) fully into memory and calls `encryptBytes(key, bytes)` once (`packages/client/src/transferPipeline.ts:86`). The free tier is **100 MB per file**, which keeps single-shot buffering practical.

Because there is a single GCM operation per file, the chunk-reordering / duplication / truncation concerns of a chunked AEAD **do not apply**: the whole ciphertext authenticates as one unit, and any modification anywhere fails the single GCM tag on decrypt.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | The stored object's size | Plaintext |
| B — storage | The single ciphertext blob and its size | Forge or alter it undetectably (the single GCM tag fails on decrypt) |
| C — stolen API key | Metadata only | Plaintext |

*(If a future release introduces chunked/streamed encryption for larger files, this section must be revisited to specify the per-chunk nonce scheme and how reordering/truncation are bound into the AAD.)*

---

### 5. Metadata leakage (filenames, sizes, timing)

End-to-end encryption protects **contents**, not necessarily all **metadata**. Confirmed positions:

- **Filenames / content types are encrypted.** `encryptMeta` puts `{name, type}` into its own opaque AES-GCM blob under the file key, with its own IV (`packages/crypto/src/metadata.ts`). The server stores it only as the opaque `encryptedMeta` column — **there is no plaintext filename or content-type column** in the transfers table (`apps/server` schema). For a directory, inner names live inside the client-side zip, so they are inside the ciphertext too.
- **Sizes are not hidden.** No length-hiding padding is applied: ciphertext = 12-byte IV + plaintext + 16-byte GCM tag, so ciphertext ≈ plaintext + 28 bytes. Both the app server (`size` column) and storage can observe the **approximate file size**.
- **R2 object keys are opaque.** The storage object key is a separate random `nanoid()`, generated independently of the public transfer id and **never derived from the filename** (confirmed in `apps/server` transfer-create + schema). So the object key leaks nothing about the content.
- **Timing & ownership.** Upload/download timestamps, TTL, and access events are visible to the app server (and upload/access timing to storage). Combined with the owning account/API key, this reveals *who transferred something, when, and roughly how big*.
- **Recipient addresses.** `email_link` passes a recipient address to the server so it can send the mail. **It is not persisted** on the transfer row; it appears only transiently in the send path and in an in-memory rate-limit bucket.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | Transfer ids, timestamps, TTL, approximate sizes, owning account, one-time flag/consumed state; a recipient address transiently during an `email_link` send | File contents; the decryption key (except a link given to `email_link`); the filename/content-type (encrypted); the password layer |
| B — storage | Ciphertext blobs, their approximate sizes, opaque object keys, upload & access timing | File contents; keys; filenames |
| C — stolen API key | Metadata for **that key's own** transfers via `list_files` / `get_status` (ids, sizes, timestamps, TTL) | Metadata for other keys' transfers; any file contents; filenames |

---

### 6. Auth boundaries

YAFL uses **two different authorization models on purpose**, one for each direction of a transfer:

- **Uploads / sends are authenticated.** Creating a transfer (`upload_file`) and the management/send operations — `list_files`, `get_status`, `delete_file`, `email_link` — **require an API key** (obtained via the RFC 8628 device flow). Uploads are **not anonymous**. The API key scopes these operations to **that key's own transfers** and only ever exposes **ciphertext metadata** — it does **not** decrypt anything.
- **Downloads are capability-based.** A recipient needs **no account and no API key**. Authorization to download and decrypt is **possession of the share link plus its URL-fragment key**: the link id grants the ciphertext fetch, and the `#fragment` is the **decryption capability**. This is why the full link must be treated as a secret (§2).
- **API key ≠ decryption key.** The two models never cross: the API key gates *creating and managing* transfers and only ever sees ciphertext metadata; the fragment key is the *download/decrypt* capability and (outside `email_link`) never reaches a server. A holder of one cannot obtain the other.
- **Device flow, per-agent keys.** Each agent obtains its **own** named, individually revocable key (the agent displays a code, a human approves it in a browser). **Confirmed:** the device-flow success response returns a durable `api_key` (`packages/client/src/deviceFlow.ts`) — this is a long-lived, revocable API key, **not** a short-lived/rotating access token. The device-flow `expires_in` bounds the *approval window* of the pending code, not the minted key. The key's lifecycle is **manual revocation** (revoke the key and it is dead on the next request), not expiry/rotation. Recommended posture: **one key per agent, per machine.**
- **On-disk credentials.** The client stores the API key at `~/.config/yafl/config.json` (overridable via `YAFL_CONFIG_DIR` / `XDG_CONFIG_HOME`), written with **mode 0600** (owner read/write only) — `packages/client/src/credentialStore.ts:47`. A `YAFL_API_KEY` env var, if set, takes precedence over the file (for CI/VPS injection). Note: an already-existing file with looser permissions is not re-hardened; a fresh login recreates it at 0600.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | Enforce/observe which API key owns which transfer; issue pre-signed URLs (and thus fetch **ciphertext**) | Read plaintext; obtain any decryption key (outside `email_link`) |
| B — storage | Serve/accept ciphertext for valid pre-signed URLs | Read plaintext; authenticate as a user |
| C — stolen API key | Act as that agent: list/status/delete its transfers, upload new transfers, email links it already holds | Decrypt that agent's existing transfers' contents (fragments aren't stored); touch other agents' transfers. **Mitigation: revoke the key** |

---

### 7. Optional link password (second factor)

An optional **link password** means the link fragment alone is not sufficient to decrypt — the correct password is also required. This is the mitigation for fragment leakage: a link that leaks *without* its password does not yield plaintext.

**Confirmed construction** (`packages/crypto/src/deriveKey.ts`, `fragment.ts`, `packages/client/src/passwordKey.ts`):
- KDF: **PBKDF2-SHA256** (chosen for native `crypto.subtle` support in both Node and browsers — no non-native Argon2 dependency), at **600,000 iterations** (the OWASP 2023 floor), single-sourced as `PBKDF2_ITERATIONS`.
- Salt: a fresh **256-bit** random value (`crypto.getRandomValues`), carried in the URL fragment as a `"2."`-prefixed base64url string — so the fragment holds the **salt, not the key**.
- Composition: the PBKDF2 output **is** the AES-256 file key (32 bytes). There is no separate random file key being "wrapped" — for a v2 link the file is encrypted directly under the password-derived key, and the recipient re-derives that key from `fragment salt + password`. The password is never sent to the API, placed in the URL, or logged. Because the salt is a full 256-bit secret in the fragment, the derived key's strength does not rest solely on password entropy; the password is a **required second factor** on top of the salt.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | Nothing about the password — it is never sent to the server | Decrypt, even holding the ciphertext |
| B — storage | Ciphertext only | Decrypt |
| C — stolen API key | Metadata only | Derive or recover the password / the derived key |

---

### 8. Replay & expiry behaviour

- **24-hour access cutoff**, checked on every resolve before any storage is touched (the app returns `410` once expired); storage lifecycle cleanup is a backstop.
- **Pre-signed URLs are short-lived and independent of the 24-hour TTL.** **Confirmed** (`apps/server/src/lib/r2.ts`): upload PUT pre-signs for **900 s (15 min)**, download GET for **300 s (5 min)**. These bound the storage-layer replay window regardless of the link's own 24-hour lifetime.
- **One-time links** self-destruct on the **first successful download-authorization**. **Confirmed atomic** (`apps/server/src/lib/oneTimeConsume.ts`): the burn is a single conditional `UPDATE transfers SET consumed_at=… WHERE id=? AND status='uploaded' AND one_time=1 AND consumed_at IS NULL RETURNING …`, so under two racing downloads exactly one UPDATE matches a row; the loser's WHERE no longer matches and it gets a `410`. The burn triggers on `POST /:id/download` (which mints the pre-signed URL), **not** on link resolution — and the client verifies the key by decrypting metadata *first* (`packages/client/src/transferPipeline.ts:152`), so a **wrong key/password can never burn** a one-time link.
- **Tamper/replay of ciphertext.** AES-GCM is authenticated: any modification of the ciphertext by a compromised storage bucket is **detected on decrypt** (the tag fails) rather than silently returning corrupted plaintext.

| Adversary | CAN see / do | CANNOT see / do |
|---|---|---|
| A — app server | Deny access, alter TTL/metadata, delete transfers (availability/integrity of *service*) | Forge decryptable content; extend the confidentiality window (no key) |
| B — storage | Replay/serve stored ciphertext it holds until cleanup | Produce content that decrypts to attacker-chosen plaintext (GCM tag) |
| C — stolen API key | Delete its own transfers; re-download non-one-time links **it already has full URLs for** | Re-download links whose fragment it never had; bypass one-time burn |

---

## Out of scope

The following are explicitly **not** defended against by YAFL's design, and reports about them may be closed as out of scope (though we still want to hear about client bugs):

- **Compromise of your own endpoint.** If the machine running the client is compromised, plaintext, keys, and credentials are exposed *there*. E2EE cannot protect a compromised endpoint.
- **Malicious or careless recipient.** Anyone you share a link with can read and redistribute the file within its lifetime.
- **Link mishandling.** Leaking the full share link (with fragment) via chat, email, logs, agent transcripts, or history exposes the file. Keys are not escrowed — a *lost* link is unrecoverable.
- **The closed backend's internal security posture.** The app server, storage config, and infrastructure are closed source and out of this repository's scope. Users rely on the backend for **availability and metadata handling**, not for **confidentiality of contents** — which is exactly why contents are encrypted client-side.
- **The closed web frontend beyond the fragment-handling contract in §2.** The download page must keep the fragment out of analytics/telemetry (done as of 2026-08-01); its broader posture is out of this repo's scope.
- **Cryptanalysis of the primitives** (AES-256-GCM, PBKDF2-SHA256) and **quantum adversaries**.
- **Global traffic analysis** and network-level metadata correlation.
- **Denial of service / availability** attacks against YAFL services.
- **Social engineering and phishing** of users or operators.
- **Supply-chain compromise upstream of this repository** beyond our own release integrity. We do care about the integrity of our own published artifacts — report those.

---

## Hardening recommendations for users

- **One API key per agent, per machine.** Name them so a compromised host maps to a single, revocable key. Revoke immediately on suspicion.
- **Treat a full share link as a secret.** Prefer channels you trust. Remember that **`email_link` puts the key through the server and into an inbox** (§2) — prefer a password-protected link there, or hand the link over yourself. Redact fragments before pasting links into issues, logs, or chats.
- **Use one-time links** for single-recipient, single-use handoffs, and a **link password** for a factor the server never sees.
- **Rely on the 24-hour expiry**, and `delete_file` early when a transfer is done.
- **Keep the client updated** to receive security fixes (see Supported versions).

---

*This policy applies to the open-source YAFL MCP client (`@yafldev/mcp`) and CLI (`@yafldev/cli`) in this repository. The YAFL backend is closed source and outside its scope. Crypto claims verified against the client source on 2026-08-01; remaining `TODO(maintainer)` items are policy decisions only.*
