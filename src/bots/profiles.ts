export type ProfileId = 'tight' | 'loose' | 'aggressive' | 'passive' | 'balanced';

export interface BotProfile {
  id: ProfileId;
  en: string;
  he: string;
  description: string;
  /** Multiplier on the standard opening range width. */
  openWidth: number;
  /** Share of entered (unopened) pots that are limped instead of raised. */
  limpFreq: number;
  /** Top share of hands that 3-bet. */
  threeBet: number;
  /** Additional top share that flat-calls a raise. */
  callRaise: number;
  /** 0..1 — how often strong hands bet/raise postflop. */
  aggression: number;
  /** 0..1 — bluff frequency with weak hands. */
  bluff: number;
  /** Equity margin added when deciding to call (positive = calls more). */
  stickiness: number;
  /** Used by the coach to widen/narrow estimated ranges. */
  rangeMultiplier: number;
}

export const PROFILES: Record<ProfileId, BotProfile> = {
  tight: {
    id: 'tight', en: 'Tight', he: 'הדוק',
    description: 'משחק מעט ידיים, בעיקר חזקות. כשהוא מהמר — בדרך כלל יש לו משהו.',
    openWidth: 0.65, limpFreq: 0.05, threeBet: 0.035, callRaise: 0.06,
    aggression: 0.55, bluff: 0.06, stickiness: -0.04, rangeMultiplier: 0.65,
  },
  loose: {
    id: 'loose', en: 'Loose', he: 'רופף',
    description: 'נכנס להרבה ידיים ומשלם הרבה. הטווח שלו רחב ומלא ידיים בינוניות.',
    openWidth: 1.7, limpFreq: 0.45, threeBet: 0.06, callRaise: 0.3,
    aggression: 0.45, bluff: 0.14, stickiness: 0.1, rangeMultiplier: 1.7,
  },
  aggressive: {
    id: 'aggressive', en: 'Aggressive', he: 'אגרסיבי',
    description: 'מהמר ומעלה הרבה, כולל בלופים. אל תניח שכל הימור שלו הוא יד חזקה.',
    openWidth: 1.25, limpFreq: 0.02, threeBet: 0.11, callRaise: 0.1,
    aggression: 0.85, bluff: 0.3, stickiness: 0, rangeMultiplier: 1.3,
  },
  passive: {
    id: 'passive', en: 'Passive', he: 'פסיבי',
    description: 'בעיקר משלם (Call) ולעיתים רחוקות מעלה. כשהוא כן מעלה — זו בדרך כלל יד חזקה מאוד.',
    openWidth: 1.3, limpFreq: 0.75, threeBet: 0.02, callRaise: 0.28,
    aggression: 0.2, bluff: 0.03, stickiness: 0.08, rangeMultiplier: 1.4,
  },
  balanced: {
    id: 'balanced', en: 'Balanced', he: 'מאוזן',
    description: 'משחק סטנדרטי לפי מיקום, משלב ידי ערך ובלופים במינון סביר.',
    openWidth: 1, limpFreq: 0, threeBet: 0.065, callRaise: 0.11,
    aggression: 0.6, bluff: 0.14, stickiness: 0, rangeMultiplier: 1,
  },
};

export const profileOf = (id?: string): BotProfile => PROFILES[(id as ProfileId) ?? 'balanced'] ?? PROFILES.balanced;

/** Standard unopened raising range (share of hands) by position for 6-max. */
export const OPEN_RANGE: Record<string, number> = {
  UTG: 0.15, MP: 0.17, HJ: 0.19, CO: 0.27, BTN: 0.43, SB: 0.36, BB: 0.12,
};
