import { useEffect, useState } from 'react';
import { getSyncStatus, onSyncStatus, SyncStatus } from '../../storage/cloudSync';

const LABEL: Record<SyncStatus, { icon: string; text: string; title: string }> = {
  local: { icon: '💻', text: 'מקומי', title: 'הנתונים נשמרים רק בדפדפן הזה' },
  connecting: { icon: '⏳', text: 'מתחבר', title: 'מתחבר לשמירה בענן' },
  synced: { icon: '☁️', text: 'מסונכרן', title: 'ההתקדמות נשמרת בחשבון שלך ומסונכרנת בין המחשב לנייד' },
  saving: { icon: '⏳', text: 'שומר', title: 'שומר את ההתקדמות בחשבון שלך' },
  error: { icon: '⚠️', text: 'לא סונכרן', title: 'השמירה בענן נכשלה כרגע; הנתונים שמורים בדפדפן וינוסה שוב' },
};

export function SyncBadge() {
  const [s, setS] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => onSyncStatus(setS), []);
  if (s === 'local') return null;
  const l = LABEL[s];
  return (
    <span className={`sync sync--${s}`} title={l.title}>
      {l.icon} <span className="sync__text">{l.text}</span>
    </span>
  );
}
