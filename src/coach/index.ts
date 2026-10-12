import { CoachProvider } from './types';
import { analyzeDecision } from './analyze';
import { thinkSteps } from './think';
import { makeQuiz } from './quiz';

/** Rule- and simulation-based coach that runs entirely in the browser. */
export const localCoach: CoachProvider = {
  analyzeDecision,
  thinkSteps,
  makeQuiz,
};

export * from './types';
