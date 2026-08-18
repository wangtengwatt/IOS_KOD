import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

const release = process.argv.includes('--release')
const failures = []

function requireFile(path) {
  if (!existsSync(path)) failures.push(`missing ${path}`)
}

function requireText(path, value) {
  requireFile(path)
  if (existsSync(path) && !readFileSync(path, 'utf8').includes(value)) failures.push(`${path} is missing ${value}`)
}

function requireEnvironment(name, predicate = (value) => Boolean(value)) {
  if (!predicate(process.env[name] || '')) failures.push(`environment ${name} is missing or invalid`)
}

requireText('capacitor.config.ts', "appId: 'com.kai.kod'")
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
requireText('src/renderer/index.tsx', "CHATBOX_BUILD_PLATFORM !== 'ios'")
requireText('src/renderer/sync/engine.ts', 'uploadMutationMedia')
requireText('src/renderer/sync/engine.ts', 'downloadChangeMedia')
requireText('src/renderer/packages/cloud_sandbox.ts', 'kod-cloud-sandbox-output')
requireFile('docs/ios/apple-app-site-association.json')
requireFile('LICENSE')

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
  requireEnvironment('KOD_PRIVACY_POLICY_URL', (value) => value.startsWith('https://'))
  requireEnvironment('KOD_APP_STORE_GPL_APPROVED', (value) => value === 'yes')
}

if (failures.length) {
  console.error(`iOS readiness check failed:\n- ${failures.join('\n- ')}`)
  process.exit(1)
}

console.log(`iOS ${release ? 'release' : 'source'} readiness check passed`)
