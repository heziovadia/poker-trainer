import { ReactNode, useState } from 'react';
import { GameState } from '../../engine/game';
import { DecisionAnalysis, Level, TOPIC_HE, MISTAKE_HE, MistakeTag, Topic } from '../../coach';
import { Stats, TrainingReport, topicAccuracy, buildReport, streetHe } from '../../training/stats';
import { HandRecord } from '../../training/history';
import { Preferences } from '../../storage/repository';
import { CardRow } from './PlayingCard';
import { AnalysisBody } from './Analysis';
import { HERO_ID } from '../useTrainer';
import { profileOf } from '../../bots/profiles';
import { LevelProgress, LEVEL_NAMES } from '../../training/progress';
import { useAccount } from './Auth';

export function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`sheet ${wide ? 'sheet--wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="sheet__title">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- hand end

export function HandEnd({ game, decisions, level, fourColor, onNext }: {
  game: GameState; decisions: DecisionAnalysis[]; level: Level; fourColor: boolean; onNext: () => void;
}) {
  const [open, setOpen] = useState(level === 4 && decisions.length > 0);
  const r = game.result!;
  const net = r.net[HERO_ID] ?? 0;
  const name = (id: string) => game.players.find((p) => p.id === id)?.name ?? id;
  const winners = [...new Set(r.pots.flatMap((p) => p.winners))];
  const grades = decisions.reduce((acc, d) => ({ ...acc, [d.grade]: (acc[d.grade] ?? 0) + 1 }), {} as Record<string, number>);
  return (
    <div className="hand-end">
      <div className="hand-end__main">
        <div className={`hand-end__net ${net > 0 ? 'up' : net < 0 ? 'down' : ''}`}>{net > 0 ? `+${net}` : net}</div>
        <div>
          <div className="hand-end__title">
            {winners.map(name).join(', ')} {winners.length > 1 ? 'מתחלקים בקופה' : 'זוכה בקופה'} ({r.pots.reduce((s, p) => s + p.amount, 0)})
          </div>
          <div className="hand-end__sub">
            {r.showdown ? `Showdown — ${r.pots[0].winningHand}` : 'כל השאר ויתרו (ללא Showdown)'}
            {r.pots.length > 1 && ` · ${r.pots.map((p, i) => `${i === 0 ? 'קופה ראשית' : `Side Pot ${i}`} ${p.amount} → ${p.winners.map(name).join(', ')}`).join(' · ')}`}
          </div>
          {decisions.length > 0 && (
            <div className="hand-end__grades">
              ההחלטות שלך ביד: {grades.good ?? 0} ✅ · {grades.ok ?? 0} 🟡 · {grades.mistake ?? 0} ❌
            </div>
          )}
        </div>
      </div>
      <div className="hand-end__actions">
        {decisions.length > 0 && <button className="btn-ghost" onClick={() => setOpen(true)}>{level === 4 ? 'ניתוח מלא של היד' : 'ניתוחי היד'}</button>}
        <button className="btn-primary" onClick={onNext} autoFocus>יד הבאה ▸</button>
      </div>
      {open && (
        <Drawer title={`ניתוח יד #${game.handNumber}`} onClose={() => setOpen(false)} wide>
          <div className="mini-board">לוח: <CardRow cards={game.board} fourColor={fourColor} /> · הקלפים שלך: <CardRow cards={game.players.find((p) => p.id === HERO_ID)!.hole} fourColor={fourColor} /></div>
          {decisions.map((d) => <div key={d.id} className="paper-block"><AnalysisBody a={d} level={4} showAll /></div>)}
        </Drawer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- history

export function HistoryPanel({ history, onStar, onClose, fourColor }: { history: HandRecord[]; onStar: (id: string) => void; onClose: () => void; fourColor: boolean }) {
  const [filter, setFilter] = useState<'all' | 'starred'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = history.filter((h) => filter === 'all' || h.starred);
  const open = history.find((h) => h.id === openId);
  return (
    <Drawer title="היסטוריית ידיים · Hand History" onClose={onClose} wide>
      {open ? (
        <div className="hist-detail">
          <button className="link-btn" onClick={() => setOpenId(null)}>◂ חזרה לרשימה</button>
          <div className="hist-detail__head">
            <h3>יד #{open.handNumber} · {new Date(open.timestamp).toLocaleString('he-IL')}</h3>
            <button className={`star ${open.starred ? 'star--on' : ''}`} onClick={() => onStar(open.id)}>{open.starred ? '★ מסומנת' : '☆ סמן בכוכב'}</button>
          </div>
          <div className="hist-detail__cards">
            <div>Hole Cards ({open.heroPosition}): <CardRow cards={open.heroHole} size="md" fourColor={fourColor} /></div>
            <div>Board: {open.board.length ? <CardRow cards={open.board} size="md" fourColor={fourColor} /> : '—'}</div>
          </div>
          <div className="hist-detail__res">
            {open.winners.join(', ')} זכה/זכו ב-{open.potTotal} {open.showdown && open.winningHand ? `עם ${open.winningHand}` : '(ללא Showdown)'}. התוצאה שלך: <strong className={open.heroNet >= 0 ? 'up' : 'down'}>{open.heroNet > 0 ? '+' : ''}{open.heroNet}</strong>
          </div>
          {open.streets.map((st) => (
            <div key={st.street} className="hist-street">
              <div className="hist-street__head">
                <strong>{streetHe[st.street]}</strong>
                <span className="muted">Pot בתחילת הרחוב: {st.potStart}</span>
                {st.board.length > 0 && <CardRow cards={st.board} fourColor={fourColor} />}
              </div>
              <ol>
                {st.actions.map((a, i) => (
                  <li key={i} className={a.isHero ? 'hero-line' : ''}>
                    {a.name}: {a.action}{a.amount ? ` ${a.amount}` : ''}{a.allIn ? ' (All-in)' : ''}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {open.players.some((p) => p.shownHole && p.id !== HERO_ID) && (
            <div className="hist-street">
              <strong>Showdown</strong>
              <ul>
                {open.players.filter((p) => p.shownHole && p.id !== HERO_ID).map((p) => (
                  <li key={p.id}>{p.name} ({p.profile ? profileOf(p.profile).en : ''}): <CardRow cards={p.shownHole!} fourColor={fourColor} /> {p.handName}</li>
                ))}
              </ul>
            </div>
          )}
          <h3>ההחלטות שלך והניתוח שקיבלת</h3>
          {open.decisions.length === 0 && <p className="muted">לא היו החלטות ביד הזו (ויתרת או שלא הגיע תורך).</p>}
          {open.decisions.map((d) => <div key={d.id} className="paper-block"><AnalysisBody a={d} level={4} showAll /></div>)}
        </div>
      ) : (
        <>
          <div className="seg">
            <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>הכול ({history.length})</button>
            <button className={filter === 'starred' ? 'on' : ''} onClick={() => setFilter('starred')}>★ מסומנות ({history.filter((h) => h.starred).length})</button>
          </div>
          {list.length === 0 && <p className="muted">אין עדיין ידיים להצגה.</p>}
          <ul className="hist-list">
            {list.map((h) => {
              const mistakes = h.decisions.filter((d) => d.grade === 'mistake').length;
              return (
                <li key={h.id} className="hist-row" onClick={() => setOpenId(h.id)}>
                  <button className={`star ${h.starred ? 'star--on' : ''}`} onClick={(e) => { e.stopPropagation(); onStar(h.id); }} aria-label="סמן בכוכב">{h.starred ? '★' : '☆'}</button>
                  <span className="hist-row__num">#{h.handNumber}</span>
                  <CardRow cards={h.heroHole} fourColor={fourColor} />
                  <span className="hist-row__pos">{h.heroPosition}</span>
                  <span className="hist-row__board">{h.board.length ? <CardRow cards={h.board} fourColor={fourColor} /> : <span className="muted">ללא פלופ</span>}</span>
                  <span className={`hist-row__net ${h.heroNet > 0 ? 'up' : h.heroNet < 0 ? 'down' : ''}`}>{h.heroNet > 0 ? '+' : ''}{h.heroNet}</span>
                  {mistakes > 0 && <span className="hist-row__mist">{mistakes} ❌</span>}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------- stats

function StatGrid({ s }: { s: Stats }) {
  const dec = s.preflopDecisions + s.postflopDecisions;
  const items: [string, string | number][] = [
    ['ידיים ששיחקת', s.hands],
    ['Win Rate (אימון)', s.hands ? `${Math.round((s.handsWon / s.hands) * 100)}% (${s.handsWon} ÷ ${s.hands})` : '—'],
    ['תוצאה נטו', `${s.netBB >= 0 ? '+' : ''}${s.netBB.toFixed(1)} BB`],
    ['Preflop decisions', s.preflopDecisions],
    ['Postflop decisions', s.postflopDecisions],
    ['החלטות טובות/סבירות', dec ? `${Math.round(((s.grades.good + s.grades.ok) / dec) * 100)}% ((${s.grades.good}+${s.grades.ok}) ÷ ${dec})` : '—'],
    ['Pot Odds mistakes', s.mistakes.potOdds],
    ['Bet sizing mistakes', s.mistakes.betSizing],
    ['Position mistakes', s.mistakes.position],
    ['Calls', s.actions.call],
    ['Folds', s.actions.fold],
    ['Raises + Bets', s.actions.raise + s.actions.bet],
    ['Checks', s.actions.check],
    ['Value Bets', s.valueBets],
    ['Bluffs', s.bluffs],
    ['Semi-Bluffs', s.semiBluffs],
  ];
  return (
    <div className="stat-grid">
      {items.map(([k, v]) => (
        <div key={k} className="stat"><span className="stat__v">{v}</span><span className="stat__k">{k}</span></div>
      ))}
    </div>
  );
}

function TopicBars({ s }: { s: Stats }) {
  const acc = topicAccuracy(s);
  const topics = (Object.keys(acc) as Topic[]).filter((t) => acc[t].samples > 0).sort((a, b) => acc[b].acc - acc[a].acc);
  if (!topics.length) return <p className="muted">עוד אין מספיק נתונים לפי נושא.</p>;
  return (
    <div className="topic-bars">
      {topics.map((t) => (
        <div key={t} className="topic-bar">
          <span className="topic-bar__name">{TOPIC_HE[t]}</span>
          <span className="topic-bar__track"><span style={{ width: `${acc[t].acc * 100}%` }} className={acc[t].acc < 0.55 ? 'weak' : acc[t].acc > 0.75 ? 'strong' : ''} /></span>
          <span className="topic-bar__pct">{Math.round(acc[t].acc * 100)}% <small>({acc[t].samples})</small></span>
        </div>
      ))}
      <p className="muted small">הציון לכל נושא = (תשובות נכונות + 1) ÷ (ניסיונות + 2) — כך מעט נתונים לא נותנים 0% או 100% מטעים.</p>
    </div>
  );
}

export function ProgressCard({ p, name, onGoNext }: { p: LevelProgress; name: string; onGoNext?: () => void }) {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <div className={`progress-card ${p.ready ? 'progress-card--ready' : ''}`}>
      <div className="progress-card__head">
        <strong>{LEVEL_NAMES[p.level]}</strong>
        <span className="muted small">{p.hands} ידיים ברמה הזו</span>
      </div>
      {p.next ? (
        <>
          <div className="progress-bar"><span style={{ width: pct(p.completion) }} /></div>
          <ul className="criteria">
            {p.criteria.map((c) => (
              <li key={c.label} className={c.met ? 'met' : ''}>
                <span className="criteria__icon">{c.met ? '✓' : '○'}</span>
                <span>{c.label}</span>
                <span className="criteria__detail">{c.detail}</span>
              </li>
            ))}
          </ul>
          {p.ready ? (
            <div className="progress-card__ready">
              <span>🎓 {name}, עמדת בכל הקריטריונים — מומלץ לעבור ל{LEVEL_NAMES[p.next]}.</span>
              {onGoNext && <button className="btn-primary btn-sm" onClick={onGoNext}>עבור לרמה {p.next} ▸</button>}
            </div>
          ) : (
            <p className="muted small">כשכל הסעיפים יסומנו ✓ אגיד לך שהגיע הזמן לעלות רמה. המדידה היא על ההחלטות האחרונות, כך שטעויות מההתחלה לא מעכבות אותך.</p>
          )}
        </>
      ) : (
        <p className="muted small">זו הרמה הגבוהה ביותר. המטרה כאן: להחזיק אחוז גבוה של החלטות טובות בלי עזרה.</p>
      )}
      {p.improvement && (
        <p className="progress-card__impr">
          {p.improvement.to - p.improvement.from >= 0.05 ? '📈 השתפרת: ' : p.improvement.to - p.improvement.from <= -0.05 ? '📉 ירידה קלה: ' : '➖ יציב: '}
          החלטות טובות או סבירות — {pct(p.improvement.from)} ({Math.round(p.improvement.from * p.improvement.fromN)} ÷ {p.improvement.fromN} הראשונות ברמה) ← {pct(p.improvement.to)} ({Math.round(p.improvement.to * p.improvement.toN)} ÷ {p.improvement.toN} האחרונות).
        </p>
      )}
    </div>
  );
}

export function StatsPanel({ session, lifetime, adaptiveTopic, onClose, progress, name, onGoNext }: {
  session: Stats; lifetime: Stats; adaptiveTopic: Topic | null; onClose: () => void; progress: LevelProgress; name: string; onGoNext: () => void;
}) {
  const [tab, setTab] = useState<'session' | 'lifetime'>('session');
  const s = tab === 'session' ? session : lifetime;
  const rep = buildReport(s);
  const mistakes = (Object.entries(s.mistakes) as [MistakeTag, number][]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  return (
    <Drawer title="סטטיסטיקה ואימון" onClose={onClose} wide>
      <div className="seg">
        <button className={tab === 'session' ? 'on' : ''} onClick={() => setTab('session')}>Session נוכחי</button>
        <button className={tab === 'lifetime' ? 'on' : ''} onClick={() => setTab('lifetime')}>מאז ההתחלה</button>
      </div>
      <h3 style={{ marginTop: 0 }}>ההתקדמות שלך</h3>
      <ProgressCard p={progress} name={name} onGoNext={onGoNext} />
      <h3>מספרים</h3>
      <StatGrid s={s} />
      <h3>חוזק לפי נושא</h3>
      <TopicBars s={s} />
      {mistakes.length > 0 && (
        <>
          <h3>טעויות לפי סוג</h3>
          <ul className="mistake-list">{mistakes.map(([k, n]) => <li key={k}><span>{MISTAKE_HE[k]}</span><strong>{n}</strong></li>)}</ul>
        </>
      )}
      <h3>אימון אדפטיבי</h3>
      <p className="muted">
        המערכת שואלת יותר שאלות בנושאים שבהם אתה מתקשה, ופחות בנושאים שאתה כבר שולט בהם. מדי פעם היא גם מחלקת לך ידיים שמובילות למצבים בנושא החלש ביותר.
        {adaptiveTopic && <> ביד הנוכחית: <strong>{TOPIC_HE[adaptiveTopic]}</strong>.</>}
      </p>
      <h3>Training Report</h3>
      <ReportLines rep={rep} />
    </Drawer>
  );
}

function ReportLines({ rep }: { rep: TrainingReport }) {
  return <ul className="report">{rep.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>;
}

export function ReportModal({ rep, onNewSession, onClose }: { rep: TrainingReport; onNewSession: () => void; onClose: () => void }) {
  return (
    <Drawer title="Training Report — סיכום ה-Session" onClose={onClose}>
      {rep.hands === 0 ? <p className="muted">עוד לא שיחקת ידיים ב-Session הזה.</p> : <ReportLines rep={rep} />}
      <div className="sheet__footer">
        <button className="btn-ghost" onClick={onClose}>המשך לשחק באותו Session</button>
        <button className="btn-primary" onClick={onNewSession}>התחל Session חדש</button>
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------- settings

export function SettingsPanel({ prefs, onChange, onReset, onClose, onBackup, onRestore, hands }: {
  prefs: Preferences; onChange: (p: Partial<Preferences>) => void; onReset: () => void; onClose: () => void;
  onBackup: () => void; onRestore: (f: File) => Promise<string | null>; hands: number;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const account = useAccount();
  const [signingOut, setSigningOut] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  return (
    <Drawer title="הגדרות" onClose={onClose}>
      {account && (
        <div className="setting">
          <span>מחובר כ-<strong dir="ltr">{account.email}</strong> · ההתקדמות נשמרת בחשבון</span>
          <button className="btn-ghost btn-sm" disabled={signingOut} onClick={async () => { setSigningOut(true); await account.signOut(); }}>{signingOut ? 'מתנתק…' : 'התנתק'}</button>
        </div>
      )}
      <label className="setting">
        <span>השם שלך</span>
        <input className="name-input" type="text" value={prefs.playerName} maxLength={16} onChange={(e) => onChange({ playerName: e.target.value })} />
      </label>
      <label className="setting">
        <span>מהירות היריבים</span>
        <select value={prefs.botDelayMs} onChange={(e) => onChange({ botDelayMs: Number(e.target.value) })}>
          <option value={1200}>איטי</option>
          <option value={700}>רגיל</option>
          <option value={300}>מהיר</option>
          <option value={60}>מהיר מאוד</option>
        </select>
      </label>
      <label className="setting">
        <span>חפיסה ב-4 צבעים (♦ כחול, ♣ ירוק) — קל יותר לזהות Flush</span>
        <input type="checkbox" checked={prefs.fourColorDeck} onChange={(e) => onChange({ fourColorDeck: e.target.checked })} />
      </label>
      <label className="setting">
        <span>שאלות אימון לפני החלטות (רמות 1–3)</span>
        <input type="checkbox" checked={prefs.quizzes} onChange={(e) => onChange({ quizzes: e.target.checked })} />
      </label>
      <label className="setting">
        <span>חלוקה אדפטיבית — יותר ידיים בנושאים החלשים שלך</span>
        <input type="checkbox" checked={prefs.adaptive} onChange={(e) => onChange({ adaptive: e.target.checked })} />
      </label>
      <div className="backup">
        <div className="backup__title">💾 גיבוי ושחזור</div>
        <p className="muted small">שומר את כל הנתונים שלך ({hands} ידיים, סטטיסטיקה, היסטוריה והעדפות) לקובץ במחשב. מומלץ לגבות מדי פעם — וכדאי לשמור את הקובץ ב-Google Drive.</p>
        <div className="backup__row">
          <button className="btn-primary btn-sm" onClick={onBackup}>הורד קובץ גיבוי</button>
          <label className="btn-ghost btn-sm backup__pick">
            שחזר מקובץ…
            <input type="file" accept="application/json,.json" hidden onChange={(e) => { setRestoreError(null); setPendingFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </label>
        </div>
        {pendingFile && (
          <div className="backup__confirm">
            <span>לשחזר מ-<strong>{pendingFile.name}</strong>? הנתונים הנוכחיים יוחלפו בנתונים מהקובץ.</span>
            <button className="btn-danger btn-sm" onClick={async () => { const err = await onRestore(pendingFile); if (err) { setRestoreError(err); setPendingFile(null); } }}>כן, לשחזר</button>
            <button className="btn-ghost btn-sm" onClick={() => setPendingFile(null)}>ביטול</button>
          </div>
        )}
        {restoreError && <p className="backup__error">{restoreError}</p>}
      </div>
      <div className="setting setting--danger">
        <span>מחיקת כל הנתונים (סטטיסטיקה, היסטוריה, העדפות)</span>
        {confirm
          ? <button className="btn-danger" onClick={() => { onReset(); setConfirm(false); onClose(); }}>כן, למחוק הכול</button>
          : <button className="btn-ghost" onClick={() => setConfirm(true)}>איפוס…</button>}
      </div>
      <p className="muted small">כל הנתונים נשמרים רק בדפדפן הזה (localStorage). אין שרת ואין כסף אמיתי.</p>
    </Drawer>
  );
}
