import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  gitAuthenticationEnvironment,
  managedDependencyInstallPolicy,
  runCommand,
  safeReplaceWebRoot,
  scrubNonGitEnvironment,
  recoverWebRootBackup,
  validateNativePluginOwnership,
  validateManifest,
  verifyBundleTree,
} from './sync-upstream.mjs'
import * as syncUpstream from './sync-upstream.mjs'

const commit = '4'.repeat(40)
const lock = {
  schemaVersion: 1,
  repository: 'https://gitlab.kaiweb.org/KAI/oD/KoD/kod.git',
  commit,
  releaseTrain: 'kod-2026.08.18.1',
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const manifestFor = (files) => ({
  schemaVersion: 1,
  product: 'KOD',
  platform: 'ios',
  sourceCommit: commit,
  sourceVersion: '0.0.1',
  files,
  nativePlugins: [],
  rendererSha256: sha256(files.map((file) => `${file.path}\0${file.bytes}\0${file.sha256}\n`).join('')),
})
const file = (path, contents) => ({ path, bytes: Buffer.byteLength(contents), sha256: sha256(contents) })

const iosPluginContract = [
  ['@capacitor-community/sqlite', '7.0.3', 'CapacitorCommunitySqlite', 'CapacitorSQLitePlugin'],
  ['@capacitor/app', '7.1.2', 'CapacitorApp', 'AppPlugin'],
  ['@capacitor/app-launcher', '7.0.4', 'CapacitorAppLauncher', 'AppLauncherPlugin'],
  ['@capacitor/browser', '7.0.5', 'CapacitorBrowser', 'CAPBrowserPlugin'],
  ['@capacitor/device', '7.0.5', 'CapacitorDevice', 'DevicePlugin'],
  ['@capacitor/filesystem', '7.1.6', 'CapacitorFilesystem', 'FilesystemPlugin'],
  ['@capacitor/keyboard', '7.0.6', 'CapacitorKeyboard', 'KeyboardPlugin'],
  ['@capacitor/share', '7.0.4', 'CapacitorShare', 'SharePlugin'],
  ['@capacitor/splash-screen', '7.0.5', 'CapacitorSplashScreen', 'SplashScreenPlugin'],
  ['@capacitor/toast', '7.0.4', 'CapacitorToast', 'ToastPlugin'],
  ['capacitor-plugin-safe-area', '4.0.3', 'CapacitorPluginSafeArea', 'SafeAreaPlugin'],
  ['capacitor-stream-http', '0.1.0', 'CapacitorStreamHttp', 'StreamHttpPlugin'],
]

const validIosPluginFixture = () => ({
  manifest: { ...manifestFor([]), nativePlugins: iosPluginContract.map(([packageName]) => packageName) },
  packageJson: {
    dependencies: Object.fromEntries(iosPluginContract.map(([packageName, version]) => [packageName, version])),
  },
  podfile: iosPluginContract
    .map(([packageName, , podName]) => `pod '${podName}', :path => '../../node_modules/${packageName}'`)
    .join('\n'),
  nativeConfig: { packageClassList: iosPluginContract.map(([, , , className]) => className) },
  bridgeSource: [
    'bridge?.registerPluginInstance(KaiIdentityPlugin())',
    'bridge?.registerPluginInstance(SecureStoragePlugin())',
    'bridge?.registerPluginInstance(StoreKitPlugin())',
    'bridge?.registerPluginInstance(NotificationPlugin())',
  ].join('\n'),
})

test('manifest rejects traversal, absolute, backslash, duplicate, and unsorted paths', () => {
  for (const badPath of ['../x', 'a/../x', '/x', 'C:/x', 'a\\x', './x', 'a//x']) {
    const files = [file(badPath, 'x')]
    assert.throws(() => validateManifest(lock, manifestFor(files)), /path/i)
  }
  const duplicate = [file('a.js', 'a'), file('a.js', 'a')]
  assert.throws(() => validateManifest(lock, manifestFor(duplicate)), /sorted|duplicate/i)
  const unsorted = [file('z.js', 'z'), file('a.js', 'a')]
  assert.throws(() => validateManifest(lock, manifestFor(unsorted)), /sorted/i)
})

test('bundle verification rejects tampered, extra, and missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kod-ios-integrity-'))
  await writeFile(join(root, 'a.js'), 'a')
  const manifest = manifestFor([file('a.js', 'a')])
  await writeFile(join(root, 'kod-build-manifest.json'), JSON.stringify(manifest))
  await verifyBundleTree(root, manifest)

  await writeFile(join(root, 'a.js'), 'tampered')
  await assert.rejects(verifyBundleTree(root, manifest), /byte|sha-?256/i)
  await writeFile(join(root, 'a.js'), 'a')
  await writeFile(join(root, 'extra.js'), 'extra')
  await assert.rejects(verifyBundleTree(root, manifest), /extra|unexpected/i)
  await rm(join(root, 'extra.js'))
  await rm(join(root, 'a.js'))
  await assert.rejects(verifyBundleTree(root, manifest), /missing/i)
})

test('bundle verification rejects symbolic links or Windows junctions', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kod-ios-symlink-'))
  const external = await mkdtemp(join(tmpdir(), 'kod-ios-external-'))
  await writeFile(join(external, 'a.js'), 'a')
  try {
    await symlink(external, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`)
    return
  }
  await assert.rejects(verifyBundleTree(root, manifestFor([])), /symbolic link|junction/i)
})

test('replacement rejects a symlinked or junction www target', async (t) => {
  const wrapper = await mkdtemp(join(tmpdir(), 'kod-ios-wrapper-link-'))
  const external = await mkdtemp(join(tmpdir(), 'kod-ios-www-external-'))
  const source = await mkdtemp(join(tmpdir(), 'kod-ios-source-link-'))
  const manifest = manifestFor([file('a.js', 'a')])
  await writeFile(join(source, 'a.js'), 'a')
  await writeFile(join(source, 'kod-build-manifest.json'), JSON.stringify(manifest))
  try {
    await symlink(external, join(wrapper, 'www'), process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    t.skip(`symlink creation unavailable: ${error.code || error.message}`)
    return
  }
  await assert.rejects(safeReplaceWebRoot(source, wrapper, manifest), /symbolic link|junction/i)
})

test('replacement verifies the temporary copy before safely swapping www', async () => {
  const wrapper = await mkdtemp(join(tmpdir(), 'kod-ios-wrapper-'))
  const source = await mkdtemp(join(tmpdir(), 'kod-ios-source-'))
  await mkdir(join(wrapper, 'www'))
  await writeFile(join(wrapper, 'www', 'stale.js'), 'stale')
  await writeFile(join(source, 'a.js'), 'a')
  const manifest = manifestFor([file('a.js', 'a')])
  await writeFile(join(source, 'kod-build-manifest.json'), JSON.stringify(manifest))

  await safeReplaceWebRoot(source, wrapper, manifest)

  assert.equal(await readFile(join(wrapper, 'www', 'a.js'), 'utf8'), 'a')
  await assert.rejects(readFile(join(wrapper, 'www', 'stale.js')), /ENOENT/)
})

test('protected upstream Git auth stays in child env and is redacted from diagnostics', () => {
  const token = 'kod-read-token-super-secret'
  const { env, secrets } = gitAuthenticationEnvironment(
    {
      PATH: 'safe',
      KOD_UPSTREAM_READ_TOKEN: token,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.attacker.invalid.extraheader',
      GIT_CONFIG_VALUE_0: 'unsafe',
    },
    token,
  )
  assert.equal(env.GIT_CONFIG_COUNT, '1')
  assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://gitlab.kaiweb.org/.extraheader')
  assert.ok(env.GIT_CONFIG_VALUE_0.includes(token))
  assert.equal(env.KOD_UPSTREAM_READ_TOKEN, undefined)
  assert.deepEqual(secrets, [token])
  assert.throws(
    () => runCommand(process.execPath, ['-e', `console.error('${token}'); process.exit(2)`], process.cwd(), env, secrets),
    (error) => !error.message.includes(token) && error.message.includes('[REDACTED]'),
  )
})

test('install, build, and Capacitor child fixtures never inherit upstream auth variables', () => {
  for (const child of ['install', 'build', 'cap']) {
    const clean = scrubNonGitEnvironment({
      PATH: `safe-${child}`,
      KOD_UPSTREAM_READ_TOKEN: 'secret',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.x.extraheader',
      GIT_CONFIG_VALUE_0: 'PRIVATE-TOKEN: secret',
    })
    assert.deepEqual(clean, { PATH: `safe-${child}` })
  }
})

test('Git authentication environment is available only to clone and fetch operations', () => {
  assert.equal(
    typeof syncUpstream.gitEnvironmentForOperation,
    'function',
    'sync-upstream must expose one operation-aware Git environment policy',
  )

  const baseEnvironment = {
    PATH: 'safe',
    KOD_UPSTREAM_READ_TOKEN: 'ambient-secret',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: 'attacker-hooks',
  }
  for (const operation of ['remote', 'checkout', 'rev-parse']) {
    const { env, secrets } = syncUpstream.gitEnvironmentForOperation(operation, baseEnvironment)
    assert.deepEqual(env, { PATH: 'safe' })
    assert.deepEqual(secrets, [])
  }
  assert.throws(
    () => syncUpstream.gitEnvironmentForOperation('checkout', baseEnvironment, 'explicit-secret'),
    /only.*clone.*fetch/i,
  )
  for (const operation of ['clone', 'fetch']) {
    const { env, secrets } = syncUpstream.gitEnvironmentForOperation(operation, baseEnvironment, 'explicit-secret')
    assert.equal(env.KOD_UPSTREAM_READ_TOKEN, undefined)
    assert.equal(env.GIT_CONFIG_COUNT, '1')
    assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://gitlab.kaiweb.org/.extraheader')
    assert.match(env.GIT_CONFIG_VALUE_0, /explicit-secret/)
    assert.deepEqual(secrets, ['explicit-secret'])
  }
})

test('checkout hooks cannot read an upstream token or injected Git config', async () => {
  assert.equal(typeof syncUpstream.runGit, 'function', 'sync-upstream must route Git through one scrubbed runner')
  const repository = await mkdtemp(join(tmpdir(), 'kod-ios-git-hook-'))
  const cleanEnvironment = scrubNonGitEnvironment(process.env)
  try {
    runCommand('git', ['init'], repository, cleanEnvironment)
    runCommand('git', ['config', 'user.email', 'wrapper-test@kaiweb.org'], repository, cleanEnvironment)
    runCommand('git', ['config', 'user.name', 'KOD Wrapper Test'], repository, cleanEnvironment)
    await writeFile(join(repository, 'tracked.txt'), 'safe\n')
    runCommand('git', ['add', 'tracked.txt'], repository, cleanEnvironment)
    runCommand('git', ['commit', '-m', 'fixture'], repository, cleanEnvironment)

    const hookPath = join(repository, '.git', 'hooks', 'post-checkout')
    await writeFile(
      hookPath,
      [
        '#!/bin/sh',
        'printf \'%s|%s|%s|%s\' "$KOD_UPSTREAM_READ_TOKEN" "$GIT_CONFIG_COUNT" "$GIT_CONFIG_KEY_0" "$GIT_CONFIG_VALUE_0" > checkout-hook-env.txt',
      ].join('\n'),
    )
    await chmod(hookPath, 0o755)

    syncUpstream.runGit(['checkout', '--detach', 'HEAD'], repository, {
      baseEnvironment: {
        ...process.env,
        KOD_UPSTREAM_READ_TOKEN: 'checkout-must-not-see-this',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.attacker.invalid.extraheader',
        GIT_CONFIG_VALUE_0: 'PRIVATE-TOKEN: checkout-must-not-see-this',
      },
    })

    assert.equal(await readFile(join(repository, 'checkout-hook-env.txt'), 'utf8'), '|||')
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

test('replacement recovers a sole crash backup when www is missing', async () => {
  const wrapper = await mkdtemp(join(tmpdir(), 'kod-ios-recover-'))
  const backup = join(wrapper, '.www-backup-crash')
  await mkdir(backup)
  await writeFile(join(backup, 'last-good.js'), 'ok')
  await recoverWebRootBackup(wrapper)
  assert.equal(await readFile(join(wrapper, 'www', 'last-good.js'), 'utf8'), 'ok')
  await assert.rejects(readFile(join(backup, 'last-good.js')), /ENOENT/)
})

test('managed upstream always performs a frozen install while configured local upstream may reuse dependencies', () => {
  assert.equal(managedDependencyInstallPolicy(true), 'frozen-install')
  assert.equal(managedDependencyInstallPolicy(false), 'reuse-configured-upstream')
})

test('canonical manifest drives wrapper dependency, Pod, and generated registration ownership', () => {
  const { manifest, packageJson, podfile, nativeConfig } = validIosPluginFixture()

  assert.doesNotThrow(() => validateNativePluginOwnership(manifest, packageJson, podfile, nativeConfig))
  assert.throws(
    () => validateNativePluginOwnership(manifest, { dependencies: {} }, podfile, nativeConfig),
    /missing canonical native plugin dependency/i,
  )
  assert.throws(
    () => validateNativePluginOwnership(manifest, packageJson, '', nativeConfig),
    /Podfile/i,
  )
  assert.throws(
    () => validateNativePluginOwnership(manifest, packageJson, podfile, { packageClassList: ['AppPlugin'] }),
    /registration/i,
  )
})

test('native plugin validation rejects a same-size registration list with the wrong class', () => {
  const fixture = validIosPluginFixture()
  fixture.nativeConfig.packageClassList[0] = 'WrongSQLitePlugin'

  assert.throws(
    () =>
      validateNativePluginOwnership(
        fixture.manifest,
        fixture.packageJson,
        fixture.podfile,
        fixture.nativeConfig,
      ),
    /class|registration/i,
  )
})

test('native plugin validation requires the exact canonical iOS package set', () => {
  const missing = validIosPluginFixture()
  missing.manifest.nativePlugins = missing.manifest.nativePlugins.slice(1)
  missing.nativeConfig.packageClassList = missing.nativeConfig.packageClassList.slice(1)

  assert.throws(
    () =>
      validateNativePluginOwnership(
        missing.manifest,
        missing.packageJson,
        missing.podfile,
        missing.nativeConfig,
      ),
    /package|contract/i,
  )
})

test('native plugin validation rejects a dependency version that drifts from the iOS contract', () => {
  const fixture = validIosPluginFixture()
  fixture.packageJson.dependencies['@capacitor-community/sqlite'] = '7.0.4'

  assert.throws(
    () =>
      validateNativePluginOwnership(
        fixture.manifest,
        fixture.packageJson,
        fixture.podfile,
        fixture.nativeConfig,
      ),
    /version|7\.0\.3/i,
  )
})

test('native plugin validation does not accept a commented-out pseudo Pod declaration', () => {
  const fixture = validIosPluginFixture()
  fixture.podfile = fixture.podfile.replace(
    "pod 'CapacitorCommunitySqlite', :path => '../../node_modules/@capacitor-community/sqlite'",
    "# pod 'CapacitorCommunitySqlite', :path => '../../node_modules/@capacitor-community/sqlite'",
  )

  assert.throws(
    () =>
      validateNativePluginOwnership(
        fixture.manifest,
        fixture.packageJson,
        fixture.podfile,
        fixture.nativeConfig,
      ),
    /Podfile|Pod declaration/i,
  )
})

test('native plugin validation rejects a Pod path that resolves outside the wrapper', () => {
  const fixture = validIosPluginFixture()
  const wrapperRoot = join(tmpdir(), 'kod-ios-wrapper-contract')
  const podfilePath = join(wrapperRoot, 'ios', 'App', 'Podfile')
  fixture.podfile = fixture.podfile.replace(
    '../../node_modules/@capacitor-community/sqlite',
    '../../../canonical/node_modules/@capacitor-community/sqlite',
  )

  assert.throws(
    () =>
      validateNativePluginOwnership(
        fixture.manifest,
        fixture.packageJson,
        fixture.podfile,
        fixture.nativeConfig,
        { wrapperRoot, podfilePath },
      ),
    /outside|wrapper|path/i,
  )
})

test('native plugin validation requires exactly four real custom Swift registrations', () => {
  const fixture = validIosPluginFixture()
  const wrapperRoot = join(tmpdir(), 'kod-ios-wrapper-custom-plugin-contract')
  fixture.bridgeSource = fixture.bridgeSource.replace(
    'bridge?.registerPluginInstance(StoreKitPlugin())',
    '// bridge?.registerPluginInstance(StoreKitPlugin())',
  )

  assert.throws(
    () =>
      validateNativePluginOwnership(
        fixture.manifest,
        fixture.packageJson,
        fixture.podfile,
        fixture.nativeConfig,
        {
          wrapperRoot,
          podfilePath: join(wrapperRoot, 'ios', 'App', 'Podfile'),
          bridgeSource: fixture.bridgeSource,
        },
      ),
    /custom Swift|StoreKitPlugin|registration/i,
  )
})
