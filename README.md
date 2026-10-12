# Poker Trainer ♠

מאמן אישי ל-Texas Hold'em: שולחן של 6 שחקנים (אתה + 5 יריבים), ניתוח אחרי כל החלטה, שאלות אימון, "עזור לי לחשוב", סטטיסטיקה, היסטוריית ידיים ואימון אדפטיבי. רץ מקומית בדפדפן — בלי שרת, בלי Login, בלי כסף אמיתי.

## הפעלה

הדרך הקלה: אייקון **Poker Trainer** בשולחן העבודה (או בתפריט Start). הוא מפעיל את השרת המקומי אם צריך, ופותח את האפליקציה בחלון Chrome משלה.
השרת רץ בחלון ממוזער בשם "Poker Trainer - server". סגירת החלון הזה עוצרת את האפליקציה.

`start.bat` עושה את אותו הדבר. אם האייקון נמחק, אפשר ליצור אותו מחדש:
`powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1`

הנתונים נשמרים בדפדפן תחת הכתובת http://localhost:5173, ולכן הפורט קבוע (`strictPort`).

### גיבוי

⚙️ הגדרות ← "הורד קובץ גיבוי" שומר את כל הנתונים לקובץ JSON. "שחזר מקובץ…" מחזיר אותם.

### מהאייפון

כשהשרת רץ, המחשב והאייפון באותה רשת Wi-Fi: פותחים ב-Safari את הכתובת `http://<IP של המחשב>:5173`.
הכתובת מופיעה בטרמינל בשורה `Network:`.

## בדיקות

```
npm test
```

הבדיקות מכסות יצירת חפיסה וייחודיות קלפים, דירוג ידיים (כולל בדיקה מלאה של כל 2,598,960 ידיי ה-5 קלפים), קביעת מנצחים, קופות ו-Side Pots, פעולות חוקיות, Outs, Pot Odds, בוטים (כולל בדיקה שהם לא רואים את הקלפים שלך), ניתוח ההחלטות (כל אחוז מגיע עם חישוב), שאלות, סטטיסטיקה ואימון אדפטיבי.

## מבנה

| תיקייה | תפקיד |
|---|---|
| `src/engine` | חוקי פוקר טהורים, בלי UI: קלפים, דירוג ידיים, מכונת המצבים של השולחן, קופות, Equity, Outs, Draws, Board Texture |
| `src/bots` | 5 סגנונות יריבים. בוט מקבל רק `PlayerView`: מידע ציבורי והקלפים שלו |
| `src/coach` | ניתוח החלטות, הערכת Ranges, "עזור לי לחשוב", שאלות. מאחורי ממשק `CoachProvider` (מאמן AI ב-API יוכל להחליף אותו) |
| `src/training` | סטטיסטיקה, Training Report, אימון אדפטיבי, היסטוריית ידיים |
| `src/storage` | `StorageAdapter`, היום localStorage. בעתיד אפשר לשים מאחוריו Backend וסנכרון |
| `src/ui` | React בלבד |

טבלת חוזק הידיים לפני הפלופ (`src/engine/preflopTable.ts`) נוצרה בסימולציה. ליצירה מחדש:
`GEN=1 npx vitest run tests/gen-preflop.test.ts`

## גרסת האינטרנט

האתר: https://heziovadia.github.io/poker-trainer/

- כל שחקן נרשם עם מייל וסיסמה. ההתקדמות שלו (סטטיסטיקה, רמה, היסטוריה) נשמרת ב-Supabase ומסונכרנת בין כל המכשירים שלו.
- כל שחקן רואה רק את הנתונים שלו (Row Level Security, ראה `supabase/schema.sql`).
- כל `git push` ל-`main` בונה ומפרסם את האתר מחדש (GitHub Actions, `.github/workflows/deploy.yml`).
- כתובת ה-Supabase והמפתח הציבורי (publishable/anon) מוגדרים כ-Repository variables ב-GitHub: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. בלעדיהם האתר עובד במצב מקומי בלבד.
- גרסת claude.ai הישנה: `npm run build:web`, ואז `dist/poker-trainer.html`.
