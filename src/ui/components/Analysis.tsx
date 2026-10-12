import { useState } from 'react';
import { DecisionAnalysis, Level, Grade } from '../../coach';
import { streetHe } from '../../training/stats';

const STAMP: Record<Grade, { he: string; en: string }> = {
  good: { he: 'טובה', en: 'GOOD' },
  ok: { he: 'סבירה', en: 'OK' },
  mistake: { he: 'שגויה', en: 'MISTAKE' },
};

export function AnalysisBody({ a, level, showAll }: { a: DecisionAnalysis; level: Level; showAll?: boolean }) {
  const [advanced, setAdvanced] = useState(!!showAll || level === 4);
  const visible = a.sections.filter((s) => advanced || s.minLevel <= level);
  const hidden = a.sections.length - visible.length;
  return (
    <div className="analysis">
      <div className="analysis__head">
        <div className={`stamp stamp--${a.grade}`}>
          <span>{STAMP[a.grade].en}</span>
          <small>החלטה {STAMP[a.grade].he}</small>
        </div>
        <div>
          <div className="analysis__street">{streetHe[a.street]} · יד #{a.handNumber}</div>
          <div className="analysis__did">עשית: <strong>{a.actionLabel}</strong></div>
          <p className="analysis__verdict">{a.verdictText}</p>
        </div>
      </div>

      <div className="analysis__rec">
        <div className="analysis__rec-label">
          {a.close ? 'החלטה גבולית — הפעולה העדיפה מעט' : 'הפעולה המומלצת'}: <strong>{a.recommendedLabel}</strong>
        </div>
        <p>{a.recommendedText}</p>
      </div>

      {a.alternatives.length > 0 && (
        <div className="analysis__alts">
          <h4>החלופות</h4>
          {a.alternatives.map((alt) => (
            <div key={alt.label} className="alt">
              <span className={`dot dot--${alt.verdict}`} />
              <div><strong>{alt.label}</strong> — <span className="muted">{STAMP[alt.verdict].he}.</span> {alt.text}</div>
            </div>
          ))}
        </div>
      )}

      {visible.map((s) => (
        <details key={s.id} className="analysis__sec" open>
          <summary>{s.title}</summary>
          {s.lines.map((line, i) => <p key={i} className={line.startsWith('   ') ? 'indent' : ''}>{line.trim()}</p>)}
        </details>
      ))}
      {hidden > 0 && (
        <button className="link-btn" onClick={() => setAdvanced(true)}>
          הצג עוד {hidden} נושאים מתקדמים (מרמות גבוהות יותר)
        </button>
      )}
    </div>
  );
}

export function AnalysisModal({ a, level, onClose }: { a: DecisionAnalysis; level: Level; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet sheet--paper" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ניתוח ההחלטה">
        <div className="sheet__title">
          <h2>ניתוח ההחלטה · Analysis</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגור">✕</button>
        </div>
        <AnalysisBody a={a} level={level} />
        <div className="sheet__footer">
          <button className="btn-primary" onClick={onClose}>הבנתי, ממשיכים ▸</button>
        </div>
      </div>
    </div>
  );
}
