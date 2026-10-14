import { useState } from 'react';
import { ThinkStep, TOPIC_HE } from '../../coach';
import { QuizState } from '../useTrainer';

export function QuizCard({ q, onAnswer, onClose }: { q: QuizState; onAnswer: (i: number) => void; onClose: () => void }) {
  const answered = q.answered !== null;
  const right = answered && q.quiz.options[q.answered!].correct;
  return (
    <div className="quiz">
      <div className="quiz__tag">שאלת אימון · {TOPIC_HE[q.quiz.topic]}</div>
      <div className="quiz__q">{q.quiz.question}</div>
      <div className="quiz__opts">
        {q.quiz.options.map((o, i) => {
          const state = !answered ? '' : o.correct ? 'opt--right' : i === q.answered ? 'opt--wrong' : 'opt--dim';
          return (
            <button key={o.label} className={`opt ${state}`} disabled={answered} onClick={() => onAnswer(i)}>{o.label}</button>
          );
        })}
      </div>
      {answered ? (
        <div className={`quiz__exp ${right ? 'quiz__exp--right' : 'quiz__exp--wrong'}`}>
          <div><strong>{right ? 'נכון! ' : 'לא בדיוק. '}</strong>{q.quiz.explanation}</div>
          {q.quiz.details && (
            <ul className="quiz__details">
              {q.quiz.details.map((d, i) => <li key={i}>{d}</li>)}
            </ul>
          )}
          <button className="btn-primary btn-sm" onClick={onClose}>עכשיו תחליט על הפעולה ▸</button>
        </div>
      ) : (
        <button className="link-btn" onClick={onClose}>דלג על השאלה</button>
      )}
    </div>
  );
}

export function ThinkPanel({ steps, onClose }: { steps: ThinkStep[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [notes, setNotes] = useState<string[]>([]);
  const [showHint, setShowHint] = useState(false);
  const step = steps[i];
  if (!step) return null;
  return (
    <div className="think">
      <div className="think__head">
        <span className="think__badge">🧠 עזור לי לחשוב</span>
        <span className="think__count">שאלה {i + 1} מתוך {steps.length}</span>
        <button className="icon-btn" onClick={onClose} aria-label="סגור">✕</button>
      </div>
      <div className="think__progress"><span style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>
      <div className="think__q">{step.question}</div>
      <textarea
        className="think__note"
        placeholder="התשובה שלך (לא נבדקת — רק בשבילך)"
        value={notes[i] ?? ''}
        onChange={(e) => setNotes((n) => { const c = [...n]; c[i] = e.target.value; return c; })}
        rows={2}
      />
      {showHint ? <div className="think__hint">💡 {step.hint}</div> : <button className="link-btn" onClick={() => setShowHint(true)}>איך לחשוב על זה?</button>}
      <div className="think__nav">
        <button className="btn-ghost" disabled={i === 0} onClick={() => { setI(i - 1); setShowHint(false); }}>◂ הקודמת</button>
        {i < steps.length - 1
          ? <button className="btn-primary btn-sm" onClick={() => { setI(i + 1); setShowHint(false); }}>הבאה ▸</button>
          : <button className="btn-primary btn-sm" onClick={onClose}>סיימתי לחשוב — אני מחליט</button>}
      </div>
    </div>
  );
}
