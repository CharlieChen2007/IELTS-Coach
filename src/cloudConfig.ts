/**
 * 应用公开配置 —— 由 workbuddy_cloud_service.activate 返回的 publicConfig。
 * 仅含面向终端用户的公开值，可安全随前端代码发布；不含任何服务端密钥。
 * 由服务器 /cloud-config.js 运行时提供，换云应用不必重打前端包。
 */
const runtime = typeof window==='undefined'?{}:(window as Window & {__IELTS_CLOUD_CONFIG__?:Partial<{endpoint:string;oauthRelayBaseUrl:string;publishableKey:string}>}).__IELTS_CLOUD_CONFIG__ || {}
export const CLOUD_CONFIG = {
  // SDK recommends same-origin; never bake a previous deployment domain into OTP calls.
  endpoint: runtime.endpoint || (typeof window==='undefined'?'http://localhost':window.location.origin),
  oauthRelayBaseUrl: 'https://www.workbuddy.cn/v2/as/genie-baas/oauth',
  publishableKey: '',
  ...runtime,
} as const
