import { useRef, useState } from 'react';
import { BrandLogo } from './BrandLogo';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordRecovery({ token, initialError, onBack, onTokenClear }: { token: string; initialError: string; onBack: () => void; onTokenClear: () => void }) {
    const recoveryToken = useRef(token);
    const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
    const [show, setShow] = useState(false), [busy, setBusy] = useState(false), [done, setDone] = useState(false), [error, setError] = useState(initialError), [message, setMessage] = useState('');
    const setting = !!recoveryToken.current && !done;
    const feedback = useRef<HTMLParagraphElement>(null);
    const fail = (text: string) => { setError(text); requestAnimationFrame(() => feedback.current?.focus()); };
    async function submit(event: React.FormEvent) {
        event.preventDefault(); if (busy) return; setError(''); setMessage('');
        if (setting && password !== confirm) { fail('Kedua kata sandi belum sama. Periksa konfirmasi kata sandi.'); return; }
        setBusy(true);
        try {
            const response = await fetch(setting ? '/api/auth/password/recover' : '/api/auth/password/reset', { method: 'POST', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json', ...(setting ? { Authorization: `Bearer ${recoveryToken.current}` } : {}) }, body: JSON.stringify(setting ? { password } : { email: email.trim() }) });
            const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
            if (!response.ok) { if (result.error?.code === 'RECOVERY_EXPIRED') { recoveryToken.current = ''; onTokenClear(); setPassword(''); setConfirm(''); } throw new Error(result.error?.message || 'Permintaan belum berhasil. Coba lagi sebentar.'); }
            if (setting) { recoveryToken.current = ''; onTokenClear(); setPassword(''); setConfirm(''); setDone(true); setMessage('Kata sandi berhasil diperbarui. Silakan masuk dengan kata sandi baru.'); }
            else setMessage(result.message || 'Permintaan diterima. Periksa inbox dan spam untuk tautan pemulihan terbaru.');
        } catch (e) { fail(e instanceof DOMException && ['TimeoutError', 'AbortError'].includes(e.name) ? 'Layanan belum merespons. Coba lagi sebentar.' : e instanceof TypeError ? 'Koneksi terputus. Periksa jaringan lalu coba lagi.' : e instanceof Error ? e.message : 'Koneksi terputus. Coba lagi sebentar.'); }
        finally { setBusy(false); }
    }
    return <main className="auth-page"><section className="card auth-card" aria-label="Pemulihan kata sandi"><div className="auth-main">
        <div className="auth-brand"><BrandLogo /><span>SIGAP <small>Pemulihan akun</small></span></div>
        <header className="auth-heading"><h1>{done ? 'Kata sandi diperbarui' : setting ? 'Buat kata sandi baru' : 'Lupa kata sandi?'}</h1><p>{setting ? 'Tentukan kata sandi baru untuk akun dari tautan email ini.' : 'Gunakan email pendaftaran Anda. Kami akan meminta layanan email mengirim tautan pemulihan.'}</p></header>
        {error && <p ref={feedback} tabIndex={-1} className="auth-feedback is-error" role="alert">{error}</p>}
        {message && <p className="auth-feedback is-info" role="status">{message}</p>}
        {!done && <form onSubmit={submit} aria-label={setting ? 'Form kata sandi baru' : 'Form pemulihan akun'} aria-busy={busy}>
            {setting ? <><div className="auth-field"><label htmlFor="recovery-password">Kata sandi baru</label><div className="auth-password-wrap"><input id="recovery-password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} aria-describedby="recovery-password-help" /><button type="button" className="auth-password-toggle" aria-label={show ? 'Sembunyikan kata sandi baru' : 'Tampilkan kata sandi baru'} aria-pressed={show} onClick={() => setShow(!show)} disabled={busy}>{show ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}</button></div><p id="recovery-password-help" className="auth-hint">Minimal 8 karakter. Gunakan kata sandi yang tidak dipakai di akun lain.</p></div><div className="auth-field"><label htmlFor="recovery-confirm">Konfirmasi kata sandi baru</label><input id="recovery-confirm" type={show ? 'text' : 'password'} value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" disabled={busy} /></div></> : <div className="auth-field"><label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" required maxLength={254} autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} disabled={busy} /></div>}
            <button className="button primary auth-submit" disabled={busy}>{busy ? 'Memproses…' : setting ? 'Simpan kata sandi baru' : 'Kirim tautan pemulihan'}</button>
        </form>}
        <button type="button" className="button secondary" disabled={busy} onClick={() => { recoveryToken.current = ''; onBack(); }}>Kembali ke halaman masuk</button>
    </div></section></main>;
}
