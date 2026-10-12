import { Card, rankOf, suitOf, rankLabel, SUIT_SYMBOLS, SUIT_NAMES_HE } from '../../engine/cards';

interface Props {
  card?: Card;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  fourColor?: boolean;
  highlight?: boolean;
  dim?: boolean;
  delay?: number;
}

const SUIT_CLASS = ['clubs', 'diamonds', 'hearts', 'spades'];

export function PlayingCard({ card, faceDown, size = 'md', fourColor = true, highlight, dim, delay = 0 }: Props) {
  if (faceDown || card === undefined) {
    return <div className={`pcard pcard--${size} pcard--back`} style={{ animationDelay: `${delay}ms` }} aria-label="קלף סגור" />;
  }
  const r = rankLabel(rankOf(card));
  const s = suitOf(card);
  const cls = [
    'pcard', `pcard--${size}`, fourColor ? `suit-${SUIT_CLASS[s]}` : s === 1 || s === 2 ? 'suit-hearts' : 'suit-spades',
    highlight ? 'pcard--hl' : '', dim ? 'pcard--dim' : '',
  ].join(' ');
  return (
    <div className={cls} style={{ animationDelay: `${delay}ms` }} aria-label={`${r} ${SUIT_NAMES_HE[s]}`}>
      <span className="pcard__rank">{r}</span>
      <span className="pcard__suit-small">{SUIT_SYMBOLS[s]}</span>
      <span className="pcard__suit">{SUIT_SYMBOLS[s]}</span>
    </div>
  );
}

export function CardRow({ cards, size = 'sm', fourColor }: { cards: Card[]; size?: 'sm' | 'md' | 'lg'; fourColor?: boolean }) {
  return (
    <span className="card-row">
      {cards.map((c) => <PlayingCard key={c} card={c} size={size} fourColor={fourColor} />)}
    </span>
  );
}
