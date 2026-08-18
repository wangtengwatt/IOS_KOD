import type {
  FileMeta,
  KnowledgeBase,
  KnowledgeBaseFile,
  KnowledgeBaseProviderMode,
  KnowledgeBaseSearchResult,
} from '@shared/types'
import type { DocumentParserConfig } from '@shared/types/settings'
import { authInfoStore } from '@/stores/authInfoStore'
import { KOD_API_ORIGIN, NODE_ENV, USE_LOCAL_API } from '@/variables'
import type { KnowledgeBaseController } from './interface'

type MobileFileMeta = FileMeta & { __blob?: Blob }

function apiOrigin(): string {
  return USE_LOCAL_API || NODE_ENV === 'development' ? 'http://localhost:8080' : KOD_API_ORIGIN
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = authInfoStore.getState().accessToken
  if (!token) throw new Error('请先登录 KAI 账户再使用云端知识库')
  const isForm = init?.body instanceof FormData
  const response = await fetch(`${apiOrigin()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(!isForm && init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const json = (await response.json()) as { code?: number; message?: string; data?: T }
  if (!response.ok || json.code !== 0 || json.data == null) {
    throw new Error(json.message || `云端知识库 HTTP ${response.status}`)
  }
  return json.data
}

export class CloudKnowledgeBaseController implements KnowledgeBaseController {
  list() {
    return request<KnowledgeBase[]>('/api/knowledge-bases')
  }

  async create(createParams: {
    name: string
    embeddingModel: string
    rerankModel: string
    visionModel?: string
    documentParser?: DocumentParserConfig
    providerMode?: KnowledgeBaseProviderMode
  }) {
    await request('/api/knowledge-bases', { method: 'POST', body: JSON.stringify(createParams) })
  }

  async delete(id: number) {
    await request(`/api/knowledge-bases/${id}`, { method: 'DELETE' })
  }

  listFiles(kbId: number) {
    return request<KnowledgeBaseFile[]>(`/api/knowledge-bases/${kbId}/files?offset=0&limit=100`)
  }

  countFiles(kbId: number) {
    return request<number>(`/api/knowledge-bases/${kbId}/files/count`)
  }

  listFilesPaginated(kbId: number, offset = 0, limit = 20) {
    return request<KnowledgeBaseFile[]>(
      `/api/knowledge-bases/${kbId}/files?offset=${Math.max(0, offset)}&limit=${Math.max(1, Math.min(limit, 100))}`
    )
  }

  async uploadFile(kbId: number, file: FileMeta) {
    const blob = (file as MobileFileMeta).__blob
    if (!blob) throw new Error('移动端没有取得文件内容，请重新选择文件')
    const form = new FormData()
    form.append('file', blob, file.name)
    await request(`/api/knowledge-bases/${kbId}/files`, { method: 'POST', body: form })
  }

  async deleteFile(fileId: number) {
    await request(`/api/knowledge-bases/files/${fileId}`, { method: 'DELETE' })
  }

  async retryFile(fileId: number) {
    await request(`/api/knowledge-bases/files/${fileId}/retry`, { method: 'POST' })
  }

  async pauseFile(fileId: number) {
    await request(`/api/knowledge-bases/files/${fileId}/pause`, { method: 'POST' })
  }

  async resumeFile(fileId: number) {
    await request(`/api/knowledge-bases/files/${fileId}/resume`, { method: 'POST' })
  }

  search(kbId: number, query: string) {
    return request<KnowledgeBaseSearchResult[]>(
      `/api/knowledge-bases/${kbId}/search?query=${encodeURIComponent(query)}`
    )
  }

  async update(updateParams: { id: number; name?: string; rerankModel?: string; visionModel?: string }) {
    const { id, ...body } = updateParams
    await request(`/api/knowledge-bases/${id}`, { method: 'PUT', body: JSON.stringify(body) })
  }

  getFilesMeta(kbId: number, fileIds: number[]) {
    return request<
      Array<{
        id: number
        kbId: number
        filename: string
        mimeType: string
        fileSize: number
        chunkCount: number
        totalChunks: number
        status: string
        createdAt: number
      }>
    >(`/api/knowledge-bases/${kbId}/file-metas`, { method: 'POST', body: JSON.stringify(fileIds) })
  }

  readFileChunks(kbId: number, chunks: { fileId: number; chunkIndex: number }[]) {
    return request<Array<{ fileId: number; filename: string; chunkIndex: number; text: string }>>(
      `/api/knowledge-bases/${kbId}/chunks`,
      { method: 'POST', body: JSON.stringify({ chunks }) }
    )
  }

  async testMineruConnection(_apiToken: string) {
    return request<{ success: boolean; error?: string }>('/api/knowledge-bases/parser/test', { method: 'POST' })
  }
}
