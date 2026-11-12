import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getAuth } from './cloud'
import { configureSync, hydrateCloud } from './cloudSync'
import { makeId, type UserProfile } from './contract'
import { repository } from './repository'
import { prepareShowcase, showcaseId } from './showcase'

type Mode = 'cloud' | 'demo'
export type LoginChannel = 'phone' | 'email'

export interface AuthUser {
  userId: string
  nickname: string
  email?: string
  phone?: string
}

interface PendingOtp {
  channel: LoginChannel
  recipient: string
  verificationId: string
  isExistingUser: boolean
}

interface DemoAccount {
  userId: string
  email: string
  nickname: string
}

interface AuthValue {
  mode: Mode
  showcase: boolean
  toggleShowcase: () => Promise<void>
  ready: boolean
  user: AuthUser | null
  profile: UserProfile | null
  error: string
  notice: string
  fieldError: string
  busy: boolean
  codeSent: boolean
  resendAfter: number
  resetCode: () => void
  channel: LoginChannel
  setMode: (mode: Mode) => void
  setChannel: (channel: LoginChannel) => void
  setError: (message: string) => void
  setNotice: (message: string) => void
  setFieldError: (message: string) => void
  sendCode: (recipient: string) => Promise<void>
  verifyCode: (recipient: string, token: string) => Promise<void>
  demoSignIn: (nickname: string, email: string) => Promise<void>
  oneClickDemoSignIn: () => Promise<void>
  signOut: () => Promise<void>
  updateProfile: (patch: Partial<Pick<UserProfile, 'nickname' | 'targetBand'>>) => void
}

const AuthContext = createContext<AuthValue | null>(null)
const MODE_KEY = 'ielts_coach_mode'
const SESSION_KEY = 'ielts_coach_demo_user'
const DEMO_ACCOUNTS_KEY = 'ielts_coach_demo_accounts'
const SHOWCASE_OWNER_KEY = 'ielts_showcase_owner'

function authFailure(cause:unknown, fallback:string):string {
  const value=cause as {message?:string;code?:string;kind?:string}
  const text=[value?.code,value?.kind,value?.message].filter(Boolean).join(' ')
  if(/timeout|abort/i.test(text))return '账号服务响应超时，请稍后重试。'
  if(/429|rate.?limit|too.?many|频繁/i.test(text))return '验证码请求过于频繁，请稍后再试。'
  if(/origin|cors|publishable|not.?found|404|not.?enabled|not.?configured|未开通|未启用/i.test(text))return '当前站点的验证码服务配置尚未就绪，请联系项目部署人员；也可先进入本机体验。'
  if(/expired|invalid.?code|verification.*invalid|验证码.*(错误|过期)/i.test(text))return '验证码不正确或已过期，请检查后重试。'
  if(/network|fetch|connection/i.test(text))return '暂时无法连接验证码服务，请检查网络后重试。'
  return fallback
}

function initialMode(): Mode {
  const params = new URLSearchParams(window.location.search)
  const forced = params.get('demo')
  if (forced === '1') return 'demo'
  if (forced === '0'||params.get('cloud')==='1') return 'cloud'
  const saved = localStorage.getItem(MODE_KEY) as Mode | null
  if (saved === 'cloud' || saved === 'demo') return saved
  // 本站自带账号与数据库，昵称+邮箱即可进入。短信验证码登录需要平台账号服务，
  // 仅在使用 ?cloud=1 时展示，避免访客一进来就卡在收不到验证码的页面。
  if (params.get('cloud') === '1') return 'cloud'
  return 'demo'
}

function readDemoAccounts(): DemoAccount[] {
  try {
    return JSON.parse(localStorage.getItem(DEMO_ACCOUNTS_KEY) ?? '[]') as DemoAccount[]
  } catch {
    return []
  }
}

function ensureProfile(user: AuthUser): UserProfile {
  const existing = repository.getProfile(user.userId)
  if (existing) return existing
  const created: UserProfile = {
    userId: user.userId,
    nickname: user.nickname,
    targetBand: 6.5,
    createdAt: new Date().toISOString(),
    email: user.email,
  }
  repository.saveProfile(created)
  return created
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>(initialMode)
  const [channel, setChannelState] = useState<LoginChannel>('phone')
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [showcaseOwner, setShowcaseOwner] = useState(() => sessionStorage.getItem(SHOWCASE_OWNER_KEY))
  const switching = useRef(false)
  const authRevision = useRef(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [busy, setBusy] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [resendAt,setResendAt]=useState(0),[resendAfter,setResendAfter]=useState(0)
  const otpRevision=useRef(0),otpBusy=useRef(false)
  const pendingOtp = useRef<PendingOtp | null>(null)
  useEffect(()=>{
    const update=()=>setResendAfter(Math.max(0,Math.ceil((resendAt-Date.now())/1000)))
    update();const timer=window.setInterval(update,1000);return()=>clearInterval(timer)
  },[resendAt])
  const resetCode=useCallback(()=>{
    otpRevision.current++;otpBusy.current=false;pendingOtp.current=null
    setCodeSent(false);setResendAt(0);setError('');setNotice('');setFieldError('');setBusy(false)
  },[])
  const showcase = !!user && showcaseOwner === user.userId
  const activeProfile = showcase && user ? repository.getProfile(showcaseId(user.userId)) : profile
  const activeUser = useMemo(() => showcase && user
    ? {...user,userId:showcaseId(user.userId),nickname:activeProfile?.nickname || user.nickname}
    : user, [user,showcase,activeProfile?.nickname])

  const closeShowcase = useCallback(() => {
    authRevision.current++
    sessionStorage.removeItem(SHOWCASE_OWNER_KEY)
    setShowcaseOwner(null)
  }, [])
  const toggleShowcase = useCallback(async () => {
    if (!user || !profile || switching.current) return
    if (showcase) {closeShowcase(); return}
    switching.current = true
    const revision = authRevision.current
    setBusy(true)
    try {
      await prepareShowcase(profile)
      if (revision !== authRevision.current) return
      sessionStorage.setItem(SHOWCASE_OWNER_KEY,user.userId)
      setShowcaseOwner(user.userId)
    } finally {
      switching.current = false
      setBusy(false)
    }
  }, [user,profile,showcase,closeShowcase])

  /** 云账号登录后先从云端恢复记录，再进入学习空间；演示模式只使用本机镜像 */
  const adopt = useCallback(async (next: AuthUser, cloud: boolean, current:()=>boolean=()=>true) => {
    if(!current())return
    if (cloud) {
      configureSync({ active: true, userId: next.userId, ownerName: next.nickname })
      const result = await hydrateCloud(next.userId)
      if(!current())return
      if (!result.ok) setNotice(result.message)
    } else {
      configureSync({ active: false })
    }
    const base = ensureProfile(next)
    if (sessionStorage.getItem(SHOWCASE_OWNER_KEY) === next.userId) {
      try { await prepareShowcase(base) }
      catch {closeShowcase();setNotice('演示记录暂时无法加载，可以在右上角重试。')}
    }
    if (!current()) return
    setUser(next)
    setProfile(base)
  }, [closeShowcase])

  useEffect(() => {
    let cancelled = false
    const revision = authRevision.current
    const current = () => !cancelled && revision === authRevision.current
    async function restore() {
      if (switching.current) return
      if (mode === 'demo') {
        const userId = localStorage.getItem(SESSION_KEY)
        if (userId) {
          const account = readDemoAccounts().find((a) => a.userId === userId)
          if (account) {
            await adopt({ userId: account.userId, nickname: account.nickname, email: account.email }, false, current)
          }
        }
        if (current()) setReady(true)
        return
      }
      try {
        const { data: session, error: sessionError } = await getAuth().getSession()
        if (!current()) return
        if (sessionError) {
          // 网络类错误保留当前状态，不伪造身份
          setNotice('暂时无法连接账号服务，请检查网络后重试。')
        } else if (session?.user?.id) {
          const identity = session.user
          await adopt({
            userId: `usr_${identity.id}`,
            nickname: identity.name ?? identity.email?.split('@')[0] ?? '雅思考生',
            email: identity.email,
          }, true,current)
          if (!current()) return
        }
      } catch (cause) {
        if (current()) setNotice(authFailure(cause,'暂时无法连接账号服务，请检查网络后重试。'))
      } finally {
        if (current()) setReady(true)
      }
    }
    void restore()
    return () => { cancelled = true }
  }, [mode, adopt])

  const modeRef = useRef<Mode>(mode)
  modeRef.current = mode

  const setMode = useCallback((next: Mode) => {
    // 关键修复：点击「已经是当前模式」的按钮时，mode 不会变化，
    // 下方依赖 [mode] 的 useEffect 不会重新执行，ready 就会永久停在 false，
    // 整个页面卡死在首屏加载层。
    // 因此模式未变时直接返回（幂等，也避免重复重连云端）。
    if (modeRef.current === next) return
    otpRevision.current++;otpBusy.current=false;setBusy(false);setResendAt(0)

    configureSync({ active: false })
    closeShowcase()
    localStorage.setItem(MODE_KEY, next)
    pendingOtp.current = null
    setCodeSent(false)
    setError('')
    setNotice('')
    setFieldError('')
    setUser(null)
    setProfile(null)
    setModeState(next)
    setReady(false)
  }, [closeShowcase])

  /** 切换手机号 / 邮箱时丢弃旧验证码挑战，避免用错收件人验证 */
  const setChannel = useCallback((next: LoginChannel) => {
    otpRevision.current++;otpBusy.current=false;setBusy(false);setResendAt(0)
    pendingOtp.current = null
    setCodeSent(false)
    setError('')
    setNotice('')
    setFieldError('')
    setChannelState(next)
  }, [])

  const sendCode = useCallback(async (recipient: string) => {
    if(otpBusy.current||modeRef.current!=='cloud'||Date.now()<resendAt)return
    setError('')
    setNotice('')
    setFieldError('')
    const target = recipient.trim()
    if (channel === 'phone') {
      if (!/^1\d{10}$/.test(target)) {
        setFieldError('请输入正确的 11 位手机号')
        return
      }
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) {
      setError('请输入有效的邮箱地址')
      return
    }
    const revision=++otpRevision.current
    otpBusy.current=true;setBusy(true)
    try {
      const sent = channel === 'phone'
        ? await getAuth().sendOtp({ phone: target })
        : await getAuth().sendOtp({ email: target })
      if(revision!==otpRevision.current)return
      if (sent.error || !sent.data) {
        setError(authFailure(sent.error,'验证码发送失败，请稍后重试；若持续无法接收，请确认该渠道已启用。'))
        return
      }
      if(typeof sent.data.verificationId!=='string'||!sent.data.verificationId||typeof sent.data.isExistingUser!=='boolean'){
        setError('验证码服务未返回有效的验证请求，请联系项目部署人员。');return
      }
      pendingOtp.current = {
        channel,
        recipient: target,
        verificationId: sent.data.verificationId,
        isExistingUser: sent.data.isExistingUser,
      }
      setCodeSent(true)
      setResendAt(Date.now()+60000)
      setNotice(channel === 'phone'
        ? `短信验证码已请求发送至 ${target}，请查看手机。`
        : `邮件验证码已请求发送至 ${target}，请查收收件箱或垃圾邮件。`)
    } catch (cause) {
      if(revision===otpRevision.current)setError(authFailure(cause,'验证码请求未完成，请稍后重试。'))
    } finally {
      if(revision===otpRevision.current){otpBusy.current=false;setBusy(false)}
    }
  }, [channel,resendAt])

  const verifyCode = useCallback(async (recipient: string, token: string) => {
    if(otpBusy.current||modeRef.current!=='cloud')return
    setError('')
    setFieldError('')
    const target = recipient.trim()
    const pending = pendingOtp.current
    if (!pending || pending.channel !== channel || pending.recipient !== target) {
      setError(channel === 'phone' ? '请先为当前手机号获取验证码' : '请先为当前邮箱获取验证码')
      return
    }
    if (!/^\d{4,8}$/.test(token.trim())) {
      setError('请输入收到的数字验证码')
      return
    }
    const revision=++otpRevision.current;otpBusy.current=true;setBusy(true)
    try {
      const common = {
        verificationId: pending.verificationId,
        isExistingUser: pending.isExistingUser,
        token: token.trim(),
      }
      // email 与 phone 互斥，且必须与发送验证码时使用的是同一个收件人
      const completed = channel === 'phone'
        ? await getAuth().verifyOtp({ phone: pending.recipient, ...common })
        : await getAuth().verifyOtp({ email: pending.recipient, ...common })
      if(revision!==otpRevision.current)return
      if (completed.error || !completed.data) {
        setError(authFailure(completed.error,'验证失败，请检查验证码后重试。'))
        return
      }
      const identity = completed.data.user ?? completed.data.session?.user ?? {}
      if(typeof identity.id!=='string'||!identity.id){setError('验证码服务未建立有效登录会话，请重新验证。');return}
      const fallback = channel === 'phone' ? `考生${target.slice(-4)}` : target.split('@')[0]
      pendingOtp.current = null
      setCodeSent(false)
      setResendAt(0)
      await adopt({
        userId: `usr_${identity.id}`,
        nickname: identity.name ?? identity.email?.split('@')[0] ?? fallback,
        email: identity.email ?? (channel === 'email' ? target : undefined),
        phone: channel === 'phone' ? target : undefined,
      }, true,()=>revision===otpRevision.current)
      if(revision!==otpRevision.current)return
      setNotice('登录成功，学习首页已就绪。')
    } catch (cause) {
      if(revision===otpRevision.current)setError(authFailure(cause,'验证未完成，请稍后重试。'))
    } finally {
      if(revision===otpRevision.current){otpBusy.current=false;setBusy(false)}
    }
  }, [adopt, channel])

  const demoSignIn = useCallback(async (nickname: string, email: string) => {
    setError('')
    const cleanName = nickname.trim()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanName) {
      setError('请填写昵称')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('请输入有效的邮箱地址')
      return
    }
    const accounts = readDemoAccounts()
    let account = accounts.find((a) => a.email === cleanEmail)
    if (!account) {
      account = { userId: makeId('user'), email: cleanEmail, nickname: cleanName }
      accounts.push(account)
      localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify(accounts))
    } else if (account.nickname !== cleanName) {
      account.nickname = cleanName
      localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify(accounts))
    }
    localStorage.setItem(SESSION_KEY, account.userId)
    await adopt({ userId: account.userId, nickname: account.nickname, email: account.email }, false)
    setNotice('')
  }, [adopt])

  const oneClickDemoSignIn = useCallback(async () => {
    if (switching.current) return
    switching.current = true
    const revision = ++authRevision.current
    otpRevision.current++; otpBusy.current = false; pendingOtp.current = null
    setBusy(true); setReady(false); setError(''); setNotice(''); setFieldError('')
    setCodeSent(false); setResendAt(0)
    configureSync({ active: false })
    sessionStorage.removeItem(SHOWCASE_OWNER_KEY)
    setShowcaseOwner(null)
    localStorage.setItem(MODE_KEY, 'demo')
    modeRef.current = 'demo'
    setModeState('demo')
    try {
      const accounts = readDemoAccounts()
      let account = accounts.find(item => item.email === 'test@qq.com')
      if (!account) {
        account = { userId: makeId('user'), nickname: 'Test', email: 'test@qq.com' }
        accounts.push(account)
      }
      account.nickname = 'Test'
      localStorage.setItem(DEMO_ACCOUNTS_KEY, JSON.stringify(accounts))
      const next = { userId: account.userId, nickname: 'Test', email: 'test@qq.com' }
      const base = { ...ensureProfile(next), nickname: next.nickname, email: next.email }
      repository.saveProfile(base)
      await prepareShowcase(base)
      if (revision !== authRevision.current) return
      const sample = repository.getProfile(showcaseId(next.userId))
      if (sample) repository.saveProfile({ ...sample, nickname: next.nickname, email: next.email })
      // A previous ?cloud=1 / ?demo=0 link must not undo this explicit choice on refresh.
      const url = new URL(window.location.href)
      url.searchParams.delete('cloud')
      url.searchParams.delete('demo')
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
      localStorage.setItem(SESSION_KEY, next.userId)
      sessionStorage.setItem(SHOWCASE_OWNER_KEY, next.userId)
      setProfile(base); setShowcaseOwner(next.userId); setUser(next)
    } catch {
      if (revision === authRevision.current) {
        localStorage.removeItem(SESSION_KEY)
        setUser(null); setProfile(null)
        setError('演示空间加载失败，请点击一键登录重试。')
      }
    } finally {
      switching.current = false
      if (revision === authRevision.current) { setBusy(false); setReady(true) }
    }
  }, [])

  const signOut = useCallback(async () => {
    otpRevision.current++;otpBusy.current=false;setResendAt(0)
    setBusy(true)
    try {
      if (mode === 'cloud') {
        const result = await getAuth().signOut()
        if (result.error) {
          setError(result.error.message ?? '退出失败，请重试')
          return
        }
      } else {
        localStorage.removeItem(SESSION_KEY)
      }
      configureSync({ active: false })
      closeShowcase()
      setUser(null)
      setProfile(null)
      pendingOtp.current = null
      setCodeSent(false)
      setNotice('已退出登录')
    } finally {
      setBusy(false)
    }
  }, [mode,closeShowcase])

  const updateProfile = useCallback((patch: Partial<Pick<UserProfile, 'nickname' | 'targetBand'>>) => {
    if (!activeUser) return
    const current = repository.getProfile(activeUser.userId) ?? ensureProfile(activeUser)
    const next: UserProfile = { ...current, ...patch }
    repository.saveProfile(next)
    if (showcase) {
      setProfile(prev=>prev && {...prev})
    } else {
      setProfile(next)
      setUser((prev) => (prev ? { ...prev, nickname: next.nickname } : prev))
    }
  }, [activeUser,showcase])

  const value = useMemo<AuthValue>(() => ({
    mode:showcase ? 'demo' : mode, showcase, toggleShowcase, ready, user:activeUser, profile:activeProfile, error, notice, fieldError, busy, codeSent, resendAfter,resetCode,channel,
    setMode, setChannel, setError, setNotice, setFieldError,
    sendCode, verifyCode, demoSignIn, oneClickDemoSignIn, signOut, updateProfile,
  }), [mode, showcase, toggleShowcase, ready, activeUser, activeProfile, error, notice, fieldError, busy, codeSent, resendAfter,resetCode,channel,
    setMode, setChannel, sendCode, verifyCode, demoSignIn, oneClickDemoSignIn, signOut, updateProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
