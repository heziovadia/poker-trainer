import { ActionType, PlayerView, Street } from '../engine/game';
import { Rng } from '../engine/cards';

export type Level = 1 | 2 | 3 | 4;

export type Topic =
  | 'handReading' | 'draws' | 'outs' | 'potOdds' | 'position'
  | 'betSizing' | 'preflop' | 'ranges' | 'valueBluff' | 'boardTexture';

export const TOPIC_HE: Record<Topic, string> = {
  handReading: 'זיהוי ידיים (Hand Reading)',
  draws: 'דרואים (Draws)',
  outs: 'חישוב Outs',
  potOdds: 'Pot Odds',
  position: 'מיקום (Position)',
  betSizing: 'גודל הימור (Bet Sizing)',
  preflop: 'בחירת ידיים לפני הפלופ (Preflop)',
  ranges: 'טווחי ידיים (Ranges)',
  valueBluff: 'Value Bet מול Bluff',
  boardTexture: 'קריאת לוח (Board Texture)',
};

export type MistakeTag =
  | 'potOdds' | 'betSizing' | 'position' | 'preflopRange'
  | 'freeFold' | 'passive' | 'overaggressive';

export const MISTAKE_HE: Record<MistakeTag, string> = {
  potOdds: 'Call או Fold שלא מתאים ל-Pot Odds',
  betSizing: 'גודל הימור לא מתאים',
  position: 'משחק יד חלשה מדי ביחס למיקום',
  preflopRange: 'בחירת יד שגויה לפני הפלופ',
  freeFold: 'Fold כשאפשר היה לעשות Check בחינם',
  passive: 'פסיביות — לא הימרת עם יד חזקה (Missed Value)',
  overaggressive: 'אגרסיביות מיותרת / בלוף במצב לא מתאים',
};

/** Which topic a mistake belongs to, for the adaptive trainer. */
export const MISTAKE_TOPIC: Record<MistakeTag, Topic> = {
  potOdds: 'potOdds',
  betSizing: 'betSizing',
  position: 'position',
  preflopRange: 'preflop',
  freeFold: 'handReading',
  passive: 'valueBluff',
  overaggressive: 'valueBluff',
};

export type Grade = 'good' | 'ok' | 'mistake';

export interface HeroDecision {
  type: ActionType;
  /** Street bet after the action ("to" amount) for bet/raise. */
  amount?: number;
}

export interface AnalysisSection {
  id: string;
  title: string;
  lines: string[];
  /** Minimum level at which this section is shown during play. */
  minLevel: Level;
}

export interface Alternative {
  label: string;
  verdict: Grade;
  text: string;
}

export interface DecisionAnalysis {
  id: string;
  handNumber: number;
  street: Street;
  /** Hebrew label of what hero did, e.g. "Call 40". */
  actionLabel: string;
  grade: Grade;
  verdictText: string;
  recommendedLabel: string;
  recommendedText: string;
  alternatives: Alternative[];
  sections: AnalysisSection[];
  mistakes: MistakeTag[];
  topics: Topic[];
  /** How hero's aggressive action is classified (for stats). */
  betKind?: 'value' | 'bluff' | 'semiBluff';
  close: boolean;
}

export interface ThinkStep {
  question: string;
  hint: string;
}

export interface QuizOption {
  label: string;
  correct: boolean;
}

export interface Quiz {
  topic: Topic;
  question: string;
  options: QuizOption[];
  explanation: string;
}

/**
 * The coach contract. Today it is implemented locally with rules and simulation;
 * an API-backed AI coach can implement the same interface later.
 */
export interface CoachProvider {
  analyzeDecision(view: PlayerView, decision: HeroDecision, rng: Rng): DecisionAnalysis;
  thinkSteps(view: PlayerView): ThinkStep[];
  makeQuiz(view: PlayerView, topic: Topic, rng: Rng): Quiz | null;
}
