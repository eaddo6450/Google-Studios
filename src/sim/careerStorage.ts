import type { AircraftId, MissionType } from './types';

export const CAREER_STORAGE_KEY = 'vanguard_career_record_v1';

export interface SortieLogEntry {
  id: string;
  timestampIso: string;
  aircraftId: AircraftId;
  aircraftLabel: string;
  missionTitle: string;
  missionType: MissionType;
  kills: number;
  score: number;
  flightTimeSec: number;
  shotsFired: number;
  shotsHit: number;
  outcome: 'success' | 'failed' | 'aborted';
}

export interface CareerRecord {
  version: 1;
  totalKills: number;
  totalFlightSeconds: number;
  missionsAttempted: number;
  missionsCompleted: number;
  totalSorties: number;
  totalScore: number;
  bestScore: number;
  totalShotsFired: number;
  totalShotsHit: number;
  killsByAircraft: Partial<Record<AircraftId, number>>;
  recentSorties: SortieLogEntry[];
  updatedAtIso: string | null;
}

const VALID_AIRCRAFT: ReadonlySet<AircraftId> = new Set(['f22', 'f16', 'f14', 'typhoon']);
const VALID_MISSIONS: ReadonlySet<MissionType> = new Set(['destroy', 'escort', 'recon']);
const VALID_OUTCOMES: ReadonlySet<SortieLogEntry['outcome']> = new Set(['success', 'failed', 'aborted']);

export function createEmptyCareerRecord(): CareerRecord {
  return {
    version: 1,
    totalKills: 0,
    totalFlightSeconds: 0,
    missionsAttempted: 0,
    missionsCompleted: 0,
    totalSorties: 0,
    totalScore: 0,
    bestScore: 0,
    totalShotsFired: 0,
    totalShotsHit: 0,
    killsByAircraft: {},
    recentSorties: [],
    updatedAtIso: null,
  };
}

function safeNonNegNumber(val: unknown, fallback = 0): number {
  const n = typeof val === 'number' ? val : Number(val);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function safeNonNegInt(val: unknown, fallback = 0): number {
  return Math.floor(safeNonNegNumber(val, fallback));
}

function sanitizeSortieEntry(raw: unknown): SortieLogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const aircraftId = VALID_AIRCRAFT.has(r.aircraftId as AircraftId)
    ? (r.aircraftId as AircraftId)
    : 'f22';
  const missionType = VALID_MISSIONS.has(r.missionType as MissionType)
    ? (r.missionType as MissionType)
    : 'destroy';
  const outcome = VALID_OUTCOMES.has(r.outcome as SortieLogEntry['outcome'])
    ? (r.outcome as SortieLogEntry['outcome'])
    : 'aborted';

  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 48) : `sortie_${Date.now()}`,
    timestampIso: typeof r.timestampIso === 'string' ? r.timestampIso : new Date().toISOString(),
    aircraftId,
    aircraftLabel: typeof r.aircraftLabel === 'string' && r.aircraftLabel ? r.aircraftLabel.slice(0, 48) : 'F-22A Raptor',
    missionTitle: typeof r.missionTitle === 'string' && r.missionTitle ? r.missionTitle.slice(0, 64) : 'OPERATION IRON FJORD',
    missionType,
    kills: safeNonNegInt(r.kills),
    score: safeNonNegInt(r.score),
    flightTimeSec: safeNonNegNumber(r.flightTimeSec),
    shotsFired: safeNonNegInt(r.shotsFired),
    shotsHit: safeNonNegInt(r.shotsHit),
    outcome,
  };
}

export function loadCareerRecord(): CareerRecord {
  const empty = createEmptyCareerRecord();
  try {
    const raw = localStorage.getItem(CAREER_STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return empty;

    const missionsAttempted = safeNonNegInt(parsed.missionsAttempted);
    const missionsCompleted = Math.min(missionsAttempted, safeNonNegInt(parsed.missionsCompleted));
    const totalShotsFired = safeNonNegInt(parsed.totalShotsFired);
    const totalShotsHit = Math.min(totalShotsFired, safeNonNegInt(parsed.totalShotsHit));

    const killsByAircraft: Partial<Record<AircraftId, number>> = {};
    if (parsed.killsByAircraft && typeof parsed.killsByAircraft === 'object') {
      for (const id of VALID_AIRCRAFT) {
        const count = safeNonNegInt((parsed.killsByAircraft as Record<string, unknown>)[id]);
        if (count > 0) {
          killsByAircraft[id] = count;
        }
      }
    }

    const rawSorties = Array.isArray(parsed.recentSorties) ? parsed.recentSorties : [];
    const recentSorties = rawSorties
      .map(sanitizeSortieEntry)
      .filter((entry): entry is SortieLogEntry => entry !== null)
      .slice(0, 8);

    return {
      version: 1,
      totalKills: safeNonNegInt(parsed.totalKills),
      totalFlightSeconds: safeNonNegNumber(parsed.totalFlightSeconds),
      missionsAttempted,
      missionsCompleted,
      totalSorties: Math.max(missionsAttempted, safeNonNegInt(parsed.totalSorties)),
      totalScore: safeNonNegInt(parsed.totalScore),
      bestScore: safeNonNegInt(parsed.bestScore),
      totalShotsFired,
      totalShotsHit,
      killsByAircraft,
      recentSorties,
      updatedAtIso: typeof parsed.updatedAtIso === 'string' ? parsed.updatedAtIso : null,
    };
  } catch {
    return empty;
  }
}

export function saveCareerRecord(record: CareerRecord): CareerRecord {
  const next: CareerRecord = {
    ...record,
    version: 1,
    updatedAtIso: new Date().toISOString(),
  };
  try {
    localStorage.setItem(CAREER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore quota or storage restriction errors cleanly
  }
  return next;
}

export function resetCareerRecord(): CareerRecord {
  const empty = createEmptyCareerRecord();
  try {
    localStorage.removeItem(CAREER_STORAGE_KEY);
  } catch {
    // Ignore storage restriction errors cleanly
  }
  return empty;
}

export function getCareerFlightHours(record: CareerRecord): number {
  return record.totalFlightSeconds / 3600;
}

export function getMissionSuccessRatePct(record: CareerRecord): number {
  if (record.missionsAttempted <= 0) return 0;
  return Math.round((record.missionsCompleted / record.missionsAttempted) * 100);
}

export function getCareerAccuracyPct(record: CareerRecord): number {
  if (record.totalShotsFired <= 0) return 0;
  return Math.round((record.totalShotsHit / record.totalShotsFired) * 100);
}

export function formatFlightHoursLabel(totalSeconds: number): string {
  const hours = totalSeconds / 3600;
  if (hours >= 100) return `${hours.toFixed(1)} hrs`;
  return `${hours.toFixed(2)} hrs`;
}

export function formatDurationHms(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hrs = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
