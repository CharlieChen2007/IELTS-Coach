// Browser-selected account scope chooses a cookie; only its HttpOnly token grants access.
export async function speakingOwner(request, env) {
  const scope=request.headers.get('X-Speaking-Scope');
  if(scope){
    if(!/^[A-Za-z0-9_%.-]{1,200}$/.test(scope))return null;
    const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
    const name='coach_group_campus_session_'+await digest(scope);
    const cookie=(request.headers.get('Cookie')||'').split(';').map(value=>value.trim()).find(value=>value.startsWith(name+'='));
    const token=cookie?.slice(name.length+1);
    if(!/^[a-f0-9]{64}$/.test(token||''))return null;
    const owner='guest_'+await digest(token);
    return await env.DB.prepare('SELECT 1 FROM campus_profiles WHERE user_id=?').bind(owner).first()?owner:null;
  }
  // The standalone hosted gateway supplies this header. The public Node/Worker
  // integration strips browser-supplied oai-* headers before reaching this code.
  return request.headers.get('oai-authenticated-user-id')||null;
}
