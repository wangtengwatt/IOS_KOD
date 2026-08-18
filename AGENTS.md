# KOD iOS thin-wrapper guidance

This repository owns the iOS-native Capacitor 7 shell only. Canonical product
UI, shared renderer logic, tests, and mobile web bundle live in the sibling KOD
repository and are pinned by `kod-upstream.lock.json`. Never add a duplicate
`src/` tree here.

## Supported workflow

- Use Node 22 and pnpm 10.
- Install with `pnpm install --frozen-lockfile`.
- Run wrapper tests with `pnpm test`.
- Pin only through canonical KOD's `pnpm parity:pin-lock --target <wrapper> --release-train <id>` command.
- Generate ignored `www/` and native Capacitor registration with `pnpm sync:ios`.
- Validate with `pnpm verify:wrapper` and `pnpm verify:ios`.
- Run `pnpm verify:ios:release` only when the documented Apple/KAI/StoreKit release secrets are available.

## Ownership and safety

Retain `ios/`, custom Swift plugins, Capacitor config, release scripts, docs,
license, and wrapper CI. Generated `www/`, `ios/App/App/public/`, and generated
Capacitor config are ignored and must not be committed. Do not alter or recreate
the immutable archive tag `archive-ios-full-source-20260818`; it is the recovery
point for the pre-unification product tree.

The wrapper targets iOS 17 and device families 1,2. Preserve custom KAI identity,
secure storage, StoreKit 2, and notification registration in
`BridgeViewController.swift`. Every renderer-required Capacitor plugin must be a
runtime dependency here and must appear in the generated Podfile/plugin list.

Do not claim simulator, signing, archive, or TestFlight evidence from Windows.
Those checks require macOS/Xcode, an Apple Developer team, certificates,
provisioning, App Store Connect credentials, registered KAI client settings, and
configured StoreKit products.
