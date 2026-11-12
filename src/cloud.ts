import { createWorkBuddyCloud } from '@tencent-ai/workbuddy-cloud-sdk'
import { CLOUD_CONFIG } from './cloudConfig'

/**
 * 全应用只初始化一次，Auth / Database / Storage / LLM 共用同一实例。
 * 延迟初始化：演示模式下完全不触碰云 SDK，保证离线也能完整自测与验收。
 */
let client: ReturnType<typeof createWorkBuddyCloud> | null = null

const cloudFetch:typeof fetch = async (input,init) => {
  const controller=new AbortController(),signal=init?.signal || (input instanceof Request?input.signal:null)
  const abort=()=>controller.abort()
  if(signal?.aborted)controller.abort();else signal?.addEventListener('abort',abort,{once:true})
  const timer=setTimeout(abort,20000)
  try{return await fetch(input,{...init,signal:controller.signal})}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort)}
}

export function getCloud() {
  if (!client) {
    if(!CLOUD_CONFIG.publishableKey.startsWith('wbpk_'))throw new Error('验证码服务尚未配置有效的 publishableKey')
    const endpoint=new URL(CLOUD_CONFIG.endpoint)
    if(!['https:','http:'].includes(endpoint.protocol))throw new Error('账号服务 endpoint 配置无效')
    client = createWorkBuddyCloud({
      endpoint: CLOUD_CONFIG.endpoint,
      oauthRelayBaseUrl: CLOUD_CONFIG.oauthRelayBaseUrl,
      publishableKey: CLOUD_CONFIG.publishableKey,
      fetch: cloudFetch,
    })
  }
  return client
}

type SdkError = { message: string; kind?: string; code?: string } | null
export interface CloudIdentity {
  id?: string
  name?: string
  email?: string
  avatarUrl?: string
}

/** SDK 处于 dev 通道，方法签名按官方 Auth code-generation 文档本地收敛 */
type OtpTarget = { email: string; phone?: never } | { phone: string; email?: never }
interface OtpSent {
  data: { verificationId: string; isExistingUser: boolean } | null
  error: SdkError
}
interface AuthLike {
  /** email 与 phone 互斥：每次调用只能传其中一个 */
  sendOtp(args: OtpTarget): Promise<OtpSent>
  /** 必须复用 sendOtp 返回的 recipient / verificationId / isExistingUser */
  verifyOtp(args: OtpTarget & {
    verificationId: string
    isExistingUser: boolean
    token: string
  }): Promise<{ data: { user?: CloudIdentity; session?: { user?: CloudIdentity } } | null; error: SdkError }>
  getSession(): Promise<{ data: { user?: CloudIdentity } | null; error: SdkError }>
  signOut(): Promise<{ error: SdkError }>
  onAuthStateChange(cb: (event: string, session: unknown) => void): () => void
}

export function getAuth(): AuthLike {
  return getCloud().auth as unknown as AuthLike
}
