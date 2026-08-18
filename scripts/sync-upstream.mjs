import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const wrapperRoot = resolve(dirname(scriptPath), '..')
const manifestName = 'kod-build-manifest.json'
const pnpm = process.platform === 'win32' ? 'pnpm.CMD' : 'pnpm'

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

export function validateLock(value) {
  const lock = requireObject(value, 'upstream lock')
  if (lock.schemaVersion !== 1) throw new Error('upstream lock schemaVersion must be 1')

  let repository
  try {
    repository = new URL(lock.repository)
  } catch {
    throw new Error('upstream repository must be an HTTPS URL')
  }
  if (repository.protocol !== 'https:' || !repository.hostname) {
    throw new Error('upstream repository must be an HTTPS URL')
  }
  if (typeof lock.commit !== 'string' || !/^[a-f0-9]{40}$/.test(lock.commit)) {
    throw new Error('upstream commit must be a lowercase 40-character SHA-1')
  }
  if (typeof lock.releaseTrain !== 'string' || !/^kod-\d{4}\.\d{2}\.\d{2}\.\d+$/.test(lock.releaseTrain)) {
    throw new Error('releaseTrain must match kod-YYYY.MM.DD.N')
  }

  return {
    schemaVersion: 1,
    repository: repository.href,
    commit: lock.commit,
    releaseTrain: lock.releaseTrain,
  }
}

export function validateManifest(lockValue, value) {
  const lock = validateLock(lockValue)
  const manifest = requireObject(value, 'iOS build manifest')
  if (manifest.schemaVersion !== 1) throw new Error('manifest schemaVersion must be 1')
  if (manifest.product !== 'KOD') throw new Error('manifest product must be KOD')
  if (manifest.platform !== 'ios') throw new Error('manifest platform must be ios')
  if (manifest.sourceCommit !== lock.commit) throw new Error('manifest sourceCommit does not match lock commit')
  if (typeof manifest.sourceVersion !== 'string' || !manifest.sourceVersion) {
    throw new Error('manifest sourceVersion must be a non-empty string')
  }
  if (typeof manifest.rendererSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.rendererSha256)) {
    throw new Error('manifest rendererSha256 must be a lowercase SHA-256 digest')
  }
  if (!Array.isArray(manifest.files)) throw new Error('manifest files must be an array')
  for (const file of manifest.files) {
    requireObject(file, 'manifest file')
    if (typeof file.path !== 'string' || !file.path || file.path.includes('\\') || file.path.startsWith('/')) {
      throw new Error('manifest file path must be a non-empty relative POSIX path')
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) throw new Error('manifest file bytes must be non-negative')
    if (typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('manifest file sha256 must be a lowercase SHA-256 digest')
    }
  }
  return manifest
}

function runCommand(command, arguments_, cwd, env = process.env) {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    env,
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  })
  if (result.error || result.status !== 0) {
    const exitCode = result.status ?? 'spawn-error'
    const stdout = result.stdout || ''
    const stderr = result.stderr || result.error?.message || ''
    throw new Error(
      `command failed: ${command} ${arguments_.join(' ')}\nexit code: ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }
  return result.stdout.trim()
}

function runPnpm(arguments_, cwd, env = process.env) {
  if (process.platform === 'win32') {
    const corepack = resolve(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')
    if (existsSync(corepack)) return runCommand(process.execPath, [corepack, 'pnpm', ...arguments_], cwd, env)
  }
  return runCommand(pnpm, arguments_, cwd, env)
}

function upstreamBuildEnvironment(upstreamRoot) {
  if (process.platform !== 'win32') return process.env
  const preload = resolve(upstreamRoot, 'scripts', 'platform-release', 'test-support', 'windows-node-userinfo-shim.cjs')
  if (!existsSync(preload)) return process.env
  return {
    ...process.env,
    npm_config_node_options: `--max-old-space-size=4096 --require="${preload.replaceAll('\\', '/')}"`,
  }
}

function wrapperCommandEnvironment() {
  if (process.platform !== 'win32') return process.env
  const preload = resolve(wrapperRoot, 'scripts', 'windows-node-userinfo-shim.cjs')
  if (!existsSync(preload)) return process.env
  return {
    ...process.env,
    npm_config_node_options: `--require="${preload.replaceAll('\\', '/')}"`,
  }
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return false
    throw error
  }
}

async function prepareManagedUpstream(lock) {
  const cacheRoot = resolve(wrapperRoot, '.kod-upstream')
  const upstreamRoot = resolve(cacheRoot, 'kod')
  if (!(await exists(upstreamRoot))) {
    await mkdir(cacheRoot, { recursive: true })
    runCommand('git', ['clone', '--no-checkout', lock.repository, upstreamRoot], wrapperRoot)
  } else {
    const remote = runCommand('git', ['remote', 'get-url', 'origin'], upstreamRoot)
    if (remote !== lock.repository) throw new Error('cached upstream origin does not match lock repository')
  }

  runCommand('git', ['fetch', '--prune', 'origin', lock.commit], upstreamRoot)
  runCommand('git', ['checkout', '--detach', lock.commit], upstreamRoot)
  return upstreamRoot
}

async function assertExactHead(upstreamRoot, commit) {
  const requestedRoot = await realpath(resolve(upstreamRoot))
  const gitRoot = await realpath(resolve(runCommand('git', ['rev-parse', '--show-toplevel'], requestedRoot)))
  if (gitRoot !== requestedRoot) throw new Error('KOD upstream directory must be its Git top level')
  const head = runCommand('git', ['rev-parse', 'HEAD'], requestedRoot)
  if (head !== commit) throw new Error(`upstream HEAD does not match lock commit: expected ${commit}, received ${head}`)
  return requestedRoot
}

async function safeReplaceWebRoot(source) {
  const canonicalWrapperRoot = await realpath(wrapperRoot)
  const target = resolve(canonicalWrapperRoot, 'www')
  if (dirname(target) !== canonicalWrapperRoot) throw new Error('www target parent must equal wrapper root')

  if (await exists(target)) {
    const metadata = await lstat(target)
    if (metadata.isSymbolicLink()) throw new Error('refusing to replace a symbolic-link www target')
  }
  await rm(target, { recursive: true, force: true })
  await cp(source, target, { recursive: true })
}

async function main() {
  const lock = validateLock(JSON.parse(await readFile(resolve(wrapperRoot, 'kod-upstream.lock.json'), 'utf8')))
  const configuredUpstream = process.env.KOD_UPSTREAM_DIR
  const managed = !configuredUpstream
  const upstreamRoot = await assertExactHead(
    managed ? await prepareManagedUpstream(lock) : configuredUpstream,
    lock.commit,
  )

  if (managed && !(await exists(resolve(upstreamRoot, 'node_modules')))) {
    runPnpm(['install', '--frozen-lockfile'], upstreamRoot, upstreamBuildEnvironment(upstreamRoot))
  }
  runPnpm(['mobile:bundle:ios'], upstreamRoot, upstreamBuildEnvironment(upstreamRoot))

  const bundleRoot = resolve(upstreamRoot, 'release', 'mobile', 'ios', 'www')
  validateManifest(lock, JSON.parse(await readFile(resolve(bundleRoot, manifestName), 'utf8')))
  await safeReplaceWebRoot(bundleRoot)
  runPnpm(['exec', 'cap', 'sync', 'ios'], wrapperRoot, wrapperCommandEnvironment())
  console.log(`Synchronized iOS wrapper from KOD commit ${lock.commit}`)
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
