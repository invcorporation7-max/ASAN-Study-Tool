// Web Audio API synthesizer for deterministic, zero-dependency exam and study alarms

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function playTone(
  freq: number,
  startOffsetSec: number,
  durationSec: number,
  type: OscillatorType = 'sine',
  peakGain = 0.25
) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime + startOffsetSec;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peakGain, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + durationSec + 0.04);
}

export function playPreStartWarningAlarm() {
  // Two crisp medium chimes (5 mins before start)
  playTone(659.25, 0, 0.25, 'triangle', 0.22);
  playTone(880, 0.28, 0.35, 'triangle', 0.22);
}

export function playPhaseStartBell() {
  // Authoritative 3-note rising exam bell (Start of reading / Start of writing)
  playTone(523.25, 0, 0.25, 'sine', 0.28);
  playTone(659.25, 0.22, 0.25, 'sine', 0.28);
  playTone(783.99, 0.44, 0.65, 'sine', 0.3);
}

export function playHourlyIntervalChime() {
  // Single clear Westminster-style hour chime
  playTone(587.33, 0, 0.35, 'sine', 0.22);
  playTone(440, 0.35, 0.55, 'sine', 0.22);
}

export function playFiveMinWarningAlarm() {
  // Urgent 3-pulse warning (5 mins before writing ends)
  playTone(880, 0, 0.18, 'triangle', 0.25);
  playTone(880, 0.24, 0.18, 'triangle', 0.25);
  playTone(1046.5, 0.48, 0.42, 'triangle', 0.28);
}

export function playExamEndBell() {
  // Sustained double exam conclusion bell
  playTone(523.25, 0, 0.5, 'sine', 0.32);
  playTone(523.25, 0.55, 0.85, 'sine', 0.35);
}

export function playBasicTimerChime() {
  playTone(659.25, 0, 0.22, 'sine', 0.24);
  playTone(783.99, 0.2, 0.22, 'sine', 0.24);
  playTone(1046.5, 0.4, 0.5, 'sine', 0.26);
}
