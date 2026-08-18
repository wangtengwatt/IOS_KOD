import { authInfoStore } from '@/stores/authInfoStore'
import { KOD_API_ORIGIN, NODE_ENV, USE_LOCAL_API } from '@/variables'

type OperationKind = 'exec' | 'read' | 'write' | 'edit' | 'ls' | 'grep' | 'find' | 'reset'
type OperationState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

interface WorkspaceResponse {
  workspaceId: string
  state: string
}

interface OperationResponse {
  operationId: string
  state: OperationState
  result?: Record<string, unknown>
  error?: string
}

export interface CloudSandboxStreamEvent {
  id?: number
  operationId?: string
  type?: string
  payload?: { chunk?: string; [key: string]: unknown }
  createdAt?: number
}

export function parseSseBlock(block: string): CloudSandboxStreamEvent | null {
  let id: number | undefined
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('id:')) {
      const parsed = Number(line.slice(3).trim())
      if (Number.isSafeInteger(parsed) && parsed >= 0) id = parsed
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).trimStart())
    }
  }
  if (data.length === 0) return null
  try {
    const parsed = JSON.parse(data.join('\n')) as CloudSandboxStreamEvent
    return id === undefined ? parsed : { ...parsed, id }
  } catch {
    return null
  }
}

function apiOrigin(): string {
  return USE_LOCAL_API || NODE_ENV === 'development' ? 'http://localhost:8080' : KOD_API_ORIGIN
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = authInfoStore.getState().accessToken
  if (!token) throw new Error('请先登录 KOD 后再使用云端任务沙箱')
  const response = await fetch(`${apiOrigin()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const json = (await response.json()) as { code?: number; message?: string; data?: T }
  if (!response.ok || json.code !== 0 || json.data == null) {
    throw new Error(json.message || `云端任务服务 HTTP ${response.status}`)
  }
  return json.data
}

export class CloudSandboxClient {
  private workspaceId: string | null = null
  private activeOperationId: string | null = null
  private eventCursor = 0

  async initialize(workingDirectory: string) {
    const workspace = await request<WorkspaceResponse>('/api/cloud-sandbox/workspaces', {
      method: 'POST',
      body: JSON.stringify({ workingDirectory }),
    })
    this.workspaceId = workspace.workspaceId
    return { success: true as const }
  }

  async execute(command: string, timeout = 120_000) {
    const operation = await this.run('exec', { command, timeout }, timeout)
    return {
      stdout: String(operation.result?.stdout ?? ''),
      stderr: String(operation.result?.stderr ?? ''),
      exitCode: Number(operation.result?.exitCode ?? 1),
    }
  }

  async read(filePath: string) {
    try {
      const operation = await this.run('read', { filePath })
      return { success: true, content: String(operation.result?.content ?? '') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async write(filePath: string, content: string) {
    return this.successOperation('write', { filePath, content })
  }

  async edit(filePath: string, search: string, replace: string) {
    return this.successOperation('edit', { filePath, search, replace })
  }

  async list(dirPath: string) {
    return this.contentOperation('ls', { dirPath })
  }

  async grep(pattern: string, dirPath?: string, include?: string) {
    return this.contentOperation('grep', { pattern, dirPath, include })
  }

  async find(dirPath: string, pattern?: string) {
    return this.contentOperation('find', { dirPath, pattern })
  }

  async kill() {
    if (!this.workspaceId) return { killed: false }
    await request<{ killed: boolean }>(`/api/cloud-sandbox/workspaces/${encodeURIComponent(this.workspaceId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ operationId: this.activeOperationId }),
    })
    this.activeOperationId = null
    return { killed: true }
  }

  async reset() {
    try {
      await this.run('reset', {})
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async status() {
    if (!this.workspaceId) return { state: 'idle', workingDirectory: null, platform: 'cloud' }
    return request<{ state: string; workingDirectory?: string | null; platform?: string }>(
      `/api/cloud-sandbox/workspaces/${encodeURIComponent(this.workspaceId)}`
    )
  }

  async availability() {
    try {
      return await request<{ available: boolean; reason?: string }>('/api/cloud-sandbox/availability')
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }

  private async successOperation(kind: OperationKind, params: Record<string, unknown>) {
    try {
      await this.run(kind, params)
      return { success: true }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async contentOperation(kind: OperationKind, params: Record<string, unknown>) {
    try {
      const operation = await this.run(kind, params)
      return { success: true, content: String(operation.result?.content ?? '') }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async run(kind: OperationKind, params: Record<string, unknown>, timeout = 120_000) {
    if (!this.workspaceId) throw new Error('云端任务工作区尚未初始化')
    const created = await request<OperationResponse>(
      `/api/cloud-sandbox/workspaces/${encodeURIComponent(this.workspaceId)}/operations`,
      { method: 'POST', body: JSON.stringify({ kind, params }) }
    )
    this.activeOperationId = created.operationId
    const streamAbort = new AbortController()
    const streamTask = this.consumeEvents(created.operationId, streamAbort.signal).catch(() => undefined)
    const deadline = Date.now() + Math.max(1_000, Math.min(timeout + 10_000, 300_000))
    try {
      while (Date.now() < deadline) {
        const current = await request<OperationResponse>(
          `/api/cloud-sandbox/operations/${encodeURIComponent(created.operationId)}`
        )
        if (current.state === 'succeeded') return current
        if (current.state === 'failed' || current.state === 'cancelled') {
          throw new Error(current.error || `云端任务已${current.state === 'failed' ? '失败' : '取消'}`)
        }
        await new Promise((resolve) => window.setTimeout(resolve, 500))
      }
      await this.kill()
      throw new Error('云端任务执行超时')
    } finally {
      streamAbort.abort()
      await streamTask
      this.activeOperationId = null
    }
  }

  private async consumeEvents(operationId: string, signal: AbortSignal): Promise<void> {
    if (!this.workspaceId) return
    const token = authInfoStore.getState().accessToken
    if (!token) return
    const response = await fetch(
      `${apiOrigin()}/api/cloud-sandbox/workspaces/${encodeURIComponent(this.workspaceId)}/events?after=${this.eventCursor}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal }
    )
    if (!response.ok || !response.body) return
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const match = /\r?\n\r?\n/.exec(buffer)
        if (!match || match.index === undefined) break
        const block = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        const event = parseSseBlock(block)
        if (!event) continue
        if (event.id !== undefined) this.eventCursor = Math.max(this.eventCursor, event.id)
        if (event.operationId !== operationId) continue
        if (event.type === 'stdout' || event.type === 'stderr' || event.type === 'output_truncated') {
          window.dispatchEvent(new CustomEvent('kod-cloud-sandbox-output', { detail: event }))
        }
      }
    }
  }
}
