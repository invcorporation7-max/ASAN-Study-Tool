import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  CalendarClock,
  ClipboardCheck,
  Flag,
  Lock,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Trash2,
  Volume2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';
import {
  guestCreateExam,
  guestCreateStudyLog,
  guestDeleteExam,
} from '../lib/guestStore';
import {
  playBasicTimerChime,
  playExamEndBell,
  playFiveMinWarningAlarm,
  playHourlyIntervalChime,
  playPhaseStartBell,
  playPreStartWarningAlarm,
} from '../lib/audioAlarms';
import type { ExamScheduleItem, StudyLogItem } from '../types';
import { ConfirmDialog } from './ConfirmDialog';

interface TimersViewProps {
  exams: ExamScheduleItem[];
  studyLogs: StudyLogItem[];
  onRefresh: () => Promise<void>;
}

const EXAM_TYPES = [
  'JEE Main',
  'JEE ADV',
  'ISC',
  'CBSE',
  'NEET UG',
  'CUET',
  'Other',
] as const;

type TimerTab = 'test' | 'basic' | 'stopwatch' | 'study-logger';

const EXAM_PERSIST_KEY = 'asan_persist_exam_v1';
const BASIC_PERSIST_KEY = 'asan_persist_basic_v1';
const SW_PERSIST_KEY = 'asan_persist_sw_v1';
const STUDY_PUNCH_KEY = 'asan_study_punch_in_v1';

interface ActiveExamSession {
  id?: number;
  subject: string;
  paperName: string;
  examLabel: string;
  readingSec: number;
  writingSec: number;
  seatingTimestampMs: number | null;
  alarmEnabled: boolean;
  hourlyAlarm: boolean;
  phase: 'waiting_seating' | 'reading' | 'writing' | 'finished';
  phaseStartMs: number;
  pausedRemainingSec: number | null;
  isPaused: boolean;
  firedCheckpoints: Set<string>;
}

function formatHMS(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatMicrosecondStopwatch(totalUs: number): {
  hms: string;
  ms: string;
  us: string;
} {
  const safeUs = Math.max(0, Math.floor(totalUs));
  const totalSeconds = Math.floor(safeUs / 1_000_000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const remUs = safeUs % 1_000_000;
  const ms = Math.floor(remUs / 1000);
  const us = remUs % 1000;

  return {
    hms: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
    ms: String(ms).padStart(3, '0'),
    us: String(us).padStart(3, '0'),
  };
}

export const TimersView: React.FC<TimersViewProps> = ({
  exams,
  studyLogs,
  onRefresh,
}) => {
  const { isGuest, isEffectiveProOrAdmin, refreshProfile } = useAuth();
  const [activeTab, setActiveTab] = useState<TimerTab>('test');

  // --- TEST TIMER FORM STATE ---
  const [subject, setSubject] = useState('Physics');
  const [paperName, setPaperName] = useState('');
  const [examType, setExamType] = useState<(typeof EXAM_TYPES)[number]>('JEE Main');
  const [customExamType, setCustomExamType] = useState('');
  const [readingMinutes, setReadingMinutes] = useState<number>(15);
  const [writingMinutes, setWritingMinutes] = useState<number>(180);
  const [seatingTime, setSeatingTime] = useState<string>('');
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const [hourlyAlarm, setHourlyAlarm] = useState(true);
  const [examLogBanner, setExamLogBanner] = useState<string | null>(null);
  const [deleteExamTarget, setDeleteExamTarget] = useState<ExamScheduleItem | null>(null);

  // Fullscreen Lock State
  const examConsoleRef = useRef<HTMLDivElement | null>(null);
  const manualEndOrPauseRef = useRef(false);
  const [fullscreenWarningOpen, setFullscreenWarningOpen] = useState(false);

  // Active exam runner state (hydrated from localStorage for persistence across closes)
  const [activeExam, setActiveExam] = useState<ActiveExamSession | null>(() => {
    try {
      const raw = localStorage.getItem(EXAM_PERSIST_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.subject) return null;
      return {
        ...parsed,
        firedCheckpoints: new Set(Array.isArray(parsed.firedCheckpoints) ? parsed.firedCheckpoints : []),
      };
    } catch {
      return null;
    }
  });
  const [examDisplaySec, setExamDisplaySec] = useState<number>(0);

  // --- BASIC TIMER STATE (wall-clock persisted) ---
  const [basicLabel, setBasicLabel] = useState(() => {
    try {
      const raw = localStorage.getItem(BASIC_PERSIST_KEY);
      return raw ? JSON.parse(raw).label || 'Deep Study Block' : 'Deep Study Block';
    } catch {
      return 'Deep Study Block';
    }
  });
  const [basicMinutes, setBasicMinutes] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(BASIC_PERSIST_KEY);
      return raw ? JSON.parse(raw).minutes || 25 : 25;
    } catch {
      return 25;
    }
  });
  const [basicTargetEndMs, setBasicTargetEndMs] = useState<number | null>(() => {
    try {
      const raw = localStorage.getItem(BASIC_PERSIST_KEY);
      return raw ? JSON.parse(raw).targetEndMs ?? null : null;
    } catch {
      return null;
    }
  });
  const [basicRunning, setBasicRunning] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(BASIC_PERSIST_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed.running && parsed.targetEndMs && parsed.targetEndMs > Date.now());
    } catch {
      return false;
    }
  });
  const [basicRemainingSec, setBasicRemainingSec] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(BASIC_PERSIST_KEY);
      if (!raw) return 25 * 60;
      const parsed = JSON.parse(raw);
      if (parsed.running && parsed.targetEndMs) {
        return Math.max(0, Math.ceil((parsed.targetEndMs - Date.now()) / 1000));
      }
      return typeof parsed.remainingSec === 'number' ? parsed.remainingSec : 25 * 60;
    } catch {
      return 25 * 60;
    }
  });

  // --- MICROSECOND STOPWATCH STATE (wall-clock persisted) ---
  const initialSw = useMemo(() => {
    try {
      const raw = localStorage.getItem(SW_PERSIST_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as {
        running: boolean;
        startWallMs: number;
        accumulatedUs: number;
        laps: { index: number; totalUs: number; splitUs: number }[];
      };
    } catch {
      return null;
    }
  }, []);

  const [swRunning, setSwRunning] = useState<boolean>(() => Boolean(initialSw?.running));
  const [swElapsedUs, setSwElapsedUs] = useState<number>(() => {
    if (!initialSw) return 0;
    if (initialSw.running && initialSw.startWallMs) {
      return initialSw.accumulatedUs + Math.max(0, (Date.now() - initialSw.startWallMs) * 1000);
    }
    return initialSw.accumulatedUs || 0;
  });
  const [laps, setLaps] = useState<{ index: number; totalUs: number; splitUs: number }[]>(
    () => initialSw?.laps || []
  );
  const swStartWallMsRef = useRef<number>(initialSw?.startWallMs || Date.now());
  const swStartPerfRef = useRef<number>(performance.now());
  const swAccumulatedUsRef = useRef<number>(
    initialSw?.running && initialSw.startWallMs
      ? initialSw.accumulatedUs + Math.max(0, (Date.now() - initialSw.startWallMs) * 1000)
      : initialSw?.accumulatedUs || 0
  );
  const swRafRef = useRef<number | null>(null);

  // --- PRO STUDY TIME LOGGER STATE (In/Out + -2.5% deduction + Optional Sleep) ---
  const [punchInMs, setPunchInMs] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(STUDY_PUNCH_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });
  const [loggerLabel, setLoggerLabel] = useState('Daily Focused Study Block');
  const [manualInTime, setManualInTime] = useState('');
  const [manualOutTime, setManualOutTime] = useState('');
  const [sleepMinutesInput, setSleepMinutesInput] = useState('0');
  const [loggerBusy, setLoggerBusy] = useState(false);
  const [loggerMsg, setLoggerMsg] = useState<string | null>(null);

  // Compute upcoming alarm checkpoints preview for the user
  const checkpointPreview = useMemo(() => {
    const items: string[] = [];
    if (seatingTime) {
      items.push('5 min before exam start: Pre-start warning chime');
    }
    if (readingMinutes > 0) {
      items.push('00:00 Reading Start: Phase start bell');
      const readingHours = Math.floor((readingMinutes - 1) / 60);
      for (let h = 1; h <= readingHours; h++) {
        items.push(`Reading +${h}h 00m: Hourly interval chime`);
      }
      items.push(`+${readingMinutes}m Reading End / Writing Start: Phase start bell`);
    } else {
      items.push('00:00 Writing Start: Phase start bell');
    }
    const writingHours = Math.floor((writingMinutes - 1) / 60);
    for (let h = 1; h <= writingHours; h++) {
      items.push(`Writing +${h}h 00m: Hourly interval chime`);
    }
    if (writingMinutes > 5) {
      items.push(`5 min before writing ends: Urgent warning alarm`);
    }
    items.push('Writing End: Final conclusion double bell');
    return items;
  }, [seatingTime, readingMinutes, writingMinutes]);

  // Persist activeExam to localStorage on every transition
  useEffect(() => {
    try {
      if (!activeExam) {
        localStorage.removeItem(EXAM_PERSIST_KEY);
      } else {
        localStorage.setItem(
          EXAM_PERSIST_KEY,
          JSON.stringify({
            ...activeExam,
            firedCheckpoints: Array.from(activeExam.firedCheckpoints),
          })
        );
      }
    } catch {
      // ignore storage errors
    }
  }, [activeExam]);

  const enterExamFullscreen = useCallback(() => {
    const el = examConsoleRef.current;
    if (el && typeof el.requestFullscreen === 'function' && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  // Fullscreen exit monitor: pauses active reading/writing exam and warns user
  useEffect(() => {
    const onFsChange = () => {
      if (document.fullscreenElement) {
        setFullscreenWarningOpen(false);
        return;
      }
      if (manualEndOrPauseRef.current) {
        manualEndOrPauseRef.current = false;
        return;
      }
      setActiveExam((prev) => {
        if (
          !prev ||
          prev.isPaused ||
          (prev.phase !== 'reading' && prev.phase !== 'writing')
        ) {
          return prev;
        }
        const elapsedSec = Math.floor((Date.now() - prev.phaseStartMs) / 1000);
        const totalPhaseSec = prev.phase === 'reading' ? prev.readingSec : prev.writingSec;
        const remaining = Math.max(0, totalPhaseSec - elapsedSec);
        playPreStartWarningAlarm();
        setFullscreenWarningOpen(true);
        setExamLogBanner('Fullscreen exited — Exam Timer automatically paused!');
        return {
          ...prev,
          isPaused: true,
          pausedRemainingSec: remaining,
        };
      });
    };

    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // --- TEST TIMER ENGINE ---
  useEffect(() => {
    if (!activeExam) {
      setExamDisplaySec(0);
      return;
    }
    if (activeExam.isPaused) {
      setExamDisplaySec(activeExam.pausedRemainingSec ?? 0);
      return;
    }
    if (activeExam.phase === 'finished') {
      setExamDisplaySec(0);
      return;
    }

    const interval = window.setInterval(() => {
      const now = Date.now();
      const fired = activeExam.firedCheckpoints;
      const fire = (key: string, msg: string, soundFn: () => void) => {
        if (!fired.has(key)) {
          fired.add(key);
          setExamLogBanner(msg);
          if (activeExam.alarmEnabled) soundFn();
        }
      };

      if (activeExam.phase === 'waiting_seating' && activeExam.seatingTimestampMs) {
        const diffSec = Math.ceil((activeExam.seatingTimestampMs - now) / 1000);
        if (diffSec <= 300 && diffSec > 0) {
          fire(
            'pre-start-5m',
            'Warning: 5 minutes remaining before exam begins.',
            playPreStartWarningAlarm
          );
        }
        if (diffSec <= 0) {
          if (activeExam.readingSec > 0) {
            fire(
              'reading-start',
              'Reading Time Started — Review your question paper.',
              playPhaseStartBell
            );
            setActiveExam((prev) =>
              prev
                ? {
                    ...prev,
                    phase: 'reading',
                    phaseStartMs: now,
                  }
                : null
            );
          } else {
            fire(
              'writing-start',
              'Writing Time Started — Begin answering.',
              playPhaseStartBell
            );
            setActiveExam((prev) =>
              prev
                ? {
                    ...prev,
                    phase: 'writing',
                    phaseStartMs: now,
                  }
                : null
            );
          }
          return;
        }
        setExamDisplaySec(diffSec);
        return;
      }

      if (activeExam.phase === 'reading') {
        const elapsedSec = Math.floor((now - activeExam.phaseStartMs) / 1000);
        const remaining = activeExam.readingSec - elapsedSec;

        if (activeExam.hourlyAlarm && elapsedSec > 0) {
          const hourIndex = Math.floor(elapsedSec / 3600);
          if (hourIndex >= 1 && elapsedSec < activeExam.readingSec) {
            fire(
              `read-hr-${hourIndex}`,
              `Reading Time: ${hourIndex} hour elapsed.`,
              playHourlyIntervalChime
            );
          }
        }

        if (remaining <= 0) {
          fire(
            'writing-start',
            'Reading Time Ended · Writing Time Started!',
            playPhaseStartBell
          );
          setActiveExam((prev) =>
            prev
              ? {
                  ...prev,
                  phase: 'writing',
                  phaseStartMs: now,
                }
              : null
          );
          return;
        }
        setExamDisplaySec(remaining);
        return;
      }

      if (activeExam.phase === 'writing') {
        const elapsedSec = Math.floor((now - activeExam.phaseStartMs) / 1000);
        const remaining = activeExam.writingSec - elapsedSec;

        if (activeExam.hourlyAlarm && elapsedSec > 0) {
          const hourIndex = Math.floor(elapsedSec / 3600);
          if (hourIndex >= 1 && elapsedSec < activeExam.writingSec) {
            fire(
              `write-hr-${hourIndex}`,
              `Writing Time: ${hourIndex} hour elapsed.`,
              playHourlyIntervalChime
            );
          }
        }

        if (remaining <= 300 && remaining > 0 && activeExam.writingSec > 300) {
          fire(
            'write-5m-warn',
            'Warning: 5 minutes remaining before writing ends!',
            playFiveMinWarningAlarm
          );
        }

        if (remaining <= 0) {
          fire('exam-end', 'Exam Concluded — Pens Down!', playExamEndBell);
          setExamDisplaySec(0);
          setActiveExam((prev) => (prev ? { ...prev, phase: 'finished' } : null));
          const durationSeconds = activeExam.readingSec + activeExam.writingSec;
          const label = `${activeExam.examLabel}: ${activeExam.subject}`;
          if (isGuest) {
            guestCreateStudyLog({ mode: 'test_timer', label, durationSeconds });
            onRefresh();
          } else {
            apiFetch<{ log: StudyLogItem; pointsAwarded?: number }>('/api/study-logs', {
              method: 'POST',
              body: JSON.stringify({
                mode: 'test_timer',
                label,
                durationSeconds,
              }),
            }).then(async (res) => {
              if (res?.pointsAwarded && res.pointsAwarded > 0) {
                setExamLogBanner(
                  `Exam Concluded — +${res.pointsAwarded} points awarded (+10 pts per 30 mins of exam timer)!`
                );
              }
              await Promise.all([onRefresh(), refreshProfile()]);
            });
          }
          return;
        }

        setExamDisplaySec(remaining);
      }
    }, 250);

    return () => window.clearInterval(interval);
  }, [activeExam, isGuest, onRefresh, refreshProfile]);

  const startExamSession = (params: {
    id?: number;
    subject: string;
    paperName: string;
    examLabel: string;
    readingMin: number;
    writingMin: number;
    seatingIso: string;
    alarm: boolean;
    hourly: boolean;
    immediate: boolean;
  }) => {
    const now = Date.now();
    const seatingMs =
      !params.immediate && params.seatingIso
        ? new Date(params.seatingIso).getTime()
        : null;
    const isFutureSeating = seatingMs !== null && seatingMs > now;

    const initialPhase: ActiveExamSession['phase'] = isFutureSeating
      ? 'waiting_seating'
      : params.readingMin > 0
        ? 'reading'
        : 'writing';

    if (params.alarm && !isFutureSeating) {
      playPhaseStartBell();
    }

    setExamLogBanner(
      isFutureSeating
        ? `Scheduled for seating at ${params.seatingIso.replace('T', ' ')}`
        : params.readingMin > 0
          ? 'Reading Time Started.'
          : 'Writing Time Started.'
    );

    setActiveExam({
      id: params.id,
      subject: params.subject,
      paperName: params.paperName,
      examLabel: params.examLabel,
      readingSec: params.readingMin * 60,
      writingSec: params.writingMin * 60,
      seatingTimestampMs: isFutureSeating ? seatingMs : null,
      alarmEnabled: params.alarm,
      hourlyAlarm: params.hourly,
      phase: initialPhase,
      phaseStartMs: now,
      pausedRemainingSec: null,
      isPaused: false,
      firedCheckpoints: new Set(),
    });

    if (!isFutureSeating) {
      setTimeout(() => enterExamFullscreen(), 50);
    }
  };

  const handleScheduleOrStartExam = async (mode: 'start_now' | 'schedule') => {
    const resolvedLabel =
      examType === 'Other' ? customExamType.trim() || 'Other Exam' : examType;

    const payload = {
      subject: subject.trim() || 'General',
      paperName: paperName.trim(),
      examType,
      customExamType: examType === 'Other' ? customExamType.trim() : '',
      readingMinutes: readingMinutes,
      writingMinutes: writingMinutes,
      seatingTime: seatingTime,
      alarmEnabled,
      hourlyAlarm,
      status: mode === 'start_now' ? 'running' : 'scheduled',
    };

    const saved = isGuest
      ? guestCreateExam(payload)
      : await apiFetch<ExamScheduleItem>('/api/exams', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
    await onRefresh();

    startExamSession({
      id: saved.id,
      subject: saved.subject,
      paperName: saved.paperName,
      examLabel: resolvedLabel,
      readingMin: saved.readingMinutes,
      writingMin: saved.writingMinutes,
      seatingIso: saved.seatingTime,
      alarm: saved.alarmEnabled,
      hourly: saved.hourlyAlarm,
      immediate: mode === 'start_now',
    });
  };

  const handleConfirmDeleteExam = async () => {
    if (!deleteExamTarget) return;
    if (isGuest) {
      guestDeleteExam(deleteExamTarget.id);
    } else {
      await apiFetch(`/api/exams/${deleteExamTarget.id}`, { method: 'DELETE' });
    }
    setDeleteExamTarget(null);
    await onRefresh();
  };

  // --- BASIC TIMER ENGINE (wall-clock persisted) ---
  useEffect(() => {
    try {
      localStorage.setItem(
        BASIC_PERSIST_KEY,
        JSON.stringify({
          label: basicLabel,
          minutes: basicMinutes,
          running: basicRunning,
          targetEndMs: basicTargetEndMs,
          remainingSec: basicRemainingSec,
        })
      );
    } catch {
      // ignore
    }
  }, [basicLabel, basicMinutes, basicRunning, basicTargetEndMs, basicRemainingSec]);

  useEffect(() => {
    if (!basicRunning || !basicTargetEndMs) return;
    const id = window.setInterval(() => {
      const rem = Math.ceil((basicTargetEndMs - Date.now()) / 1000);
      if (rem <= 0) {
        setBasicRunning(false);
        setBasicTargetEndMs(null);
        setBasicRemainingSec(0);
        playBasicTimerChime();
        const payload = {
          mode: 'basic_timer',
          label: basicLabel || 'Study Timer',
          durationSeconds: basicMinutes * 60,
        };
        if (isGuest) {
          guestCreateStudyLog(payload);
          onRefresh();
        } else {
          apiFetch('/api/study-logs', {
            method: 'POST',
            body: JSON.stringify(payload),
          }).then(() => onRefresh());
        }
      } else {
        setBasicRemainingSec(rem);
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [basicRunning, basicTargetEndMs, basicLabel, basicMinutes, isGuest, onRefresh]);

  // --- MICROSECOND STOPWATCH ENGINE (wall-clock persisted) ---
  useEffect(() => {
    try {
      localStorage.setItem(
        SW_PERSIST_KEY,
        JSON.stringify({
          running: swRunning,
          startWallMs: swStartWallMsRef.current,
          accumulatedUs: swAccumulatedUsRef.current,
          laps,
        })
      );
    } catch {
      // ignore
    }
  }, [swRunning, laps]);

  useEffect(() => {
    if (!swRunning) {
      if (swRafRef.current) cancelAnimationFrame(swRafRef.current);
      return;
    }
    swStartPerfRef.current = performance.now();
    const baseUs = swAccumulatedUsRef.current;

    const tick = () => {
      const nowPerf = performance.now();
      const deltaUs = (nowPerf - swStartPerfRef.current) * 1000;
      setSwElapsedUs(baseUs + deltaUs);
      swRafRef.current = requestAnimationFrame(tick);
    };
    swRafRef.current = requestAnimationFrame(tick);

    return () => {
      if (swRafRef.current) cancelAnimationFrame(swRafRef.current);
    };
  }, [swRunning]);

  const handleSwToggle = () => {
    if (swRunning) {
      const nowPerf = performance.now();
      const total = swAccumulatedUsRef.current + (nowPerf - swStartPerfRef.current) * 1000;
      swAccumulatedUsRef.current = total;
      setSwElapsedUs(total);
      setSwRunning(false);
    } else {
      swStartWallMsRef.current = Date.now();
      swStartPerfRef.current = performance.now();
      setSwRunning(true);
    }
  };

  const handleSwReset = () => {
    setSwRunning(false);
    swAccumulatedUsRef.current = 0;
    setSwElapsedUs(0);
    setLaps([]);
    try {
      localStorage.removeItem(SW_PERSIST_KEY);
    } catch {
      // ignore
    }
  };

  const handleSwLap = () => {
    const currentUs = swRunning
      ? swAccumulatedUsRef.current + (performance.now() - swStartPerfRef.current) * 1000
      : swElapsedUs;
    const prevTotal = laps[0]?.totalUs ?? 0;
    setLaps((prev) => [
      {
        index: prev.length + 1,
        totalUs: currentUs,
        splitUs: currentUs - prevTotal,
      },
      ...prev,
    ]);
  };

  const handleSaveStopwatchSession = async () => {
    const secs = Math.round(swElapsedUs / 1_000_000);
    if (secs <= 0) return;
    const payload = {
      mode: 'stopwatch',
      label: `Stopwatch (${laps.length} laps)`,
      durationSeconds: secs,
    };
    if (isGuest) {
      guestCreateStudyLog(payload);
    } else {
      await apiFetch('/api/study-logs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    }
    await onRefresh();
  };

  // --- PRO STUDY TIME LOGGER HANDLERS ---
  const handlePunchIn = () => {
    const now = Date.now();
    setPunchInMs(now);
    setLoggerMsg(`Punched IN at ${new Date(now).toLocaleTimeString()} (persists across page closes).`);
    try {
      localStorage.setItem(STUDY_PUNCH_KEY, String(now));
    } catch {
      // ignore
    }
  };

  const computeAndLogStudyHours = async (inMs: number, outMs: number) => {
    if (!Number.isFinite(inMs) || !Number.isFinite(outMs) || outMs <= inMs) {
      setLoggerMsg('Out time must be after In time.');
      return;
    }
    const grossMin = (outMs - inMs) / 60000;
    const sleepMin = Math.max(0, Number(sleepMinutesInput) || 0);
    const activeBeforeDeductionMin = Math.max(0, grossMin - sleepMin);
    const netStudyMin = activeBeforeDeductionMin * 0.975; // Total - 2.5%
    const netSeconds = Math.max(1, Math.round(netStudyMin * 60));

    setLoggerBusy(true);
    try {
      await apiFetch('/api/study-logs', {
        method: 'POST',
        body: JSON.stringify({
          mode: 'study_logger',
          label: `${loggerLabel.trim() || 'Study Session'} (Gross ${grossMin.toFixed(
            0
          )}m, Sleep ${sleepMin}m, -2.5% = ${netStudyMin.toFixed(1)}m)`,
          durationSeconds: netSeconds,
        }),
      });
      setPunchInMs(null);
      try {
        localStorage.removeItem(STUDY_PUNCH_KEY);
      } catch {
        // ignore
      }
      setManualInTime('');
      setManualOutTime('');
      setLoggerMsg(
        `Logged ${netStudyMin.toFixed(1)} net study mins (${(netStudyMin / 60).toFixed(
          2
        )} hrs) after ${sleepMin}m sleep & 2.5% deduction.`
      );
      await onRefresh();
    } catch (err) {
      setLoggerMsg(err instanceof Error ? err.message : 'Failed to log study hours');
    } finally {
      setLoggerBusy(false);
    }
  };

  const swFormatted = formatMicrosecondStopwatch(swElapsedUs);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-slate-900">
            Timers & Exam Simulation
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Specialized exam timers with automated audio checkpoints, study timers, and microsecond stopwatch.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 w-fit">
          {(
            [
              { id: 'test', label: 'Test Timers' },
              { id: 'basic', label: 'Basic Timers' },
              { id: 'stopwatch', label: 'Stopwatch (µs)' },
              { id: 'study-logger', label: 'Study Time Logger (Pro)' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`rounded-md px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: TEST TIMERS */}
      {activeTab === 'test' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Exam Configuration Form */}
          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Configure Specialized Exam Timer
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Subject
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g., Physics"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Paper Name (Optional)
                </label>
                <input
                  type="text"
                  value={paperName}
                  onChange={(e) => setPaperName(e.target.value)}
                  placeholder="e.g., Paper 1 Set A"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Exam Type
                </label>
                <select
                  value={examType}
                  onChange={(e) =>
                    setExamType(e.target.value as (typeof EXAM_TYPES)[number])
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {EXAM_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>

              {examType === 'Other' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Type Name
                  </label>
                  <input
                    type="text"
                    value={customExamType}
                    onChange={(e) => setCustomExamType(e.target.value)}
                    placeholder="Enter exam name..."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-600">
                    Seating Time (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={seatingTime}
                    onChange={(e) => setSeatingTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {examType === 'Other' && (
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Seating Time (Optional — Schedules Exam)
                </label>
                <input
                  type="datetime-local"
                  value={seatingTime}
                  onChange={(e) => setSeatingTime(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Reading Time (Minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={readingMinutes}
                  onChange={(e) => setReadingMinutes(Math.max(0, Number(e.target.value)))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Writing Time (Minutes)
                </label>
                <input
                  type="number"
                  min={1}
                  max={600}
                  value={writingMinutes}
                  onChange={(e) => setWritingMinutes(Math.max(1, Number(e.target.value)))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-100 pt-3">
              <label className="flex items-center justify-between text-xs font-medium text-slate-700 cursor-pointer">
                <span className="flex items-center gap-2">
                  <Bell className="h-3.5 w-3.5 text-blue-600" />
                  Enable Time Lapse Exam Alarms
                </span>
                <input
                  type="checkbox"
                  checked={alarmEnabled}
                  onChange={(e) => setAlarmEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
              </label>
              <label className="flex items-center justify-between text-xs font-medium text-slate-700 cursor-pointer">
                <span>Hourly Interval Alarm (if interval &gt; 1 hr)</span>
                <input
                  type="checkbox"
                  checked={hourlyAlarm}
                  onChange={(e) => setHourlyAlarm(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                />
              </label>

              <button
                type="button"
                onClick={playPhaseStartBell}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:underline"
              >
                <Volume2 className="h-3.5 w-3.5" />
                Test Exam Bell Sound
              </button>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 space-y-1">
              <div className="text-[11px] font-semibold text-slate-700">
                Automated Alarm Checkpoints:
              </div>
              {checkpointPreview.map((cp, idx) => (
                <div key={idx} className="text-[11px] text-slate-600 tabular-nums">
                  · {cp}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleScheduleOrStartExam('start_now')}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 whitespace-nowrap"
              >
                <Play className="h-4 w-4" />
                Start Exam Now
              </button>
              {seatingTime && (
                <button
                  type="button"
                  onClick={() => handleScheduleOrStartExam('schedule')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <CalendarClock className="h-4 w-4 text-blue-600" />
                  Schedule Seating
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Live Exam Console + Scheduled Queue */}
          <div className="lg:col-span-7 space-y-6">
            <div
              ref={examConsoleRef}
              className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-white flex flex-col justify-center"
            >
              {!activeExam ? (
                <div className="py-10 text-center space-y-2">
                  <div className="text-xs font-medium text-slate-400">
                    Exam Timer Ready (Fullscreen Exam Mode &amp; Persistent Clock)
                  </div>
                  <div className="font-mono text-5xl font-bold tracking-tight text-slate-200 tabular-nums">
                    {formatHMS((readingMinutes + writingMinutes) * 60)}
                  </div>
                  <p className="text-xs text-slate-400">
                    Runs continuously even if closed. Active exams enter fullscreen &amp; pause if exited.
                  </p>
                  <p className="pt-2 text-[11px] text-amber-300/90">
                    Signed-in users earn +10 points per 30 minutes completed in Exam Timer.
                  </p>
                </div>
              ) : (
                <div className="space-y-6 max-w-2xl w-full mx-auto">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
                    <div>
                      <div className="text-xs font-medium text-blue-400">
                        {activeExam.examLabel} · {activeExam.subject}
                        {activeExam.paperName ? ` · ${activeExam.paperName}` : ''}
                      </div>
                      <div className="mt-1 text-lg font-semibold text-white">
                        {activeExam.phase === 'waiting_seating'
                          ? 'Countdown to Seating / Exam Start'
                          : activeExam.phase === 'reading'
                            ? 'Reading Time Active (Fullscreen)'
                            : activeExam.phase === 'writing'
                              ? 'Writing Time Active (Fullscreen)'
                              : 'Exam Concluded'}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-400 tabular-nums">
                      <span>
                        Read {Math.round(activeExam.readingSec / 60)}m · Write{' '}
                        {Math.round(activeExam.writingSec / 60)}m
                      </span>
                      <button
                        type="button"
                        onClick={enterExamFullscreen}
                        className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                      >
                        <Maximize2 className="h-3 w-3" />
                        Fullscreen
                      </button>
                    </div>
                  </div>

                  <div className="py-4 text-center">
                    <div className="font-mono text-6xl font-bold tracking-tight text-white tabular-nums">
                      {formatHMS(examDisplaySec)}
                    </div>
                    {examLogBanner && (
                      <div className="mt-3 text-xs font-medium text-amber-300">
                        {examLogBanner}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-3">
                    {activeExam.phase !== 'finished' && (
                      <button
                        type="button"
                        onClick={() => {
                          if (activeExam.isPaused) {
                            enterExamFullscreen();
                          } else {
                            manualEndOrPauseRef.current = true;
                          }
                          setActiveExam((prev) => {
                            if (!prev) return null;
                            if (prev.isPaused) {
                              const totalPhaseSec =
                                prev.phase === 'reading'
                                  ? prev.readingSec
                                  : prev.writingSec;
                              const elapsed =
                                totalPhaseSec - (prev.pausedRemainingSec ?? examDisplaySec);
                              return {
                                ...prev,
                                isPaused: false,
                                phaseStartMs: Date.now() - elapsed * 1000,
                                pausedRemainingSec: null,
                              };
                            }
                            return {
                              ...prev,
                              isPaused: true,
                              pausedRemainingSec: examDisplaySec,
                            };
                          });
                        }}
                        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        {activeExam.isPaused ? (
                          <>
                            <Play className="h-4 w-4" />
                            Resume
                          </>
                        ) : (
                          <>
                            <Pause className="h-4 w-4" />
                            Pause
                          </>
                        )}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        manualEndOrPauseRef.current = true;
                        if (document.fullscreenElement) {
                          document.exitFullscreen().catch(() => {});
                        }
                        setActiveExam(null);
                        setExamLogBanner(null);
                      }}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700"
                    >
                      <RotateCcw className="h-4 w-4" />
                      End / Reset
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Scheduled Exams List */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Scheduled & Saved Exams
              </h3>
              {exams.length === 0 ? (
                <p className="text-xs text-slate-500">
                  No scheduled exams yet. Use "Schedule Seating" or "Start Exam Now" to store sessions.
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {exams.map((ex) => {
                    const label =
                      ex.examType === 'Other'
                        ? ex.customExamType || 'Custom Exam'
                        : ex.examType;
                    return (
                      <div
                        key={ex.id}
                        className="flex flex-wrap items-center justify-between gap-3 py-3"
                      >
                        <div>
                          <div className="text-sm font-medium text-slate-900">
                            {ex.subject} {ex.paperName ? `— ${ex.paperName}` : ''}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 tabular-nums">
                            {label} · Read {ex.readingMinutes}m / Write{' '}
                            {ex.writingMinutes}m
                            {ex.seatingTime
                              ? ` · Seating: ${ex.seatingTime.replace('T', ' ')}`
                              : ''}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              startExamSession({
                                id: ex.id,
                                subject: ex.subject,
                                paperName: ex.paperName,
                                examLabel: label,
                                readingMin: ex.readingMinutes,
                                writingMin: ex.writingMinutes,
                                seatingIso: ex.seatingTime,
                                alarm: ex.alarmEnabled,
                                hourly: ex.hourlyAlarm,
                                immediate: !ex.seatingTime,
                              })
                            }
                            className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Load Timer
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteExamTarget(ex)}
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            aria-label="Delete scheduled exam"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BASIC TIMERS */}
      {activeTab === 'basic' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 rounded-xl border border-slate-200 bg-white p-8 flex flex-col items-center justify-center space-y-6">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {[
                { label: 'Pomodoro (25m)', min: 25 },
                { label: 'Deep Focus (50m)', min: 50 },
                { label: 'Revision Sprint (15m)', min: 15 },
                { label: 'Short Break (5m)', min: 5 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setBasicRunning(false);
                    setBasicTargetEndMs(null);
                    setBasicLabel(preset.label);
                    setBasicMinutes(preset.min);
                    setBasicRemainingSec(preset.min * 60);
                  }}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  {preset.label}
                </button>
              ))}
            </div>

            <div className="font-mono text-6xl font-bold tracking-tight text-slate-900 tabular-nums">
              {formatHMS(basicRemainingSec)}
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full max-w-md">
              <input
                type="text"
                value={basicLabel}
                onChange={(e) => setBasicLabel(e.target.value)}
                placeholder="Session Label"
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
              />
              <input
                type="number"
                min={1}
                max={300}
                value={basicMinutes}
                onChange={(e) => {
                  const m = Math.max(1, Number(e.target.value) || 1);
                  setBasicRunning(false);
                  setBasicTargetEndMs(null);
                  setBasicMinutes(m);
                  setBasicRemainingSec(m * 60);
                }}
                className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  if (basicRunning) {
                    setBasicRunning(false);
                    setBasicTargetEndMs(null);
                  } else {
                    const sec = basicRemainingSec > 0 ? basicRemainingSec : basicMinutes * 60;
                    setBasicRemainingSec(sec);
                    setBasicTargetEndMs(Date.now() + sec * 1000);
                    setBasicRunning(true);
                  }
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                {basicRunning ? (
                  <>
                    <Pause className="h-4 w-4" />
                    Pause
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Start
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBasicRunning(false);
                  setBasicTargetEndMs(null);
                  setBasicRemainingSec(basicMinutes * 60);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
            </div>
          </div>

          <div className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Recent Study Timer Logs
            </h3>
            {studyLogs.length === 0 ? (
              <p className="text-xs text-slate-500">
                Completed timer and stopwatch sessions will appear here.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
                {studyLogs.slice(0, 12).map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center justify-between py-2.5 text-xs"
                  >
                    <div>
                      <div className="font-medium text-slate-800">{log.label}</div>
                      <div className="text-slate-400 capitalize">
                        {log.mode.replace('_', ' ')}
                      </div>
                    </div>
                    <span className="font-mono font-semibold text-slate-700 tabular-nums">
                      {formatHMS(log.durationSeconds)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: MICROSECOND STOPWATCH */}
      {activeTab === 'stopwatch' && (
        <div className="rounded-xl border border-slate-200 bg-white p-8 space-y-8">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-center">
            <div className="text-xs font-medium text-slate-400">
              High-Precision Microsecond Stopwatch (HH:MM:SS · ms · µs)
            </div>
            <div className="mt-4 flex flex-wrap items-baseline justify-center gap-2 font-mono tabular-nums">
              <span className="text-5xl sm:text-6xl font-bold text-white">
                {swFormatted.hms}
              </span>
              <span className="text-3xl sm:text-4xl font-semibold text-blue-400">
                .{swFormatted.ms}
              </span>
              <span className="text-2xl sm:text-3xl font-medium text-emerald-400">
                .{swFormatted.us}
              </span>
              <span className="ml-1 text-sm text-slate-400">µs</span>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={handleSwToggle}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                {swRunning ? (
                  <>
                    <Pause className="h-4 w-4" />
                    Stop
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4" />
                    Start
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handleSwLap}
                disabled={swElapsedUs === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                <Flag className="h-4 w-4" />
                Lap
              </button>
              <button
                type="button"
                onClick={handleSwReset}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-5 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-700"
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </button>
              <button
                type="button"
                onClick={handleSaveStopwatchSession}
                disabled={swElapsedUs < 1_000_000}
                className="inline-flex items-center gap-2 rounded-lg border border-blue-500/40 bg-blue-950 px-5 py-2.5 text-sm font-medium text-blue-200 hover:bg-blue-900 disabled:opacity-40"
              >
                Log Session
              </button>
            </div>
          </div>

          {laps.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-4 font-medium">Lap</th>
                    <th className="py-2 pr-4 font-medium">Split Time</th>
                    <th className="py-2 font-medium text-right">Total Elapsed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {laps.map((lap) => {
                    const split = formatMicrosecondStopwatch(lap.splitUs);
                    const total = formatMicrosecondStopwatch(lap.totalUs);
                    return (
                      <tr key={lap.index}>
                        <td className="py-2.5 pr-4 font-semibold text-slate-700">
                          Lap {lap.index}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">
                          {split.hms}.{split.ms}.{split.us} µs
                        </td>
                        <td className="py-2.5 text-right text-slate-900">
                          {total.hms}.{total.ms}.{total.us} µs
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: PRO STUDY TIME LOGGER (IN/OUT - 2.5% DEDUCTION + OPTIONAL SLEEP) */}
      {activeTab === 'study-logger' &&
        (!isEffectiveProOrAdmin ? (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center space-y-3">
            <Lock className="mx-auto h-6 w-6 text-blue-600" />
            <h2 className="font-display text-lg font-bold text-slate-900">
              Study Time Logger Requires Pro Plan
            </h2>
            <p className="mx-auto max-w-lg text-xs text-slate-600">
              Track In &amp; Out study punches, optional sleep deductions, and automatic 2.5% break overhead subtraction with Pro (500 pts/month or 5,100 pts/year).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-5">
              <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                <ClipboardCheck className="h-4 w-4 text-blue-600" />
                <h2 className="font-display text-base font-semibold text-slate-900">
                  Study Time Logger (In / Out · Total − 2.5% − Optional Sleep)
                </h2>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Session Label / Subject
                </label>
                <input
                  type="text"
                  value={loggerLabel}
                  onChange={(e) => setLoggerLabel(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">
                  Optional Sleep / Rest Time (Minutes)
                </label>
                <input
                  type="number"
                  min={0}
                  value={sleepMinutesInput}
                  onChange={(e) => setSleepMinutesInput(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-800">
                  Live Punch In / Punch Out (Persists Even If Page Closes)
                </div>
                {punchInMs ? (
                  <div className="space-y-3">
                    <div className="text-xs text-slate-600 tabular-nums">
                      Punched IN at:{' '}
                      <strong className="text-slate-900">
                        {new Date(punchInMs).toLocaleString()}
                      </strong>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={loggerBusy}
                        onClick={() => computeAndLogStudyHours(punchInMs, Date.now())}
                        className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                      >
                        Punch Out &amp; Log (-2.5%)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPunchInMs(null);
                          localStorage.removeItem(STUDY_PUNCH_KEY);
                        }}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600"
                      >
                        Cancel Punch
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handlePunchIn}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                  >
                    Punch In Now
                  </button>
                )}
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="text-xs font-semibold text-slate-800">
                  Or Enter Manual In &amp; Out Window
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] text-slate-500">In Time</label>
                    <input
                      type="datetime-local"
                      value={manualInTime}
                      onChange={(e) => setManualInTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-500">Out Time</label>
                    <input
                      type="datetime-local"
                      value={manualOutTime}
                      onChange={(e) => setManualOutTime(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs tabular-nums focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  disabled={loggerBusy || !manualInTime || !manualOutTime}
                  onClick={() =>
                    computeAndLogStudyHours(
                      new Date(manualInTime).getTime(),
                      new Date(manualOutTime).getTime()
                    )
                  }
                  className="rounded-lg border border-slate-300 bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Calculate &amp; Log (-2.5% Deduction)
                </button>
              </div>

              {loggerMsg && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-xs text-blue-900">
                  {loggerMsg}
                </div>
              )}
            </div>

            <div className="lg:col-span-6 rounded-xl border border-slate-200 bg-white p-6 space-y-4">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Logged Study Time History
              </h3>
              <p className="text-xs text-slate-500">
                Formula: <code className="font-mono">Net Study = (Total − Optional Sleep) × 0.975</code> (−2.5% adjustment).
              </p>
              {studyLogs.filter((l) => l.mode === 'study_logger').length === 0 ? (
                <p className="py-8 text-center text-xs text-slate-500">
                  No study logger entries yet.
                </p>
              ) : (
                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
                  {studyLogs
                    .filter((l) => l.mode === 'study_logger')
                    .map((log) => (
                      <div
                        key={log.id}
                        className="flex items-center justify-between gap-3 py-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900">{log.label}</div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <span className="font-mono font-bold text-emerald-700 tabular-nums shrink-0">
                          {formatHMS(log.durationSeconds)}
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        ))}

      {/* Fullscreen Exit Warning Modal */}
      {fullscreenWarningOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/75 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-display text-base font-bold text-slate-900">
                  Fullscreen Exited — Exam Paused
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  Exam conditions require fullscreen mode. Your exam timer has been paused automatically to preserve integrity.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setFullscreenWarningOpen(false)}
                className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Stay Paused
              </button>
              <button
                type="button"
                onClick={() => {
                  setFullscreenWarningOpen(false);
                  enterExamFullscreen();
                  setActiveExam((prev) => {
                    if (!prev || !prev.isPaused) return prev;
                    const totalPhaseSec =
                      prev.phase === 'reading' ? prev.readingSec : prev.writingSec;
                    const elapsed =
                      totalPhaseSec - (prev.pausedRemainingSec ?? examDisplaySec);
                    return {
                      ...prev,
                      isPaused: false,
                      phaseStartMs: Date.now() - elapsed * 1000,
                      pausedRemainingSec: null,
                    };
                  });
                }}
                className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                Re-enter Fullscreen &amp; Resume
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteExamTarget)}
        title="Delete Scheduled Exam?"
        description={`Delete "${deleteExamTarget?.subject}" (${deleteExamTarget?.examType})?`}
        confirmLabel="Delete Forever"
        destructive
        onConfirm={handleConfirmDeleteExam}
        onCancel={() => setDeleteExamTarget(null)}
      />
    </div>
  );
};
