/**
 * Sign-in gate for the public website. Each player has an account (email + password);
 * once signed in their progress syncs to Supabase and the app opens with their own data.
 */
import { createContext, FormEvent, ReactNode, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, supabaseBackend } from '../../storage/supabaseBackend';
import { connectBackend, disconnectBackend, clearLocalPlayerData } from '../../storage/cloudSync';

interface Account {
  email: string;
  signOut: () => Promise<void>;
}

export const AccountContext = createContext<Account | null>(null);
export const useAccount = () => useContext(AccountContext);

const siteUrl = () => window.location.origin + import.meta.env.BASE_URL;

function hebrewError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'המייל או הסיסמה לא נכונים.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'כבר קיים חשבון עם המייל הזה. עבור ל"כניסה".';
  if (m.includes('password should be at least') || m.includes('weak')) return 'הסיסמה קצרה מדי. בחר סיסמה של 8 תווים לפחות.';
  if (m.includes('email not confirmed')) return 'צריך לאשר את המייל קודם. חפש בתיבת הדואר מייל מ-Supabase ולחץ על הקישור.';
  if (m.includes('invalid email') || m.includes('unable to validate email')) return 'כתובת המייל לא תקינה.';
  if (m.includes('rate limit') || m.includes('security purposes')) return 'יותר מדי ניסיונות. חכה דקה ונסה שוב.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'אין חיבור לשרת. בדוק את האינטרנט ונסה שוב.';
  return `משהו השתבש: ${message}`;
}

type Mode = 'signin' | 'signup' | 'forgot' | 'recovery';

function AuthScreen({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const sb = supabase();
    try {
      if (mode === 'signin') {
        const { error: err } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (err) setError(hebrewError(err.message));
      } else if (mode === 'signup') {
        const { data, error: err } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: siteUrl() } });
        if (err) setError(hebrewError(err.message));
        else if (!data.session) setNotice(`נשלח מייל אישור ל-${email.trim()}. לחץ על הקישור במייל, ואז חזור לכאן והיכנס.`);
      } else if (mode === 'forgot') {
        const { error: err } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: siteUrl() });
        if (err) setError(hebrewError(err.message));
        else setNotice('אם קיים חשבון עם המייל הזה, נשלח אליו קישור לבחירת סיסמה חדשה.');
      } else {
        const { error: err } = await sb.auth.updateUser({ password });
        if (err) setError(hebrewError(err.message));
        else {
          setNotice('הסיסמה עודכנה.');
          setMode('signin');
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const title = { signin: 'כניסה', signup: 'הרשמה', forgot: 'שכחתי סיסמה', recovery: 'סיסמה חדשה' }[mode];
  const cta = { signin: 'היכנס ▸', signup: 'צור חשבון ▸', forgot: 'שלח קישור', recovery: 'שמור סיסמה' }[mode];

  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <span className="brand__suit">♠</span>
          <div>
            <div className="brand__name">Poker Trainer</div>
            <div className="brand__tag">מאמן אישי ל-Texas Hold'em</div>
          </div>
        </div>
        {(mode === 'signin' || mode === 'signup') && (
          <div className="seg auth__tabs" role="tablist">
            <button type="button" className={mode === 'signin' ? 'on' : ''} onClick={() => { setMode('signin'); setError(null); setNotice(null); }}>כניסה</button>
            <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setError(null); setNotice(null); }}>הרשמה</button>
          </div>
        )}
        {(mode === 'forgot' || mode === 'recovery') && <h2>{title}</h2>}
        <p className="muted small">
          {mode === 'signup' && 'לכל שחקן חשבון משלו. ההתקדמות שלך נשמרת בחשבון ומסונכרנת בין המחשב לנייד.'}
          {mode === 'signin' && 'היכנס כדי להמשיך מאיפה שעצרת, בכל מכשיר.'}
          {mode === 'forgot' && 'נשלח לך מייל עם קישור לבחירת סיסמה חדשה.'}
          {mode === 'recovery' && 'בחר סיסמה חדשה לחשבון.'}
        </p>
        <form className="auth__form" onSubmit={submit}>
          {mode !== 'recovery' && (
            <label htmlFor="auth-email">
              מייל
              <input id="auth-email" type="email" autoComplete="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          )}
          {mode !== 'forgot' && (
            <label htmlFor="auth-password">
              סיסמה
              <input
                id="auth-password"
                type="password"
                dir="ltr"
                required
                minLength={mode === 'signin' ? 1 : 8}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {mode !== 'signin' && <span className="muted small">לפחות 8 תווים</span>}
            </label>
          )}
          {error && <p className="auth__error" role="alert">{error}</p>}
          {notice && <p className="auth__notice" role="status">{notice}</p>}
          <button className="btn-primary btn-lg" type="submit" disabled={busy}>{busy ? 'רגע…' : cta}</button>
        </form>
        {mode === 'signin' && <button type="button" className="link-btn" onClick={() => { setMode('forgot'); setError(null); setNotice(null); }}>שכחתי סיסמה</button>}
        {(mode === 'forgot' || mode === 'recovery') && <button type="button" className="link-btn" onClick={() => setMode('signin')}>◂ חזרה לכניסה</button>}
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('signin');

  useEffect(() => {
    const sb = supabase();
    void sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setMode('recovery');
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void connectBackend(supabaseBackend(supabase(), userId), userId).finally(() => {
      if (!cancelled) setReadyFor(userId);
    });
    return () => { cancelled = true; };
  }, [userId]);

  if (session === undefined) return <div className="boot">♠ טוען את Poker Trainer…</div>;
  if (!session || mode === 'recovery') return <AuthScreen mode={mode} setMode={setMode} />;
  if (readyFor !== session.user.id) return <div className="boot">♠ טוען את ההתקדמות שלך…</div>;

  const account: Account = {
    email: session.user.email ?? '',
    signOut: async () => {
      await disconnectBackend();
      await supabase().auth.signOut();
      clearLocalPlayerData();
      setReadyFor(null);
    },
  };
  return (
    <AccountContext.Provider value={account}>
      {/* Remount the app per player so it reads that player's data from scratch. */}
      <div key={session.user.id} style={{ display: 'contents' }}>{children}</div>
    </AccountContext.Provider>
  );
}
