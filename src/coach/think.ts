/** "Help me think" — guiding questions that never reveal the answer. */
import { PlayerView } from '../engine/game';
import { ThinkStep } from './types';
import { num } from './analyze';

export function thinkSteps(view: PlayerView): ThinkStep[] {
  const pre = view.street === 'preflop';
  const steps: ThinkStep[] = [];
  const opp = view.players.filter((p) => !p.folded && p.id !== view.myId);
  const aggressors = [...new Set(view.log.filter((l) => l.street === view.street && (l.action === 'bet' || l.action === 'raise')).map((l) => l.playerId))]
    .map((id) => view.players.find((p) => p.id === id)!)
    .filter((p) => p && p.id !== view.myId);

  if (pre) {
    steps.push({ question: 'איזה סוג יד יש לך?', hint: 'זוג ביד (Pocket Pair)? שני קלפים גבוהים? אותו סוג (Suited) או מחוברים (Connectors)? ידיים Suited ומחוברות משחקות טוב יותר אחרי הפלופ.' });
    steps.push({ question: `המיקום שלך הוא ${view.myPosition}. כמה שחקנים עוד יפעלו אחריך?`, hint: 'ספור את השחקנים שעדיין לא פעלו. ככל שיש יותר, צריך יד חזקה יותר.' });
    steps.push({ question: 'מה קרה לפניך?', hint: 'האם מישהו העלה (Raise)? מאיזה מיקום? העלאה ממיקום מוקדם מראה טווח חזק יותר מהעלאה מה-Button.' });
    if (view.toCall > 0) steps.push({ question: `אתה צריך לשלם ${num(view.toCall)} והקופה היא ${num(view.pot)}. האם המחיר הגיוני?`, hint: `נסה לחשב: ${num(view.toCall)} ÷ (${num(view.pot)} + ${num(view.toCall)}) = ? זה האחוז המינימלי שאתה צריך לנצח.` });
    steps.push({ question: 'אם תיכנס ליד — האם תרצה להוביל (Raise) או רק להצטרף (Call)?', hint: 'כניסה עם Raise נותנת יוזמה ושתי דרכים לנצח: כולם מוותרים, או שיש לך יד טובה יותר.' });
    steps.push({ question: 'איך היד הזו תיראה אחרי הפלופ?', hint: 'כמה פעמים היא תפגע בזוג טוב? האם היא יכולה להיות Dominated (למשל A עם קיקר חלש מול A עם קיקר חזק)?' });
    return steps;
  }

  steps.push({ question: 'מה היד שלך כרגע?', hint: 'חבר את שני הקלפים שלך עם הלוח ובחר את 5 הקלפים הטובים ביותר. האם יש לך זוג? איזה זוג — עם הקלף הגבוה בלוח (Top Pair) או נמוך יותר?' });
  steps.push({ question: 'אילו ידיים חזקות ממך?', hint: 'בדוק: האם יש 3 קלפים מאותו סוג בלוח (Flush אפשרי)? קלפים מחוברים (Straight)? זוג על הלוח (Full House)? אילו זוגות גבוהים משלך?' });
  steps.push({ question: 'אילו ידיים חלשות ממך עשויות לשלם לך?', hint: 'אם תהמר — האם יש ידיים גרועות משלך שימשיכו? (זוגות נמוכים, דרואים, קיקר חלש יותר). אם אין כאלה, הימור לא מרוויח Value.' });
  if (view.street !== 'river') {
    steps.push({ question: 'האם יש לך Draw?', hint: '4 קלפים מאותו סוג = Flush Draw. 4 קלפים ברצף = Open-Ended. רצף עם "חור" באמצע = Gutshot.' });
    steps.push({ question: 'כמה Outs יש לך?', hint: `ספור את הקלפים שישפרו אותך ליד שכנראה מנצחת. Flush Draw = 13 − 4 = 9. Open-Ended = 2 × 4 = 8. אחר כך: Outs ÷ ${view.street === 'flop' ? 47 : 46} קלפים לא ידועים.` });
  }
  if (view.toCall > 0) {
    steps.push({ question: `כמה אתה צריך לשלם? ${num(view.toCall)}. מה גודל הקופה? ${num(view.pot)}.`, hint: `Pot Odds = מה שאתה משלם ÷ הקופה אחרי ה-Call. נסה: ${num(view.toCall)} ÷ (${num(view.pot)} + ${num(view.toCall)}). השווה את זה לסיכוי שלך לנצח.` });
  } else {
    steps.push({ question: `הקופה היא ${num(view.pot)} ואין הימור מולך. אם תהמר — כמה?`, hint: 'שאל: למה אני מהמר? בשביל Value (ידיים חלשות ישלמו) או כבלוף (ידיים טובות יוותרו)? אם אין תשובה ברורה — אולי Check.' });
  }
  steps.push({ question: `מה ה-Position שלך? (${view.myPosition})`, hint: 'מי פועל אחריך ברחוב הזה? אם אתה אחרון (In Position) — יש לך יותר מידע ושליטה.' });
  steps.push({
    question: `מה לדעתך ה-Range של ${aggressors.length ? aggressors.map((p) => p.name).join(', ') : opp.map((p) => p.name).join(', ')}?`,
    hint: 'עבור על הפעולות שלו מההתחלה: מה הוא עשה לפני הפלופ? הימר או בדק בכל רחוב? מה הסגנון שלו (Tight / Loose / Aggressive / Passive)? אילו ידיים הגיוניות לשחק ככה?',
  });
  steps.push({ question: 'עכשיו — מה התוכנית שלך?', hint: 'בחר פעולה, וחשוב גם על הרחוב הבא: מה תעשה אם יהמרו מולך? אם תשלים את הדרו?' });
  return steps;
}
