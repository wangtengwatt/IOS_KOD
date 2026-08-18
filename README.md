# KOD iOS

This repository owns only the iOS-native Capacitor 7 wrapper for KOD. Product
UI, shared logic, and mobile web bundles are built in the canonical KOD
repository. The exact upstream revision is pinned in
`kod-upstream.lock.json`.

## Local wrapper checks

Use Node.js 22 and pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile
pnpm test
KOD_UPSTREAM_DIR=/path/to/locked/kod pnpm sync:ios
pnpm verify:wrapper
pnpm verify:ios
```

`pnpm sync:ios` refuses an upstream checkout whose full Git commit does not
equal the lock, builds the canonical iOS web bundle, validates its manifest,
copies it into the ignored `www/` directory, and runs Capacitor sync.

The native project targets iOS 17 and both iPhone and iPad. KAI identity,
secure credential storage, StoreKit 2, and notification bridges are implemented
under `ios/App/App/`.

## Release boundary

Unsigned simulator builds run in `.github/workflows/ios.yml`. TestFlight upload
is manual and also requires an Apple Developer team, App Store Connect app and
API key, distribution certificate/profile, registered KAI iOS client, StoreKit
products, privacy-policy URL, and the documented GPL/App Store approval.

See `docs/ios/release-readiness.md` for the complete checklist. The preserved
pre-unification implementation is recoverable from Git tag
`archive-ios-full-source-20260818`.
