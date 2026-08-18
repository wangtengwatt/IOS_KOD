import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { validateLock, validateManifest } from './sync-upstream.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const release = process.argv.includes('--release')
const failures = []

function absolute(path) {
  return resolve(root, path)
}

function requireFile(path) {
  if (!existsSync(absolute(path))) {
    failures.push(`missing ${path}`)
    return false
  }
  return true
}

function requireText(path, value) {
  if (requireFile(path) && !readFileSync(absolute(path), 'utf8').includes(value)) {
    failures.push(`${path} is missing ${value}`)
  }
}

function requireEnvironment(name, predicate = (value) => Boolean(value)) {
  if (!predicate(process.env[name] || '')) failures.push(`environment ${name} is missing or invalid`)
}

requireText('capacitor.config.ts', "appId: 'com.kai.kod'")
requireText('capacitor.config.ts', "webDir: 'www'")
requireText('ios/App/App.xcodeproj/project.pbxproj', 'IPHONEOS_DEPLOYMENT_TARGET = 17.0;')
requireText('ios/App/App.xcodeproj/project.pbxproj', 'TARGETED_DEVICE_FAMILY = "1,2";')
for (const nativeSource of [
  'BridgeViewController.swift in Sources',
  'KaiIdentityPlugin.swift in Sources',
  'SecureStoragePlugin.swift in Sources',
  'StoreKitPlugin.swift in Sources',
  'NotificationPlugin.swift in Sources',
]) {
  requireText('ios/App/App.xcodeproj/project.pbxproj', nativeSource)
}
requireText('ios/App/App/App.entitlements', 'com.apple.developer.associated-domains')
requireText('ios/App/App/App.entitlements', 'applinks:kod.kai.com')
requireText('ios/App/App/App.entitlements', 'webcredentials:kod.kai.com')
requireText('ios/App/App/BridgeViewController.swift', 'registerPluginInstance(KaiIdentityPlugin())')
requireText('ios/App/App/BridgeViewController.swift', 'registerPluginInstance(SecureStoragePlugin())')
requireText('ios/App/App/BridgeViewController.swift', 'registerPluginInstance(StoreKitPlugin())')
requireText('ios/App/App/BridgeViewController.swift', 'registerPluginInstance(NotificationPlugin())')
requireText('ios/App/App/StoreKitPlugin.swift', 'import StoreKit')
requireText('ios/App/App.xcodeproj/project.pbxproj', 'PrivacyInfo.xcprivacy in Resources')
requireText('ios/App/App/PrivacyInfo.xcprivacy', 'NSPrivacyAccessedAPITypes')
requireText('ios/App/App/PrivacyInfo.xcprivacy', 'NSPrivacyCollectedDataTypeEmailAddress')
requireText('ios/App/App/PrivacyInfo.xcprivacy', 'NSPrivacyCollectedDataTypeOtherUserContent')
requireText('ios/App/App/PrivacyInfo.xcprivacy', 'NSPrivacyCollectedDataTypePhotosorVideos')
for (const nativeDependency of [
  '@capacitor-community/sqlite',
  '@capacitor/app',
  '@capacitor/app-launcher',
  '@capacitor/browser',
  '@capacitor/device',
  '@capacitor/filesystem',
  '@capacitor/keyboard',
  '@capacitor/share',
  '@capacitor/splash-screen',
  '@capacitor/toast',
  'capacitor-plugin-safe-area',
  'capacitor-stream-http',
]) {
  requireText('ios/App/Podfile', `node_modules/${nativeDependency}`)
}
for (const pluginClass of [
  'CapacitorSQLitePlugin',
  'AppPlugin',
  'AppLauncherPlugin',
  'CAPBrowserPlugin',
  'DevicePlugin',
  'FilesystemPlugin',
  'KeyboardPlugin',
  'SharePlugin',
  'SplashScreenPlugin',
  'ToastPlugin',
  'SafeAreaPlugin',
  'StreamHttpPlugin',
]) {
  requireText('ios/App/App/capacitor.config.json', pluginClass)
}
requireFile('docs/ios/apple-app-site-association.json')
requireFile('LICENSE')

try {
  const lock = validateLock(JSON.parse(readFileSync(absolute('kod-upstream.lock.json'), 'utf8')))
  const manifest = JSON.parse(readFileSync(absolute('www/kod-build-manifest.json'), 'utf8'))
  validateManifest(lock, manifest)
} catch (error) {
  failures.push(`upstream bundle is missing or invalid: ${error instanceof Error ? error.message : String(error)}`)
}

if (release) {
  requireEnvironment('APPLE_TEAM_ID', (value) => /^[A-Z0-9]{10}$/.test(value))
  requireEnvironment('ASC_KEY_ID')
  requireEnvironment('ASC_ISSUER_ID')
  requireEnvironment('APP_STORE_CONNECT_API_KEY_BASE64')
  requireEnvironment('IOS_DISTRIBUTION_CERTIFICATE_BASE64')
  requireEnvironment('IOS_DISTRIBUTION_CERTIFICATE_PASSWORD')
  requireEnvironment('IOS_PROVISIONING_PROFILE_BASE64')
  requireEnvironment('KOD_IDENTITY_IOS_CLIENT_ID')
  requireEnvironment('KOD_STOREKIT_PRODUCT_IDS')
  requireEnvironment('KOD_PRIVACY_POLICY_URL', (value) => {
    try {
      return new URL(value).protocol === 'https:'
    } catch {
      return false
    }
  })
  requireEnvironment('KOD_APP_STORE_GPL_APPROVED', (value) => value === 'yes')
}

if (failures.length) {
  console.error(`iOS readiness check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`iOS ${release ? 'release' : 'source'} readiness check passed`)
