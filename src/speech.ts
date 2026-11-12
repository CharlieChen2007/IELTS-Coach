/** Demo 音频：用浏览器语音合成朗读听力原声片段，便于验证「原声定位」交互 */
export function speak(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text.replace(/\[\d{2}:\d{2}\]/g, '').replace(/^(Dr Halden|Mia|Oliver):/gm, '').trim())
  utterance.lang = 'en-US'
  utterance.rate = 0.92
  window.speechSynthesis.speak(utterance)
  return true
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
}
