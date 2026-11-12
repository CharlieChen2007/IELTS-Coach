import { useLayoutEffect, useRef, useState } from 'react'

interface Props {
  text: string | null
  title: string
  next: string
  label?: string
  placeholder?: string
  button?: string
  publish?: (text: string) => Promise<void>
}

/** A single reply keeps its place on the page as the composer becomes a receipt. */
export function ReplyExchange({text, title, next, label, placeholder, button, publish}: Props) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = useRef<HTMLDivElement>(null)
  const receipt = useRef<HTMLElement>(null)
  const lock = useRef(false)
  const fromHeight = useRef(0)

  useLayoutEffect(() => {
    const panel = box.current, card = receipt.current, height = fromHeight.current
    if (!text || !panel || !card || !height) return
    fromHeight.current = 0
    card.focus({preventScroll:true})
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    card.classList.add('reply-arrives')
    const anim = panel.animate?.([{height:height+'px'},{height:card.offsetHeight+'px'}],
      {duration:380, easing:'cubic-bezier(.2,.8,.2,1)'})
    return () => { anim?.cancel(); card.classList.remove('reply-arrives') }
  }, [text])

  async function submit() {
    const value = draft.trim()
    if (!value || !publish || lock.current || text) return
    lock.current = true
    fromHeight.current = box.current?.offsetHeight || 0
    setBusy(true)
    setError('')
    try {
      await publish(value)
    } catch (err) {
      fromHeight.current = 0
      setError((err as Error).message || '回复未能保存，请重试。')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  if (!text && !publish) return null
  return <div className="reply-exchange" ref={box}>
    {text ? <section className="reply-receipt" ref={receipt} tabIndex={-1} aria-label={title}>
      <div className="reply-receipt-heading"><span className="reply-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none"><path pathLength="1" d="m5.5 12 4.2 4.2 8.8-9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </span><h3>{title}</h3></div>
      <p className="reply-body">{text}</p><p className="reply-next">{next}</p>
    </section> : <form className="clinic-form" onSubmit={e=>{e.preventDefault();void submit()}}>
      <label>{label}<textarea className="textarea" value={draft} onChange={e=>setDraft(e.target.value)}
        maxLength={2500} placeholder={placeholder} required readOnly={busy}/></label>
      <button className="btn btn-primary" disabled={busy||!draft.trim()}>{busy?'提交中':button}</button>
      {error&&<p className="clinic-error" role="alert">{error}</p>}
    </form>}
  </div>
}
