import { createContext, useContext } from 'react'

export interface Route {
  name: 'landing' | 'auth' | 'home' | 'subject' | 'practice' | 'report' | 'history' | 'trends' | 'mistakes' | 'profile' | 'campus' | 'vocabulary'
  id: string
  query: Record<string, string>
}

export interface AppContextValue {
  route: Route
  go: (path: string) => void
  replace?: (path: string) => void
  version: number
  refresh: () => void
  toast: (message: string) => void
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppContext')
  return ctx
}

const VALID: Route['name'][] = ['landing', 'auth', 'home', 'subject', 'practice', 'report', 'history', 'trends', 'mistakes', 'profile', 'campus', 'vocabulary']

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '')
  const [pathPart, queryPart = ''] = raw.split('?')
  const [name, id = ''] = pathPart.split('/')
  const query: Record<string, string> = {}
  new URLSearchParams(queryPart).forEach((value, key) => { query[key] = value })
  if (name === 'vocab' || name === 'subject' && id === 'speaking' && query.view === 'vocab') {
    const { view: _legacyView, ...rest } = query
    return { name: 'vocabulary', id: '', query: rest }
  }
  if (name === 'campus' && id === 'verify') return { name: 'profile', id: 'campus', query }
  if (name === 'campus' && id === 'clinic') return { name: 'subject', id: 'speaking', query: { ...query, view: 'clinic' } }
  if (name === 'practice' && !query.draft && (id === 'exr_sp_mock_01' || id === 'exr_sp_free_01')) {
    return { name: 'subject', id: 'speaking', query: { ...query, view: id === 'exr_sp_mock_01' ? 'full' : 'practice' } }
  }
  return {
    // 空 hash 显示落地页；登录状态由 App 决定是否直接进入学习首页
    name: VALID.includes(name as Route['name']) ? (name as Route['name']) : 'landing',
    id,
    query,
  }
}

export function toHash(path: string): string {
  return `#/${path.replace(/^#?\/?/, '')}`
}
