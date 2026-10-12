import { useState } from 'react';
import { useTrainer, HERO_ID } from './useTrainer';
import { Table } from './components/Table';
import { ActionBar } from './components/ActionBar';
import { PlayingCard } from './components/PlayingCard';
import { AnalysisModal } from './components/Analysis';
import { QuizCard, ThinkPanel } from './components/Coaching';
import { HandEnd, HistoryPanel, StatsPanel, SettingsPanel, ReportModal } from './components/Panels';
import { Level } from '../coach';
import { LEVEL_NAMES } from '../training/progress';
import { SyncBadge } from './components/SyncBadge';

const LEVELS: { id: Level; title: string; sub: string }[] = [
  { id: 1, title: 'רמה 1', sub: 'זיהוי ידיים · לוח · Draws' },
  { id: 2, title: 'רמה 2', sub: 'Position · Outs · Pot Odds · Sizing' },
  { id: 3, title: 'רמה 3', sub: 'Ranges · Value/Bluff · Texture' },
  { id: 4, title: 'רמה 4', sub: 'Real Play — ניתוח רק בסוף היד' },
];

type Panel = 'history' | 'stats' | 'settings' | null;

export function App() {
  const t = useTrainer();
  const [panel, setPanel] = useState<Panel>(null);
  const [thinking, setThinking] = useState(false);
  const [dismissedLevel, setDismissedLevel] = useState<Level | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const name = t.prefs.playerName || 'אתה';
  const goNext = () => { if (t.progress.next) { t.updatePrefs({ level: t.progress.next }); setPanel(null); } };
  const { game, view, prefs, level } = t;
  const hero = game.players.find((p) => p.id === HERO_ID)!;
  const blocked = (!!t.quiz && level < 4) || thinking || t.analyzing;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand__suit">♠</span>
          <div>
            <div className="brand__name">Poker Trainer</div>
            <div className="brand__tag">מאמן אישי ל-Texas Hold'em</div>
          </div>
        </div>
        <nav className="levels" aria-label="רמת לימוד">
          {LEVELS.map((l) => (
            <button key={l.id} className={`level ${level === l.id ? 'level--on' : ''}`} onClick={() => t.updatePrefs({ level: l.id })} title={l.sub}>
              <span className="level__t">{l.title}</span>
              <span className="level__s">{l.sub}</span>
            </button>
          ))}
        </nav>
        <div className="topbar__nav">
          <SyncBadge />
          <button className="nav-btn" onClick={() => setPanel('history')}>📜 <span>היסטוריה</span></button>
          <button className="nav-btn" onClick={() => setPanel('stats')}>📊 <span>סטטיסטיקה</span></button>
          <button className="nav-btn" onClick={() => setPanel('settings')}>⚙️ <span>הגדרות</span></button>
          <button className="nav-btn nav-btn--accent" onClick={t.endSession}>🏁 <span>סיום Session</span></button>
        </div>
      </header>

      <main className="main">
        <Table game={game} fourColor={prefs.fourColorDeck} />

        <section className="dock">
          {game.handNumber === 0 ? (
            <div className="welcome">
              {!prefs.playerName.trim() ? (
                <form className="name-form" onSubmit={(e) => { e.preventDefault(); const v = nameDraft.trim(); if (v) t.updatePrefs({ playerName: v }); }}>
                  <h1>ברוך הבא לשולחן.</h1>
                  <label htmlFor="player-name">איך קוראים לך? כך אזהה אותך, וההתקדמות שלך תישמר בנפרד.</label>
                  <div className="name-form__row">
                    <input id="player-name" className="name-input" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={16} placeholder="השם שלך" autoFocus />
                    <button className="btn-primary" type="submit" disabled={!nameDraft.trim()}>שמור ▸</button>
                  </div>
                </form>
              ) : (
              <>
              <h1>ברוך הבא לשולחן, {name}.</h1>
              <p>
                אתה יושב מול חמישה יריבים עם סגנונות שונים. בכל יד <strong>אתה</strong> מחליט — אין טיימר, קח את הזמן.
                אחרי כל החלטה תקבל ניתוח: מה היה טוב, מה עדיף, ולמה — עם החישוב מאחורי כל אחוז.
              </p>
              <p className="muted">Blinds 1/2 · Stack התחלתי 200 (100 BB) · כסף מדומה בלבד.</p>
              <button className="btn-primary btn-lg" onClick={t.nextHand}>חלק יד ראשונה ▸</button>
              </>
              )}
            </div>
          ) : (
            <>
              <div className="hero-strip">
                <div className="hero-cards">
                  {hero.hole.map((c, i) => <PlayingCard key={`${game.handNumber}-${c}`} card={c} size="lg" fourColor={prefs.fourColorDeck} delay={i * 120} />)}
                </div>
                <div className="hero-info">
                  <Info label="הקופה · Pot" value={view?.pot ?? 0} big />
                  <Info label="ה-Stack שלך" value={hero.stack} big />
                  <Info label="לשלם ל-Call" value={view && !game.result ? view.toCall : 0} accent={!!view && view.toCall > 0 && t.heroToAct} />
                  <Info label="המיקום שלך" value={view?.myPosition ?? '—'} />
                  <Info label="Blinds" value={`${game.config.smallBlind}/${game.config.bigBlind}`} />
                  <Info label="רחוב" value={game.result ? 'סוף היד' : game.street[0].toUpperCase() + game.street.slice(1)} />
                </div>
              </div>

              {game.result ? (
                <>
                {t.progress.ready && t.progress.next && dismissedLevel !== level && (
                  <div className="levelup">
                    <div className="levelup__icon">🎓</div>
                    <div className="levelup__text">
                      <strong>{name}, אתה מוכן לשלב הבא!</strong>
                      <span>עמדת בכל הקריטריונים של רמה {level}. מומלץ לעבור ל{LEVEL_NAMES[t.progress.next]}.</span>
                    </div>
                    <div className="levelup__actions">
                      <button className="btn-ghost btn-sm" onClick={() => setPanel('stats')}>פירוט</button>
                      <button className="btn-ghost btn-sm" onClick={() => setDismissedLevel(level)}>אחר כך</button>
                      <button className="btn-primary btn-sm" onClick={goNext}>עבור לרמה {t.progress.next} ▸</button>
                    </div>
                  </div>
                )}
                <HandEnd game={game} decisions={t.handDecisions} level={level} fourColor={prefs.fourColorDeck} onNext={t.nextHand} />
                </>
              ) : (
                <>
                  {t.quiz && level < 4 && <QuizCard q={t.quiz} onAnswer={t.answerQuiz} onClose={t.closeQuiz} />}
                  {thinking && t.heroToAct && <ThinkPanel steps={t.thinkSteps} onClose={() => setThinking(false)} />}
                  {t.heroToAct && view && !t.quiz && !thinking && (
                    <div className="turn-row">
                      <span className="turn-pill">התור שלך — קח את הזמן</span>
                      {level < 4 && <button className="btn-think" onClick={() => setThinking(true)}>🧠 עזור לי לחשוב</button>}
                    </div>
                  )}
                  {!t.heroToAct && !t.analyzing && (
                    <div className="waiting">{hero.folded ? 'ויתרת על היד — צופים בהמשך…' : `${game.players[game.toAct]?.name ?? ''} חושב…`}</div>
                  )}
                  {t.analyzing && <div className="waiting">המאמן מנתח את ההחלטה שלך…</div>}
                  {view && t.heroToAct && <ActionBar view={view} enabled={!blocked} onAct={(d) => { setThinking(false); t.heroAct(d); }} />}
                </>
              )}
            </>
          )}
        </section>
      </main>

      {t.analysis && <AnalysisModal a={t.analysis} level={level} onClose={t.closeAnalysis} />}
      {panel === 'history' && <HistoryPanel history={t.history} onStar={t.toggleStar} onClose={() => setPanel(null)} fourColor={prefs.fourColorDeck} />}
      {panel === 'stats' && <StatsPanel session={t.session} lifetime={t.lifetime} adaptiveTopic={t.adaptiveTopic} onClose={() => setPanel(null)} progress={t.progress} name={name} onGoNext={goNext} />}
      {panel === 'settings' && <SettingsPanel prefs={prefs} onChange={t.updatePrefs} onReset={t.resetAll} onClose={() => setPanel(null)} onBackup={t.downloadBackup} onRestore={t.restoreBackup} hands={t.lifetime.hands} />}
      {t.report && <ReportModal rep={t.report} onNewSession={t.startNewSession} onClose={t.closeReport} />}
    </div>
  );
}

function Info({ label, value, big, accent }: { label: string; value: string | number; big?: boolean; accent?: boolean }) {
  return (
    <div className={`info ${big ? 'info--big' : ''} ${accent ? 'info--accent' : ''}`}>
      <span className="info__v">{typeof value === 'number' ? value.toLocaleString() : value}</span>
      <span className="info__k">{label}</span>
    </div>
  );
}
