import { useEffect, useState } from 'react';
import { PlayerView } from '../../engine/game';
import { HeroDecision } from '../../coach';

interface Props {
  view: PlayerView;
  enabled: boolean;
  onAct: (d: HeroDecision) => void;
}

export function ActionBar({ view, enabled, onAct }: Props) {
  const l = view.legal;
  const [sizing, setSizing] = useState(false);
  const me = view.players[view.myIndex];
  const [amount, setAmount] = useState(0);

  useEffect(() => {
    setSizing(false);
    if (l) setAmount(l.minTo);
  }, [view.handNumber, view.street, view.log.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!l) return null;
  const canAggr = l.canBet || l.canRaise;
  const aggrWord = l.canBet ? 'Bet' : 'Raise';
  const aggrHe = l.canBet ? 'הימור' : 'העלאה';
  const clamp = (x: number) => Math.round(Math.max(l.minTo, Math.min(l.maxTo, x)));

  // Pot-fraction presets. For raises: call first, then raise by a fraction of the pot after the call.
  const potAfterCall = view.pot + view.toCall;
  const toForFraction = (f: number) => (l.canBet ? clamp(view.pot * f) : clamp(me.streetBet + view.toCall + potAfterCall * f));
  const presets: { label: string; to: number }[] = [
    { label: '⅓ קופה', to: toForFraction(1 / 3) },
    { label: '½ קופה', to: toForFraction(1 / 2) },
    { label: '⅔ קופה', to: toForFraction(2 / 3) },
    { label: 'קופה מלאה', to: toForFraction(1) },
    { label: 'All-in', to: l.maxTo },
  ];
  if (view.street === 'preflop' && view.currentBet <= view.config.bigBlind) {
    const bb = view.config.bigBlind;
    presets.unshift({ label: '2.5 BB', to: clamp(bb * 2.5) }, { label: '3 BB', to: clamp(bb * 3) });
  }
  const isAllIn = amount >= l.maxTo;
  const pctOfPot = l.canBet ? Math.round((amount / Math.max(1, view.pot)) * 100) : null;

  return (
    <div className={`action-bar ${enabled ? '' : 'action-bar--disabled'}`}>
      {sizing && canAggr && (
        <div className="sizing">
          <div className="sizing__presets">
            {presets.map((p) => (
              <button key={p.label} className={`preset ${amount === p.to ? 'preset--on' : ''}`} onClick={() => setAmount(p.to)} disabled={!enabled}>
                <span>{p.label}</span>
                <small>{p.to}</small>
              </button>
            ))}
          </div>
          <div className="sizing__row">
            <input
              type="range"
              min={l.minTo}
              max={l.maxTo}
              step={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="גודל ההימור"
              disabled={!enabled}
              dir="ltr"
            />
            <input
              className="sizing__num"
              type="number"
              inputMode="numeric"
              min={l.minTo}
              max={l.maxTo}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              onBlur={() => setAmount(clamp(amount))}
              disabled={!enabled}
              dir="ltr"
            />
          </div>
          <div className="sizing__hint">
            מינימום {l.minTo} · מקסימום {l.maxTo}
            {pctOfPot !== null && ` · ${amount} ÷ ${view.pot} = ${pctOfPot}% מהקופה`}
          </div>
        </div>
      )}
      <div className="action-bar__buttons">
        <button className="btn-act btn-act--fold" disabled={!enabled} onClick={() => onAct({ type: 'fold' })}>
          <span className="btn-act__en">Fold</span>
          <span className="btn-act__he">ויתור</span>
        </button>
        {l.canCheck ? (
          <button className="btn-act btn-act--call" disabled={!enabled} onClick={() => onAct({ type: 'check' })}>
            <span className="btn-act__en">Check</span>
            <span className="btn-act__he">בדיקה</span>
          </button>
        ) : (
          <button className="btn-act btn-act--call" disabled={!enabled} onClick={() => onAct({ type: 'call' })}>
            <span className="btn-act__en">Call {l.callAmount}{l.callIsAllIn ? ' (All-in)' : ''}</span>
            <span className="btn-act__he">השוואה</span>
          </button>
        )}
        {canAggr && (
          sizing ? (
            <button
              className="btn-act btn-act--raise btn-act--confirm"
              disabled={!enabled || amount < l.minTo || amount > l.maxTo}
              onClick={() => onAct({ type: l.canBet ? 'bet' : 'raise', amount: clamp(amount) })}
            >
              <span className="btn-act__en">{isAllIn ? 'All-in' : aggrWord} {clamp(amount)}</span>
              <span className="btn-act__he">אישור {aggrHe}</span>
            </button>
          ) : (
            <button className="btn-act btn-act--raise" disabled={!enabled} onClick={() => setSizing(true)}>
              <span className="btn-act__en">{aggrWord}</span>
              <span className="btn-act__he">{aggrHe}…</span>
            </button>
          )
        )}
      </div>
      {sizing && <button className="link-btn sizing__cancel" onClick={() => setSizing(false)}>ביטול</button>}
    </div>
  );
}
