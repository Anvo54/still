// history.js - Paikallinen harjoitushistoria ja päiväputki (localStorage)

const STORAGE_KEY = 'still_breath_history_v1';
const MAX_ENTRIES = 100;

function getStorage(customStorage) {
  if (customStorage) return customStorage;
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function loadHistory(customStorage = null) {
  const storage = getStorage(customStorage);
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

export function saveSession(entry, customStorage = null) {
  const storage = getStorage(customStorage);
  const current = loadHistory(storage);
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    dateIso: entry.dateIso || new Date().toISOString(),
    mode: entry.mode || 'timed',
    title: entry.title || 'Hengitysharjoitus',
    durationSec: Math.max(1, Math.round(entry.durationSec || 0)),
    rounds: entry.rounds || 1,
    maxRetentionMs: entry.maxRetentionMs || null,
    avgBpm: entry.avgBpm || null,
    avgHrv: entry.avgHrv || null
  };
  const next = [item, ...current].slice(0, MAX_ENTRIES);
  if (storage) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e) {
      // Ohitetaan tallennusvirhe jos tallennustila on täynnä
    }
  }
  return next;
}

export function clearHistory(customStorage = null) {
  const storage = getStorage(customStorage);
  if (storage) {
    try {
      storage.removeItem(STORAGE_KEY);
    } catch (e) {
      // Ohitetaan
    }
  }
  return [];
}

function toLocalDayKey(isoString) {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function calculateStreak(sessions, referenceDate = new Date()) {
  if (!sessions || sessions.length === 0) return 0;

  const uniqueDays = Array.from(new Set(sessions.map(s => toLocalDayKey(s.dateIso)))).sort().reverse();
  if (uniqueDays.length === 0) return 0;

  const todayKey = toLocalDayKey(referenceDate.toISOString());
  const yesterday = new Date(referenceDate);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toLocalDayKey(yesterday.toISOString());

  // Putki on voimassa, jos viimeisin harjoitus on tehty tänään tai eilen
  if (uniqueDays[0] !== todayKey && uniqueDays[0] !== yesterdayKey) {
    return 0;
  }

  let streak = 1;
  for (let i = 1; i < uniqueDays.length; i++) {
    const prev = new Date(uniqueDays[i - 1] + 'T00:00:00Z');
    const curr = new Date(uniqueDays[i] + 'T00:00:00Z');
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / (24 * 60 * 60 * 1000));
    if (diffDays === 1) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function getHistorySummary(customStorage = null, referenceDate = new Date()) {
  const sessions = loadHistory(customStorage);
  const streakDays = calculateStreak(sessions, referenceDate);
  const totalSessions = sessions.length;
  const totalMinutes = Math.round(sessions.reduce((sum, s) => sum + (s.durationSec || 0), 0) / 60);
  return {
    sessions,
    streakDays,
    totalSessions,
    totalMinutes
  };
}
