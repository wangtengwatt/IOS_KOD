# iOS functional parity matrix

Status values:

- `shared`: existing renderer/shared implementation is reused.
- `native`: implemented by an iOS Capacitor plugin or Apple framework.
- `cloud`: implemented by the authenticated KOD backend and an isolated worker.
- `hybrid`: combines shared UI with native or cloud behavior.
- `not-applicable`: desktop window-management behavior with an explicit iOS
  replacement or explanation.

No row may be marked complete without automated tests and a recorded manual test
on an iPhone or iPad simulator/device where applicable.

| Capability | Desktop/current behavior | iOS target | Status |
| --- | --- | --- | --- |
| Chat sessions and streaming | Local session storage and direct/provider calls | Shared renderer, mobile SQLite cache, sync outbox | shared |
| Provider/model selection | KOD AI and user-configured providers | Same providers; device-direct calls remain available | shared |
| KOD email login | KOD backend email flow | Existing responsive flow | shared |
| KAI unified login | Electron browser + loopback callback + PKCE | `ASWebAuthenticationSession` HTTPS callback on iOS 17.4+, secure Universal Link/Safari fallback on iOS 17.0–17.3, S256 PKCE | native |
| Token protection | Desktop application storage | Keychain-backed secret storage | native |
| Cross-device sessions | Local-only primary data | Versioned server sync with offline reconciliation | hybrid |
| Task history | Local task SQLite/IndexedDB | Versioned server sync with offline reconciliation | hybrid |
| Image generation history | Local SQLite/IndexedDB | Local cache plus authenticated private object sync | hybrid |
| Model and skill settings | Local platform storage | Server sync; secrets stored in a separate encrypted vault | hybrid |
| Image generation | KOD/provider APIs | Shared UI and API calls; iOS photo import/share | hybrid |
| Video generation | KOD/provider APIs | Shared mobile UI and API calls | shared |
| Copilots | Renderer routes and remote catalog | Reuse responsive renderer routes | shared |
| Compute center | Renderer route and KOD backend | Reuse responsive renderer; iOS purchasing uses IAP | hybrid |
| Web search | Built-in and user providers | Capacitor HTTP/direct provider request | shared |
| File attachment | Desktop path/file APIs | Document picker, Photos picker, security-scoped copies | native |
| File parsing | Desktop local parser or remote parser | Safe formats locally; complex parsing through KOD service | hybrid |
| Knowledge base/RAG | Electron main-process services | Authenticated cloud upload, Tika parsing, chunks and search | cloud |
| HTTP/SSE MCP | Renderer network transport | Direct network transport where allowed | shared |
| stdio MCP | Electron child process | Cloud MCP runner with the same tool-call contract | cloud |
| Agent skills | Main-process discovery/install/load | Synced metadata; installation and execution in cloud worker | cloud |
| Task sandbox | Electron main-process sandbox | Authenticated cloud workspace and isolated worker | cloud |
| Task approvals | In-app tool approval | Same approval UI bound to immutable operation IDs | hybrid |
| Task cancellation/streaming | IPC and local process control | Persistent task state plus bounded stdout/stderr SSE chunks and cancellation API | cloud |
| Import/export | Desktop file dialogs | UIDocumentPicker and share sheet | native |
| Notifications/reminders | Electron/system notifications | iOS local notifications with explicit permission and OS scheduling | native |
| Deep links | Desktop custom protocol | Universal Links with allowlisted routes | native |
| Subscription purchase | Existing web/payment flows | StoreKit 2 auto-renewable subscriptions | native |
| Compute/credit purchase | Existing wallet/payment flows | StoreKit 2 consumables and server ledger reconciliation | native |
| Restore purchases | Platform-specific existing state | StoreKit current entitlements and backend reconciliation | native |
| Auto-update | Electron updater | App Store/TestFlight update flow | not-applicable |
| Tray/global hotkeys | Electron OS integration | Notification, Widget, Shortcut, or in-app entry | not-applicable |
| Android overlay/accessibility agent | Android-only service | No direct port; task actions use app UI/cloud approvals | not-applicable |
| Account deletion | KOD account API | In-app deletion, immediate JWT tombstone, content/vault purge, and asynchronous sandbox-volume purge | hybrid |

## Release blockers

- Apple Developer Program team and App Store Connect application record.
- Registered `kod-ios` public OIDC client and Universal Link association file.
- StoreKit product identifiers and App Store server credentials.
- macOS/Xcode CI runner and protected signing configuration.
- Privacy, data-retention, account-deletion, and China storefront compliance review.
- Legal approval for App Store distribution of the GPLv3 derivative work.

## Known implementation limits

- Cloud knowledge-base search currently uses bounded lexical ranking. The API
  boundary is ready for an H100 embedding/rerank service, but vector retrieval
  is not yet wired and the UI must not describe the current result as semantic.
- Image/video and chat media payloads use authenticated object upload/download
  around the versioned record exchange. Production requires a private
  S3-compatible bucket with encryption and lifecycle/backup policies.
- HTTP/SSE MCP works in the shared renderer. stdio MCP and skill installation
  still require a managed cloud runner; the settings must not imply that those
  two paths are complete.
- Worker workspaces currently use operator-provided node-local encrypted-at-rest
  storage. The scheduler detects worker loss and prevents silent cross-node
  recreation, but automatic migration requires a shared encrypted volume layer.
  Account purge remains pending until the owning node returns.
- The iOS 17.0–17.3 KAI login fallback opens Safari and resumes through the
  verified Universal Link. The iOS 17.4+ path uses Apple's native HTTPS
  `ASWebAuthenticationSession.Callback` matcher.
- A Windows host cannot compile Swift, run an iOS simulator, sign an archive, or
  submit TestFlight. The macOS CI lane is the authoritative native build gate.
