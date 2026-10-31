import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Eye, EyeOff, Info, LoaderCircle, Mail, ShieldCheck } from 'lucide-react';
import App from './App';
import { AccessManagement, JoinWorkspace, PublishedBulletins } from './AccessManagement';
import { BrandLogo } from './BrandLogo';
import { authenticatedRequest, checkBackendHealth, clearAuthSession, ensureSessionToken, login, logout, restoreAuthSession, type AuthProfile } from './api';
import { consumeVerificationReturn, consumeRecoveryReturn } from './verificationReturn';
import { PasswordRecovery } from './PasswordRecovery';

type Context = { context_id: string; name: string };
type AuthMode = 'login' | 'register';
type Field = 'displayName' | 'email' | 'password';
const recoveryReturn = consumeRecoveryReturn();
const verificationNotice = consumeVerificationReturn();
export function AuthGate() {
  const [managementOpen, setManagementOpen] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(recoveryReturn.isCallback);
  const [loading, setLoading] = useState(true), [mock, setMock] = useState(false), [offline, setOffline] = useState(false);
  const [profile, setProfile] = useState<AuthProfile | null>(null), [contexts, setContexts] = useState<Context[]>([]), [context, setContext] = useState('');
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [displayName, setDisplayName] = useState('');
  const [mode, setMode] = useState<AuthMode>('login'), [error, setError] = useState(verificationNotice.error), [message, setMessage] = useState(verificationNotice.message), [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false), [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!loading) window.dispatchEvent(new Event('sigap-ready')); }, [loading]);
  useEffect(() => { if (!loading && (error || message)) feedbackRef.current?.focus(); }, [error, message, loading]);
  const fieldErrors = {
    displayName: !displayName.trim() ? 'Isi nama yang akan ditampilkan di ruang kerja.' : '',
    email: !email.trim() ? 'Isi alamat email Anda.' : !/^[^\s@]+@[^\s@]+$/.test(email.trim()) ? 'Periksa format email, misalnya nama@contoh.id.' : '',
    password: !password ? 'Isi kata sandi Anda.' : password.length < 8 ? 'Kata sandi perlu minimal 8 karakter.' : '',
  };
  const fieldError = (field: Field) => touched[field] ? fieldErrors[field] : '';
  function changeMode(next: AuthMode) { setMode(next); setError(''); setMessage(''); setPassword(''); setShowPassword(false); setTouched({}); }
  async function loadProfile(p: AuthProfile) {
    if (p.status === 'active' && p.role && p.role !== 'viewer') {
      try { const available: Context[] = await authenticatedRequest('/api/contexts'); setContexts(available); setContext(available[0]?.context_id || ''); }
      catch (error) { setContexts([]); setContext(''); setProfile(p); throw error; }
    } else { setContexts([]); setContext(''); }
    setProfile(p);
  }
  async function retryAccess() {
    if (busy) return; setBusy(true); setError(''); setMessage('');
    try { const result = await authenticatedRequest('/api/auth/me'); await loadProfile(result.profile); }
    catch (e) { setError(e instanceof Error ? e.message : 'Akses belum dapat diperiksa. Coba lagi sebentar.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (recoveryReturn.isCallback) { clearAuthSession(); return; }
        const health = await checkBackendHealth(); if (!active) return;
        if (!health) { setOffline(true); return; }
        if (health.session_token) { setMock(true); return; }
        const session = await restoreAuthSession(); if (active && session) await loadProfile(session.profile);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Tidak dapat memuat sesi.'); } finally { if (active) setLoading(false); }
    })();
    const expired = () => { setProfile(null); setContexts([]); setContext(''); setError('Sesi berakhir. Silakan masuk kembali.'); };
    window.addEventListener('sigap-auth-expired', expired);
    const timer = window.setInterval(() => { void ensureSessionToken().catch(() => { }); }, 30000);
    return () => { active = false; clearInterval(timer); window.removeEventListener('sigap-auth-expired', expired); };
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(''); setMessage('');
    try {
      if (mode === 'login') { const session = await login(email.trim(), password); setPassword(''); setShowPassword(false); setTouched({}); await loadProfile(session.profile); }

      else { const body = { email: email.trim(), password, display_name: displayName.trim() }; const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const result = await res.json(); if (!res.ok) throw new Error(result.error?.message || 'Permintaan belum berhasil. Periksa isian dan coba kembali.'); setMessage(result.message); setPassword(''); setShowPassword(false); setMode('login'); setTouched({}); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Koneksi gagal. Coba kembali.'); } finally { setBusy(false); }
  }
  async function signOut() { setBusy(true); try { await logout(); } catch { setError('Sesi lokal telah ditutup. Koneksi server terputus saat keluar.'); } finally { clearAuthSession(); setProfile(null); setContexts([]); setContext(''); setManagementOpen(false); setBusy(false); } }
  if (recoveryOpen) return <PasswordRecovery token={recoveryReturn.token} initialError={recoveryReturn.error} onTokenClear={() => { recoveryReturn.token = ''; }} onBack={() => { recoveryReturn.token = ''; recoveryReturn.error = ''; recoveryReturn.isCallback = false; setPassword(''); setRecoveryOpen(false); }} />;
  if (loading) return <main className="auth-page"><p role="status">Memeriksa koneksi dan sesi…</p></main>;
  if (mock) return <App />;
  if (offline) return <><div className="offline-banner" role="status">Backend belum terhubung. Percakapan lokal belum diproses model. <button className="button secondary" onClick={() => location.reload()}>Coba koneksi lagi</button></div><App /></>;
  if (profile?.status === 'active' && profile.role && profile.role !== 'viewer' && (context || profile.role === 'admin')) return <><div className="context-bar"><label>Pos komando <select aria-label="Pos komando aktif" value={context} disabled={!contexts.length} onChange={e => setContext(e.target.value)}>{contexts.map(c => <option key={c.context_id} value={c.context_id}>{c.name}</option>)}</select></label>{profile.role === 'admin' && <button className="button secondary" aria-pressed={managementOpen || !context} onClick={() => setManagementOpen(v => !v)}>{managementOpen && context ? 'Kembali ke laporan' : 'Kelola ruang kerja'}</button>}{(!context || managementOpen) && <button className="button quiet" onClick={() => void signOut()}>Keluar</button>}</div>{profile.role === 'admin' && (!context || managementOpen) && <AccessManagement profile={profile} onContextsChange={available => { if (!context) setManagementOpen(true); setContexts(available); setContext(previous => available.some(c => c.context_id === previous) ? previous : available[0]?.context_id || ''); }} />}{context && <div hidden={managementOpen}><App key={`${profile.user_id}:${context}`} preferenceKey={profile.user_id} role={profile.role} contextId={context} operator={profile.display_name || 'Operator'} onLogout={() => void signOut()} /></div>}</>;

  return <main className="auth-page"><section className="card auth-card" aria-labelledby="auth-title">
    <div className="auth-main">
      <div className="auth-brand"><BrandLogo /><span>SIGAP <small>Ruang koordinasi posko</small></span></div>
      {!profile && <div className="auth-mode-switch" role="group" aria-label="Pilih masuk atau daftar">
        <button type="button" aria-label="Sudah punya akun? Masuk" aria-pressed={mode === 'login'} disabled={busy} onClick={() => changeMode('login')}>Masuk</button>
        <button type="button" aria-pressed={mode === 'register'} disabled={busy} onClick={() => changeMode('register')}>Daftar akun</button>
      </div>}
      <header className="auth-heading"><h1 id="auth-title">{profile ? 'Akses ruang kerja' : mode === 'register' ? 'Daftar akun SIGAP' : 'Masuk ke SIGAP'}</h1>
        {!profile && <p>{mode === 'register' ? 'Buat akun, lalu ikuti petunjuk akses setelah pendaftaran.' : 'Gunakan akun yang sudah didaftarkan untuk melanjutkan koordinasi posko.'}</p>}
      </header>
      {!profile && <div className="auth-admin-snippet" role="region" aria-label="Akses cepat akun admin untuk juri">
        <div className="auth-admin-snippet-top">
          <span className="auth-admin-badge"><ShieldCheck size={14} aria-hidden="true"/> Akses Juri (Admin)</span>
          <button type="button" className="auth-admin-fill-btn" onClick={() => { changeMode('login'); setEmail('admin123@gmail.com'); setPassword('12345678'); setError(''); setMessage(''); setTouched({}); }}>
            Gunakan akun
          </button>
        </div>
        <div className="auth-admin-creds">
          <div className="auth-admin-cred-item"><span className="auth-admin-cred-label">Email:</span><code>admin123@gmail.com</code></div>
          <div className="auth-admin-cred-item"><span className="auth-admin-cred-label">Kata sandi:</span><code>12345678</code></div>
        </div>
      </div>}
      {(error || message) && <div ref={feedbackRef} tabIndex={-1} className={`auth-feedback ${error ? 'is-error' : 'is-info'}`}>
        {error ? <p role="alert">{error}</p> : <p role="status">{message}</p>}
      </div>}

      {profile ? <><p>{profile.status !== 'active' ? 'Akses operasional menunggu aktivasi dan penugasan admin.' : profile.role === 'viewer' ? 'Akun Anda memiliki akses baca publikasi.' : error ? 'Penugasan belum berhasil dimuat. Coba periksa akses lagi.' : 'Belum ada pos komando yang ditugaskan. Hubungi admin untuk mendapatkan akses.'}</p>{profile.status === 'pending' && <JoinWorkspace onJoined={() => void retryAccess()} />}{profile.status === 'active' && profile.role === 'viewer' && <PublishedBulletins />}<div className="auth-access-actions"><button className="button primary" disabled={busy} onClick={() => void retryAccess()}>{busy ? 'Memeriksa akses…' : 'Periksa akses lagi'}</button><button className="button secondary" disabled={busy} onClick={() => void signOut()}>Keluar</button></div></> : <>
        <form onSubmit={submit} aria-busy={busy} aria-label={mode === 'login' ? 'Form masuk' : 'Form pendaftaran'}>
          {mode === 'register' && <div className="auth-field">
            <label htmlFor="auth-name">Nama tampilan</label>
            <input id="auth-name" value={displayName} onChange={e => setDisplayName(e.target.value)} onBlur={() => setTouched(t => ({ ...t, displayName: true }))} onInvalid={() => setTouched(t => ({ ...t, displayName: true }))} aria-invalid={!!fieldError('displayName')} aria-describedby="auth-name-hint" required pattern=".*\S.*" maxLength={120} autoComplete="name" disabled={busy} placeholder="Contoh: Rani Putri" />
            <p id="auth-name-hint" className={`auth-hint${fieldError('displayName') ? ' is-error' : ''}`}>{fieldError('displayName') || 'Nama yang dikenali tim Anda di ruang kerja.'}</p>
          </div>}
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" value={email} onChange={e => setEmail(e.target.value)} onBlur={() => setTouched(t => ({ ...t, email: true }))} onInvalid={() => setTouched(t => ({ ...t, email: true }))} aria-invalid={!!fieldError('email')} aria-describedby="auth-email-hint" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={busy} placeholder="nama@contoh.id" />
            <p id="auth-email-hint" className={`auth-hint${fieldError('email') ? ' is-error' : ''}`}>{fieldError('email') || (mode === 'register' ? 'Email digunakan sebagai identitas login. Tidak perlu tautan konfirmasi email.' : 'Gunakan alamat email yang sama dengan saat mendaftar.')}</p>
          </div>
          <div className="auth-field">
            <label htmlFor="auth-password">Kata sandi</label>
            <div className="auth-password-wrap"><input id="auth-password" type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} onBlur={() => setTouched(t => ({ ...t, password: true }))} onInvalid={() => setTouched(t => ({ ...t, password: true }))} aria-invalid={!!fieldError('password')} aria-describedby="auth-password-hint" required minLength={8} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy} />
              <button type="button" className="auth-password-toggle" aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'} aria-pressed={showPassword} aria-controls="auth-password" disabled={busy} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}</button>
            </div>
            <p id="auth-password-hint" className={`auth-hint${fieldError('password') ? ' is-error' : mode === 'register' && password.length >= 8 ? ' is-valid' : ''}`}>
              {mode === 'register' && password.length >= 8 && !fieldError('password') && <Check size={15} aria-hidden="true" />}
              {fieldError('password') || (mode === 'register' ? (password.length >= 8 ? 'Panjang kata sandi sudah memenuhi minimal 8 karakter.' : `Minimal 8 karakter${password.length ? ` · ${password.length}/8 terisi` : '. Bisa menggunakan pengelola kata sandi.'}`) : 'Masukkan kata sandi yang Anda buat saat pendaftaran.')}
            </p>
          </div>
          <button type="submit" className="button primary auth-submit" disabled={busy}>{busy ? <><LoaderCircle className="auth-spinner" size={19} aria-hidden="true" />{mode === 'login' ? 'Memeriksa akun…' : 'Mengirim permintaan…'}</> : <>{mode === 'login' ? 'Masuk' : 'Daftar'}<ArrowRight size={18} aria-hidden="true" /></>}</button>
          <p className="auth-submit-hint">{mode === 'register' ? 'Setelah berhasil mendaftar, langsung masuk dengan email dan kata sandi Anda.' : 'Akses ruang kerja mengikuti aktivasi dan penugasan dari admin.'}</p>
        </form>
        {mode === 'login' && <button type="button" className="button quiet auth-forgot" disabled={busy} onClick={() => setRecoveryOpen(true)}>Lupa kata sandi?</button>}

      </>}
    </div>
  </section></main>;
}
