# iOS release readiness

`pnpm run mobile:verify:ios` validates the source layout on any development
machine. `pnpm run mobile:verify:ios:release` is deliberately stricter and must
run in the protected TestFlight CI environment.

## External prerequisites

The following cannot be generated from source code:

- Apple Developer Program organization/team and App Store Connect app record
- App Store distribution certificate and matching provisioning profile
- App Store Connect API key with upload access
- registered KAI public OIDC client `kod-ios`
- associated-domains file deployed at
  `https://kod.kai.com/.well-known/apple-app-site-association`
  with both `applinks` and `webcredentials` entries for the production Team ID
- StoreKit subscription and consumable Product IDs
- public privacy policy and completed App Privacy answers
- written legal approval for distributing this GPLv3 derivative through the
  App Store under Apple's current terms

The protected `app-store-production` GitHub environment must define the secrets
and variables referenced by `.github/workflows/ios.yml`. The workflow first
builds an unsigned simulator app, then imports signing material only inside the
manual TestFlight job.

Before any public release, rotate every database, Redis, JWT, mail, payment, or
provider credential that has ever appeared in a tracked example or Git history.
Replacing the visible sample with placeholders does not revoke an exposed
credential. Keep production values only in the deployment secret manager and
run a repository secret scan before publishing.

## Backend StoreKit configuration

StoreKit durable rights are disabled until the backend has all of the following:

```yaml
kod:
  storekit:
    enabled: true
    bundle-id: com.kai.kod
    app-apple-id: 1234567890
    root-certificate-paths:
      - /run/secrets/AppleRootCA-G3.cer
    subscription-product-ids:
      - com.kai.kod.pro.monthly
    consumable-credits:
      com.kai.kod.credits.100: 100
```

Download Apple roots from the Apple PKI site; do not fetch or trust roots from
an arbitrary mirror. Configure App Store Server Notifications V2 to POST to
`/api/storekit/notifications/v2`.

`KOD_STOREKIT_ALLOW_XCODE_TRANSACTIONS` is only for an isolated test backend and
must stay false in production.

## Cross-device media storage

Image/video keys in synchronized chats and generation history are backed by a
private S3-compatible bucket. Configure `KOD_MEDIA_STORAGE_ENABLED=true`, an
HTTPS endpoint (or the AWS default endpoint), region, private bucket, and
credentials supplied through the deployment secret manager. The backend
enforces MIME allowlists, 128 MiB per-object and 5 GiB per-user defaults, and
server-side encryption. Account deletion marks objects for retryable purge.

The iOS build deliberately does not load the inherited Chatbox Google,
Plausible, or Sentry destinations. Do not re-enable telemetry until KOD owns the
processors, obtains consent, and updates both `PrivacyInfo.xcprivacy` and App
Store Connect privacy answers. The manifest declares account identifiers,
user content, photos/videos, searches, purchases, and linked product usage used
for app functionality; the archived Xcode privacy report remains the final
source for required-reason API reconciliation.

## Manual acceptance still required

- KAI login, logout, token refresh, and account deletion on iPhone and iPad
- Universal Link from Mail/Safari when the app is installed and not running
- StoreKit purchase, Ask to Buy/pending, cancellation, restore, renewal, refund,
  duplicate delivery, and offline retry
- background reminder delivery with permissions granted/denied
- document picker uploads for TXT, Markdown, PDF, DOCX, CSV, and an invalid file
- cloud task cancellation, timeout, offline reconnect, and worker loss
- dynamic type, VoiceOver, dark mode, rotation, split view, and keyboard overlap
- deletion/export/privacy flows for synchronized user content
- upload on one device and offline download/cache of chat, generated image, and
  generated video media on a second device
- account deletion with a password account and a KAI-only account, including
  confirmation that worker volumes transition from purge-pending to complete

Passing CI without these external tests is a source milestone, not TestFlight
readiness.
