# KOD iOS architecture

## Runtime boundaries

KOD keeps the existing `Platform` abstraction. Platform-independent behavior
belongs in `src/shared` or the renderer packages. Native code is exposed through
narrow Capacitor plugins and must not expose a generic command bridge.

```text
React renderer
  -> MobilePlatform
     -> Capacitor plugins (auth, keychain, StoreKit, files, notifications)
  -> KOD API
     -> sync control plane
     -> encrypted secret vault
     -> task control plane
        -> isolated worker
```

## Authentication

The iOS flow mirrors the desktop product contract without copying Electron's
loopback server:

1. Fetch the public OIDC configuration from `/api/auth/kai/config`.
2. Create a random state and PKCE verifier/challenge on-device.
3. Open the authorization endpoint with `ASWebAuthenticationSession`.
4. Receive the allowlisted Universal Link callback.
5. Validate state and exchange the code using the verifier.
6. Exchange the KAI access token at `/api/auth/kai/exchange` for a normal KOD
   session.
7. Store refreshable credentials in Keychain, never localStorage.

The iOS client uses its own public client identifier (`kod-ios`). It must not
reuse the desktop client's loopback redirect or client identifier.

## Synchronization

Every synchronized record has an account ID, stable record ID, revision,
updated-at value, source device ID, and deletion tombstone. Mutations use an
idempotency key and are written to a local outbox before network delivery.

- Messages and task events are append-oriented.
- Settings use field-aware last-writer-wins rules.
- Deletes create tombstones so an offline device cannot resurrect data.
- A server cursor supports incremental pull and foreground reconciliation.
- Provider secrets are referenced by secret ID; they are not embedded in the
  ordinary settings payload.

## Cloud execution

The iOS renderer uses the existing sandbox tool names. `MobilePlatform`
implements those methods through the task control plane rather than returning
"not available". Each operation is bound to an account, task, workspace,
approval decision, idempotency key, resource policy, and audit event.

The worker API must support initialization, exec/read/write/edit/list/grep/find,
kill, reset, status, cancellation, and ordered event streaming. A worker never
receives unrestricted KOD account credentials.

## Commerce

The native StoreKit plugin returns verified, signed transaction material to the
renderer. The backend performs its own verification and idempotent ledger update.
The client never grants durable membership or credits based only on a local UI
success state.

