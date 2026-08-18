import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('KAI universal-link callback is consumed without forwarding OAuth secrets to Capacitor', async () => {
  const source = await readFile('ios/App/App/AppDelegate.swift', 'utf8')
  assert.match(source, /let handledKaiCallback[\s\S]*return handledKaiCallback \|\| ApplicationDelegateProxy/)
  assert.match(source, /capturePendingCallback\(url\)[\s\S]*handledKaiCallback = true/)
})

test('KAI callback rejects duplicate OAuth parameters without Dictionary traps', async () => {
  const source = await readFile('ios/App/App/KaiIdentityPlugin.swift', 'utf8')
  assert.doesNotMatch(source, /Dictionary\(uniqueKeysWithValues:/)
  assert.match(source, /duplicate OAuth callback parameter/)
  assert.match(source, /reservedAuthorizationParameters/)
  assert.doesNotMatch(source, /absoluteString\)/)
})

test('KAI PKCE state and cold-start callback are one-shot Keychain records with a five-minute TTL', async () => {
  const plugin = await readFile('ios/App/App/KaiIdentityPlugin.swift', 'utf8')
  const delegate = await readFile('ios/App/App/AppDelegate.swift', 'utf8')

  assert.match(plugin, /CAPPluginMethod\(name: "resumePendingLogin"/)
  assert.match(plugin, /kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly/)
  assert.match(plugin, /pending\.createdAt[\s\S]*300/)
  assert.match(plugin, /deletePendingLogin\(\)[\s\S]*deletePendingCallback\(\)/)
  assert.match(delegate, /KaiIdentityPlugin\.capturePendingCallback/)
})
