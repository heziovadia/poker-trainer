import { GameState, positionOf, potSize } from '../../engine/game';
import { profileOf } from '../../bots/profiles';
import { PlayingCard } from './PlayingCard';
import { HERO_ID } from '../useTrainer';
import { useMediaQuery } from '../useMediaQuery';

const WIDE: [number, number][] = [[50, 90], [7, 66], [15, 13], [50, 4], [85, 13], [93, 66]];
const TALL: [number, number][] = [[50, 93], [11, 69], [11, 27], [50, 6], [89, 27], [89, 69]];
const CENTER: [number, number] = [50, 47];

const ACTION_HE: Record<string, string> = {
  fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', post: 'Blind',
};

interface Props {
  game: GameState;
  fourColor: boolean;
  showAll?: boolean;
}

export function Table({ game, fourColor }: Props) {
  const compact = useMediaQuery('(max-width: 700px)');
  const coords = compact ? TALL : WIDE;
  const n = game.players.length;
  const heroIdx = game.players.findIndex((p) => p.id === HERO_ID);
  const result = game.result;
  const winners = new Set(result ? result.pots.flatMap((p) => p.winners) : []);
  const pot = potSize(game);
  const potCenter = result ? result.pots.reduce((s, p) => s + p.amount, 0) : pot;
  const bestCards = new Set<number>();
  if (result?.showdown) {
    const w = result.pots[0]?.winners[0];
    if (w) result.revealed[w]?.best5.forEach((c) => bestCards.add(c));
  }

  return (
    <div className={`table-wrap ${compact ? 'table-wrap--tall' : ''}`}>
      <div className="table-felt">
        <div className="table-rail" />
        <div className="table-logo">POKER TRAINER</div>

        <div className="board">
          {[0, 1, 2, 3, 4].map((i) => (
            game.board[i] !== undefined
              ? <PlayingCard key={`${game.handNumber}-${i}`} card={game.board[i]} size={compact ? 'md' : 'lg'} fourColor={fourColor} highlight={bestCards.has(game.board[i])} delay={i < 3 ? i * 90 : 0} />
              : <div key={i} className={`card-slot card-slot--${compact ? 'md' : 'lg'}`} />
          ))}
        </div>

        <div className="pot">
          <span className="pot__label">קופה · Pot</span>
          <span className="pot__amount">{potCenter.toLocaleString()}</span>
          {!result && game.players.some((p) => p.streetBet > 0) && <span className="pot__side">כולל הימורים ברחוב הנוכחי</span>}
          {result && result.pots.length > 1 && (
            <span className="pot__side">{result.pots.map((p, i) => `${i === 0 ? 'ראשית' : `צד ${i}`}: ${p.amount}`).join(' · ')}</span>
          )}
        </div>
      </div>

      {game.players.map((p, i) => {
        const rel = (i - heroIdx + n) % n;
        const [x, y] = coords[rel];
        const pos = game.handNumber ? positionOf(game, i) : '';
        const isTurn = game.toAct === i && !result;
        const isWinner = winners.has(p.id);
        const showCards = p.isHero || (result?.showdown && !p.folded && !!result.revealed[p.id]);
        const prof = p.profile ? profileOf(p.profile) : null;
        const la = p.lastAction;
        const bx = x + (CENTER[0] - x) * 0.42;
        const by = y + (CENTER[1] - y) * 0.42;
        const net = result?.net[p.id];
        return (
          <div key={p.id}>
            <div
              className={['seat', p.isHero ? 'seat--hero' : '', p.folded ? 'seat--folded' : '', isTurn ? 'seat--turn' : '', isWinner ? 'seat--winner' : ''].join(' ')}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className="seat__cards">
                {p.hole.length > 0 && !p.isHero && (
                  showCards
                    ? p.hole.map((c) => <PlayingCard key={c} card={c} size="sm" fourColor={fourColor} highlight={bestCards.has(c)} />)
                    : !p.folded && p.hole.map((_, k) => <PlayingCard key={k} faceDown size="sm" />)
                )}
              </div>
              <div className="seat__plate">
                {game.buttonIndex === i && game.handNumber > 0 && <span className="dealer-btn" title="Dealer Button">D</span>}
                <div className="seat__top">
                  <span className="seat__name">{p.name}</span>
                  {pos && <span className={`pos-chip pos-chip--${pos}`}>{pos}</span>}
                </div>
                <div className="seat__stack">{p.stack.toLocaleString()}{p.allIn && !result ? <em> All-in</em> : null}</div>
                {prof && <div className={`seat__style style--${prof.id}`} title={prof.description}>{prof.en} · {prof.he}</div>}
              </div>
              {la && !result && (
                <div className={`seat__action act--${la.type}`}>
                  {ACTION_HE[la.type]}{la.type !== 'fold' && la.type !== 'check' && la.amount ? ` ${la.amount}` : ''}{la.allIn ? ' (All-in)' : ''}
                </div>
              )}
              {result && net !== undefined && net !== 0 && (
                <div className={`seat__net ${net > 0 ? 'seat__net--up' : 'seat__net--down'}`}>{net > 0 ? `+${net}` : net}</div>
              )}
              {result?.showdown && result.revealed[p.id] && !p.folded && (
                <div className="seat__handname">{result.revealed[p.id] && handLabel(result.revealed[p.id].category)}</div>
              )}
            </div>
            {p.streetBet > 0 && !result && (
              <div className="bet-chips" style={{ left: `${bx}%`, top: `${by}%` }}>
                <span className="chip" />
                {p.streetBet}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CAT = ['High Card', 'Pair', 'Two Pair', 'Trips', 'Straight', 'Flush', 'Full House', 'Quads', 'Straight Flush'];
const handLabel = (c: number) => CAT[c];
