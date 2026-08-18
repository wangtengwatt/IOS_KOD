# KOD iOS delivery baseline

This directory is the source of truth for the KOD iOS port.

## Baseline

- Source workspace: `D:\watt\kod`
- Source commit: `5346c45e7f3ad1a42ebff0f02e8308193598c63e`
- Source branch at snapshot time: `suanlizhongxin_KOD`
- iOS workspace: `D:\watt\KOD-iOS`
- iOS branch: `feature/ios-capacitor`
- Runtime: Capacitor 7
- Deployment target: iOS 17
- Device families: iPhone and iPad
- Bundle identifier: `com.kai.kod`

The snapshot also includes the modified and untracked files that were present in
the source workspace when this repository was created. The original workspace is
not modified by iOS work.

## Delivery rules

1. User outcomes define parity. Electron, Android, and iOS implementation details
   do not need to match.
2. A feature may be shared, native, cloud-backed, or not applicable. It must not
   silently disappear.
3. Mobile UI work should reuse the renderer patterns in `D:\watt\kod-android`,
   but Android accessibility, overlay, and agent-service code must not be copied
   to iOS.
4. Desktop-only local execution is represented on iOS by an authenticated cloud
   task with equivalent approval, cancellation, streaming, and audit behavior.
5. Work is only considered complete after TypeScript tests and the macOS/Xcode
   build lane both pass.

## Documents

- [Functional parity matrix](./functional-parity.md)
- [Architecture](./architecture.md)
- [Release readiness](./release-readiness.md)
