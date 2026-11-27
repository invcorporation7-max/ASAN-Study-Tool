import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Atom,
  Beaker,
  Box,
  Compass,
  Droplets,
  FlaskConical,
  Pause,
  Play,
  RotateCcw,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { MotionVisualizer3D } from './MotionVisualizer3D';

type MainLabModule = 'labs' | 'motion-3d';
type VirtualBenchId = 'mechanics' | 'optics' | 'titration' | 'rc-circuit';

interface MechanicsState {
  thetaDeg: number;
  m1: number;
  m2: number;
  muS: number;
  muK: number;
  g: number;
}

interface OpticsState {
  lensType: 'convex' | 'concave';
  focalCm: number;
  objectDistCm: number;
  objectHeightCm: number;
}

interface TitrationState {
  acidType: 'strong' | 'weak';
  indicator: 'phenolphthalein' | 'methyl_orange' | 'bromothymol';
  ca: number;
  vaMl: number;
  cb: number;
  vbAddedMl: number;
}

interface RcCircuitState {
  emf: number;
  resistanceOhm: number;
  capacitanceUf: number;
  mode: 'charge' | 'discharge';
}

function computeTitrationPh(state: TitrationState, vbMl: number): number {
  const vaL = state.vaMl / 1000;
  const vbL = vbMl / 1000;
  const totalL = Math.max(1e-6, vaL + vbL);
  const na = state.ca * vaL;
  const nb = state.cb * vbL;
  const kw = 1e-14;

  if (state.acidType === 'strong') {
    if (Math.abs(na - nb) < 1e-11) return 7;
    if (na > nb) {
      const hPlus = (na - nb) / totalL;
      return Math.max(0, Math.min(14, -Math.log10(Math.max(1e-14, hPlus))));
    }
    const ohMinus = (nb - na) / totalL;
    const pOh = -Math.log10(Math.max(1e-14, ohMinus));
    return Math.max(0, Math.min(14, 14 - pOh));
  }

  // Weak acid: Acetic acid Ka = 1.75e-5 (pKa = 4.757)
  const ka = 1.75e-5;
  if (vbMl <= 0.0001) {
    const h = (-ka + Math.sqrt(ka * ka + 4 * ka * state.ca)) / 2;
    return Math.max(0, Math.min(14, -Math.log10(Math.max(1e-14, h))));
  }
  if (na - nb > 1e-9) {
    // Buffer region: Henderson-Hasselbalch + small-ion floor
    const pKa = -Math.log10(ka);
    const ratio = nb / (na - nb);
    const ph = pKa + Math.log10(Math.max(1e-6, ratio));
    return Math.max(0.5, Math.min(13.5, ph));
  }
  if (Math.abs(na - nb) <= 1e-9) {
    const cSalt = na / totalL;
    const kb = kw / ka;
    const oh = Math.sqrt(kb * cSalt);
    return Math.max(0, Math.min(14, 14 + Math.log10(Math.max(1e-14, oh))));
  }
  const ohExcess = (nb - na) / totalL;
  return Math.max(0, Math.min(14, 14 + Math.log10(Math.max(1e-14, ohExcess))));
}

function getIndicatorHex(indicator: TitrationState['indicator'], ph: number): { color: string; label: string } {
  if (indicator === 'phenolphthalein') {
    if (ph < 8.2) return { color: 'rgba(226, 232, 240, 0.32)', label: 'Colorless (Acidic/Neutral)' };
    if (ph < 9.8) return { color: 'rgba(244, 114, 182, 0.52)', label: 'Faint Endpoint Pink' };
    return { color: 'rgba(219, 39, 119, 0.78)', label: 'Deep Magenta (Basic)' };
  }
  if (indicator === 'methyl_orange') {
    if (ph < 3.1) return { color: 'rgba(239, 68, 68, 0.78)', label: 'Red (Acidic)' };
    if (ph < 4.4) return { color: 'rgba(249, 115, 22, 0.76)', label: 'Orange Transition' };
    return { color: 'rgba(250, 204, 21, 0.78)', label: 'Yellow (Basic)' };
  }
  if (ph < 6.0) return { color: 'rgba(250, 204, 21, 0.78)', label: 'Yellow (Acidic)' };
  if (ph < 7.6) return { color: 'rgba(34, 197, 94, 0.72)', label: 'Emerald Neutral' };
  return { color: 'rgba(37, 99, 235, 0.78)', label: 'Royal Blue (Basic)' };
}

export const VirtualLabsView: React.FC = () => {
  const { dbUser } = useAuth();
  const visualEffectsOn = dbUser?.eliteVisualEffects !== false;

  const [activeModule, setActiveModule] = useState<MainLabModule>('labs');
  const [activeBench, setActiveBench] = useState<VirtualBenchId>('mechanics');

  // --- Mechanics Bench State ---
  const [mech, setMech] = useState<MechanicsState>({
    thetaDeg: 30,
    m1: 4.5,
    m2: 3.2,
    muS: 0.25,
    muK: 0.16,
    g: 9.81,
  });
  const [mechRunning, setMechRunning] = useState(true);
  const [mechResetTick, setMechResetTick] = useState(0);
  const [mechTelemetry, setMechTelemetry] = useState({
    t: 0,
    s: 0,
    v: 0,
    a: 0,
    tension: 0,
    regime: 'Moving',
  });
  const mechCanvasRef = useRef<HTMLCanvasElement>(null);

  // --- Optics Bench State ---
  const [optics, setOptics] = useState<OpticsState>({
    lensType: 'convex',
    focalCm: 14,
    objectDistCm: 24,
    objectHeightCm: 4.2,
  });
  const opticsCanvasRef = useRef<HTMLCanvasElement>(null);

  // --- Titration Bench State ---
  const [titration, setTitration] = useState<TitrationState>({
    acidType: 'weak',
    indicator: 'phenolphthalein',
    ca: 0.1,
    vaMl: 25,
    cb: 0.1,
    vbAddedMl: 12,
  });
  const [autoTitrate, setAutoTitrate] = useState(false);
  const titrationCanvasRef = useRef<HTMLCanvasElement>(null);

  // --- RC Circuit Bench State ---
  const [rc, setRc] = useState<RcCircuitState>({
    emf: 12,
    resistanceOhm: 1000,
    capacitanceUf: 470,
    mode: 'charge',
  });
  const [rcRunning, setRcRunning] = useState(true);
  const [rcResetTick, setRcResetTick] = useState(0);
  const [rcTelemetry, setRcTelemetry] = useState({
    tMs: 0,
    vc: 0,
    currentMa: 0,
    tauMs: 470,
    energyMj: 0,
  });
  const rcCanvasRef = useRef<HTMLCanvasElement>(null);

  // Derived mechanics equations
  const mechPhysics = useMemo(() => {
    const rad = (mech.thetaDeg * Math.PI) / 180;
    const w1Par = mech.m1 * mech.g * Math.sin(rad); // down incline
    const normal = mech.m1 * mech.g * Math.cos(rad);
    const w2 = mech.m2 * mech.g; // pulls block UP incline if w2 > w1Par
    const netDrive = w2 - w1Par;
    const maxStatic = mech.muS * normal;
    const totalMass = mech.m1 + mech.m2;

    let accel = 0;
    let tension = w2;
    let regime = 'Static Equilibrium';
    if (Math.abs(netDrive) > maxStatic + 1e-4) {
      const sign = Math.sign(netDrive); // +1 moves up slope, -1 moves down slope
      const fk = mech.muK * normal * sign;
      accel = (netDrive - fk) / totalMass;
      tension = mech.m2 * (mech.g - accel);
      regime = sign > 0 ? 'Pulling Up Incline' : 'Sliding Down Incline';
    }
    return { w1Par, normal, w2, maxStatic, accel, tension, regime };
  }, [mech]);

  // Derived optics equations
  const opticsPhysics = useMemo(() => {
    const f = optics.lensType === 'convex' ? optics.focalCm : -optics.focalCm;
    const u = -Math.abs(optics.objectDistCm);
    const denom = 1 / f + 1 / u;
    const v = Math.abs(denom) < 1e-6 ? Infinity : 1 / denom;
    const m = Number.isFinite(v) ? v / u : Infinity;
    const hi = Number.isFinite(m) ? m * optics.objectHeightCm : Infinity;
    const nature = !Number.isFinite(v)
      ? 'Image at Infinity (Collimated Rays)'
      : v > 0
        ? m < 0
          ? 'Real & Inverted'
          : 'Real & Erect'
        : 'Virtual & Erect';
    return { f, u, v, m, hi, nature };
  }, [optics]);

  // Derived titration readouts
  const titrationReadout = useMemo(() => {
    const eqMl = (titration.ca * titration.vaMl) / Math.max(0.001, titration.cb);
    const currentPh = computeTitrationPh(titration, titration.vbAddedMl);
    const ind = getIndicatorHex(titration.indicator, currentPh);
    return { eqMl, currentPh, ind };
  }, [titration]);

  // Mechanics Canvas Simulation Loop
  useEffect(() => {
    if (activeModule !== 'labs' || activeBench !== 'mechanics') return;
    const canvas = mechCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let lastTs = performance.now();
    let simT = 0;
    let posS = 0; // displacement along ramp in meters (-1.6 to +1.6)
    let vel = 0;
    let uiClock = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.04, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      if (mechRunning) {
        simT += dt;
        vel += mechPhysics.accel * dt;
        posS += vel * dt;
        if (posS > 1.7 || posS < -1.7) {
          posS = Math.max(-1.7, Math.min(1.7, posS));
          vel = 0;
        }
      }

      uiClock += dt;
      if (uiClock >= 0.08) {
        uiClock = 0;
        setMechTelemetry({
          t: simT,
          s: posS,
          v: vel,
          a: posS >= 1.7 || posS <= -1.7 ? 0 : mechPhysics.accel,
          tension: mechPhysics.tension,
          regime: mechPhysics.regime,
        });
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth || 720;
      const h = canvas.clientHeight || 390;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Laboratory dark optical grid background
      ctx.fillStyle = '#09101f';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x < w; x += 28) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y < h; y += 28) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      const baseY = h - 54;
      const rad = (mech.thetaDeg * Math.PI) / 180;
      const rampLen = Math.min(w * 0.62, 420);
      const pulleyX = w * 0.72;
      const pulleyY = Math.max(76, baseY - Math.sin(rad) * rampLen);
      const baseLeftX = pulleyX - Math.cos(rad) * rampLen;

      // Ground line
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(32, baseY);
      ctx.lineTo(w - 32, baseY);
      ctx.stroke();

      // Wedge triangle
      ctx.fillStyle = 'rgba(30, 58, 138, 0.38)';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(baseLeftX, baseY);
      ctx.lineTo(pulleyX, baseY);
      ctx.lineTo(pulleyX, pulleyY);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Angle arc
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(baseLeftX, baseY, 34, -rad, 0);
      ctx.stroke();
      ctx.fillStyle = '#fde68a';
      ctx.font = '600 11px JetBrains Mono, monospace';
      ctx.fillText(`${mech.thetaDeg}°`, baseLeftX + 40, baseY - 10);

      // Block 1 position along ramp
      const midFrac = 0.5 + posS / 4.2;
      const clampedFrac = Math.max(0.14, Math.min(0.82, midFrac));
      const bx = baseLeftX + Math.cos(rad) * (rampLen * clampedFrac);
      const by = baseY - Math.sin(rad) * (rampLen * clampedFrac);
      const blockW = 48;
      const blockH = 34;

      // Normal & tangent unit vectors
      const tx = Math.cos(rad);
      const ty = -Math.sin(rad);
      const nx = -Math.sin(rad);
      const ny = -Math.cos(rad);

      const blockCenterX = bx + nx * (blockH / 2);
      const blockCenterY = by + ny * (blockH / 2);

      // Rope from block center to pulley and hanging mass m2
      const pulleyR = 14;
      const ropePullX = pulleyX + nx * pulleyR;
      const ropePullY = pulleyY + ny * pulleyR;
      const dropLen = 95 + (posS / 4.2) * rampLen;
      const clampedDrop = Math.max(46, Math.min(baseY - pulleyY - 38, dropLen));

      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(blockCenterX, blockCenterY);
      ctx.lineTo(ropePullX, ropePullY);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(pulleyX + pulleyR, pulleyY);
      ctx.lineTo(pulleyX + pulleyR, pulleyY + clampedDrop);
      ctx.stroke();

      // Pulley wheel
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(pulleyX, pulleyY, pulleyR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(pulleyX, pulleyY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Block m1 (rotated on slope)
      ctx.save();
      ctx.translate(blockCenterX, blockCenterY);
      ctx.rotate(-rad);
      ctx.fillStyle = '#2563eb';
      ctx.strokeStyle = '#93c5fd';
      ctx.lineWidth = 2;
      ctx.fillRect(-blockW / 2, -blockH / 2, blockW, blockH);
      ctx.strokeRect(-blockW / 2, -blockH / 2, blockW, blockH);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 12px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${mech.m1.toFixed(1)}kg`, 0, 4);
      ctx.restore();

      // Hanging block m2
      const m2W = 42;
      const m2H = 38;
      const m2X = pulleyX + pulleyR - m2W / 2;
      const m2Y = pulleyY + clampedDrop;
      ctx.fillStyle = '#0ea5e9';
      ctx.strokeStyle = '#bae6fd';
      ctx.lineWidth = 2;
      ctx.fillRect(m2X, m2Y, m2W, m2H);
      ctx.strokeRect(m2X, m2Y, m2W, m2H);
      ctx.fillStyle = '#082f49';
      ctx.font = '700 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${mech.m2.toFixed(1)}kg`, m2X + m2W / 2, m2Y + 23);
      ctx.textAlign = 'left';

      // Force vector labels near block m1
      const vecLen = 42;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(blockCenterX, blockCenterY);
      ctx.lineTo(blockCenterX + nx * vecLen, blockCenterY + ny * vecLen);
      ctx.stroke();
      ctx.fillStyle = '#6ee7b7';
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.fillText('N', blockCenterX + nx * (vecLen + 8), blockCenterY + ny * (vecLen + 8));

      ctx.strokeStyle = '#fb923c';
      ctx.beginPath();
      ctx.moveTo(blockCenterX, blockCenterY);
      ctx.lineTo(blockCenterX + tx * 46, blockCenterY + ty * 46);
      ctx.stroke();
      ctx.fillStyle = '#fdba74';
      ctx.fillText('T', blockCenterX + tx * 52, blockCenterY + ty * 52);

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [activeModule, activeBench, mech, mechPhysics, mechRunning, mechResetTick]);

  // Optics Bench Drawing Effect
  useEffect(() => {
    if (activeModule !== 'labs' || activeBench !== 'optics') return;
    const canvas = opticsCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 720;
    const h = canvas.clientHeight || 390;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#09101f';
    ctx.fillRect(0, 0, w, h);

    // Subtle optical grid
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (let y = 0; y < h; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const cx = w * 0.5;
    const cy = h * 0.52;
    const pxPerCm = Math.max(4.5, Math.min(8.5, w / 95));

    // Optical bench principal axis
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(20, cy);
    ctx.lineTo(w - 20, cy);
    ctx.stroke();

    // Ruler ticks
    for (let cm = -40; cm <= 40; cm += 5) {
      const tx = cx + cm * pxPerCm;
      if (tx < 24 || tx > w - 24) continue;
      ctx.strokeStyle = cm === 0 ? '#94a3b8' : '#334155';
      ctx.beginPath();
      ctx.moveTo(tx, cy - (cm % 10 === 0 ? 6 : 3));
      ctx.lineTo(tx, cy + (cm % 10 === 0 ? 6 : 3));
      ctx.stroke();
    }

    // Lens drawing
    const lensH = 140;
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (optics.lensType === 'convex') {
      ctx.ellipse(cx, cy, 13, lensH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.moveTo(cx - 14, cy - lensH / 2);
      ctx.quadraticCurveTo(cx - 2, cy, cx - 14, cy + lensH / 2);
      ctx.lineTo(cx + 14, cy + lensH / 2);
      ctx.quadraticCurveTo(cx + 2, cy, cx + 14, cy - lensH / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // F and 2F markers
    const fAbsPx = optics.focalCm * pxPerCm;
    const marks = [
      { x: cx - fAbsPx, label: 'F₁' },
      { x: cx + fAbsPx, label: 'F₂' },
      { x: cx - 2 * fAbsPx, label: '2F₁' },
      { x: cx + 2 * fAbsPx, label: '2F₂' },
    ];
    marks.forEach((mk) => {
      if (mk.x < 16 || mk.x > w - 16) return;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(mk.x, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fde68a';
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.fillText(mk.label, mk.x - 7, cy + 16);
    });

    // Object arrow
    const ox = cx + opticsPhysics.u * pxPerCm;
    const objTopY = cy - optics.objectHeightCm * pxPerCm * 1.4;
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ox, cy);
    ctx.lineTo(ox, objTopY);
    ctx.stroke();
    ctx.fillStyle = '#34d399';
    ctx.beginPath();
    ctx.moveTo(ox, objTopY - 8);
    ctx.lineTo(ox - 5, objTopY + 3);
    ctx.lineTo(ox + 5, objTopY + 3);
    ctx.closePath();
    ctx.fill();
    ctx.font = '600 11px JetBrains Mono, monospace';
    ctx.fillText('Object', ox - 18, objTopY - 14);

    // Three principal rays
    const focalTargetX = cx + opticsPhysics.f * pxPerCm;
    const rayColor = '#f59e0b';
    const ray2Color = '#22d3ee';
    const ray3Color = '#a78bfa';

    // Ray 1: Parallel to axis, then through F2 (or diverging from F1)
    ctx.strokeStyle = rayColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(ox, objTopY);
    ctx.lineTo(cx, objTopY);
    const slope1 = (cy - objTopY) / (focalTargetX - cx);
    ctx.lineTo(w - 16, objTopY + slope1 * (w - 16 - cx));
    ctx.stroke();

    // Ray 2: Straight through optical center (0,0)
    const slope2 = (cy - objTopY) / (cx - ox);
    ctx.strokeStyle = ray2Color;
    ctx.beginPath();
    ctx.moveTo(ox, objTopY);
    ctx.lineTo(w - 16, objTopY + slope2 * (w - 16 - ox));
    ctx.stroke();

    // Image arrow & virtual extensions
    if (Number.isFinite(opticsPhysics.v) && Math.abs(opticsPhysics.v) < 120) {
      const ix = cx + opticsPhysics.v * pxPerCm;
      const imgTopY = cy - opticsPhysics.hi * pxPerCm * 1.4;
      const isVirtual = opticsPhysics.v < 0;

      if (isVirtual) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.75)';
        ctx.beginPath();
        ctx.moveTo(cx, objTopY);
        ctx.lineTo(ix, imgTopY);
        ctx.stroke();
        ctx.restore();
      }

      ctx.strokeStyle = isVirtual ? '#38bdf8' : '#f43f5e';
      ctx.lineWidth = 3;
      if (isVirtual) ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ix, cy);
      ctx.lineTo(ix, imgTopY);
      ctx.stroke();
      ctx.setLineDash([]);

      const tipDir = imgTopY < cy ? -1 : 1;
      ctx.fillStyle = isVirtual ? '#38bdf8' : '#f43f5e';
      ctx.beginPath();
      ctx.moveTo(ix, imgTopY + tipDir * 8);
      ctx.lineTo(ix - 5, imgTopY - tipDir * 2);
      ctx.lineTo(ix + 5, imgTopY - tipDir * 2);
      ctx.closePath();
      ctx.fill();
      ctx.font = '600 11px JetBrains Mono, monospace';
      ctx.fillText(isVirtual ? 'Virtual Image' : 'Real Image', ix - 26, imgTopY + tipDir * 20);
    }
  }, [activeModule, activeBench, optics, opticsPhysics]);

  // Auto-Titrate interval
  useEffect(() => {
    if (!autoTitrate || activeModule !== 'labs' || activeBench !== 'titration') return;
    const id = window.setInterval(() => {
      setTitration((prev) => {
        if (prev.vbAddedMl >= 50) {
          setAutoTitrate(false);
          return prev;
        }
        return { ...prev, vbAddedMl: Math.min(50, +(prev.vbAddedMl + 0.35).toFixed(2)) };
      });
    }, 90);
    return () => window.clearInterval(id);
  }, [autoTitrate, activeModule, activeBench]);

  // Titration Flask + Live pH Curve Canvas
  useEffect(() => {
    if (activeModule !== 'labs' || activeBench !== 'titration') return;
    const canvas = titrationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 720;
    const h = canvas.clientHeight || 390;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#09101f';
    ctx.fillRect(0, 0, w, h);

    // Left: Burette + Erlenmeyer Flask apparatus
    const appCenterX = Math.min(145, w * 0.22);

    // Stand rod
    ctx.fillStyle = '#475569';
    ctx.fillRect(appCenterX - 58, 36, 5, h - 76);
    ctx.fillRect(appCenterX - 72, h - 42, 128, 7);

    // Burette cylinder
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(appCenterX - 11, 44, 22, 128);
    const burFillFrac = Math.max(0.08, 1 - titration.vbAddedMl / 50);
    const burFillH = 122 * burFillFrac;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.38)';
    ctx.fillRect(appCenterX - 9, 46 + (122 - burFillH), 18, burFillH);

    // Drop tip
    ctx.beginPath();
    ctx.moveTo(appCenterX - 3, 172);
    ctx.lineTo(appCenterX - 1, 192);
    ctx.lineTo(appCenterX + 1, 192);
    ctx.lineTo(appCenterX + 3, 172);
    ctx.stroke();

    if (autoTitrate) {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(appCenterX, 206, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Conical Flask
    const flaskBottomY = h - 48;
    const flaskNeckTop = 216;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(appCenterX - 16, flaskNeckTop);
    ctx.lineTo(appCenterX - 16, flaskNeckTop + 26);
    ctx.lineTo(appCenterX - 50, flaskBottomY - 6);
    ctx.quadraticCurveTo(appCenterX - 52, flaskBottomY, appCenterX - 42, flaskBottomY);
    ctx.lineTo(appCenterX + 42, flaskBottomY);
    ctx.quadraticCurveTo(appCenterX + 52, flaskBottomY, appCenterX + 50, flaskBottomY - 6);
    ctx.lineTo(appCenterX + 16, flaskNeckTop + 26);
    ctx.lineTo(appCenterX + 16, flaskNeckTop);
    ctx.closePath();
    ctx.clip();

    // Liquid inside flask (height reflects total volume)
    const volFrac = Math.min(0.84, 0.34 + (titration.vbAddedMl / 50) * 0.44);
    const liqTopY = flaskBottomY - (flaskBottomY - (flaskNeckTop + 22)) * volFrac;
    ctx.fillStyle = titrationReadout.ind.color;
    ctx.fillRect(appCenterX - 60, liqTopY, 120, flaskBottomY - liqTopY + 5);
    ctx.restore();

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(appCenterX - 16, flaskNeckTop);
    ctx.lineTo(appCenterX - 16, flaskNeckTop + 26);
    ctx.lineTo(appCenterX - 50, flaskBottomY - 6);
    ctx.quadraticCurveTo(appCenterX - 52, flaskBottomY, appCenterX - 42, flaskBottomY);
    ctx.lineTo(appCenterX + 42, flaskBottomY);
    ctx.quadraticCurveTo(appCenterX + 52, flaskBottomY, appCenterX + 50, flaskBottomY - 6);
    ctx.lineTo(appCenterX + 16, flaskNeckTop + 26);
    ctx.lineTo(appCenterX + 16, flaskNeckTop);
    ctx.stroke();

    // Right: Titration pH Curve
    const gx = Math.max(230, w * 0.4);
    const gy = 36;
    const gw = w - gx - 28;
    const gh = h - 84;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
    ctx.lineWidth = 1;
    for (let ph = 0; ph <= 14; ph += 2) {
      const py = gy + gh - (ph / 14) * gh;
      ctx.beginPath();
      ctx.moveTo(gx, py);
      ctx.lineTo(gx + gw, py);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.font = '500 10px JetBrains Mono, monospace';
      ctx.fillText(`${ph}`, gx - 20, py + 3);
    }
    for (let v = 0; v <= 50; v += 10) {
      const vx = gx + (v / 50) * gw;
      ctx.beginPath();
      ctx.moveTo(vx, gy);
      ctx.lineTo(vx, gy + gh);
      ctx.stroke();
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(`${v}mL`, vx - 12, gy + gh + 16);
    }

    // Axes
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx, gy + gh);
    ctx.lineTo(gx + gw, gy + gh);
    ctx.stroke();

    // Equivalence vertical dashed marker
    if (titrationReadout.eqMl <= 50) {
      const eqX = gx + (titrationReadout.eqMl / 50) * gw;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#a78bfa';
      ctx.beginPath();
      ctx.moveTo(eqX, gy);
      ctx.lineTo(eqX, gy + gh);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#c4b5fd';
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.fillText(`Eq=${titrationReadout.eqMl.toFixed(1)}mL`, Math.min(gx + gw - 74, eqX + 4), gy + 14);
    }

    // Plot curve from 0 to 50 mL
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const v = (i / 200) * 50;
      const ph = computeTitrationPh(titration, v);
      const px = gx + (v / 50) * gw;
      const py = gy + gh - (ph / 14) * gh;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Current operating point
    const curX = gx + (titration.vbAddedMl / 50) * gw;
    const curY = gy + gh - (titrationReadout.currentPh / 14) * gh;
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.arc(curX, curY, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }, [activeModule, activeBench, titration, titrationReadout, autoTitrate]);

  // RC Circuit Transient Simulation & Oscilloscope Loop
  useEffect(() => {
    if (activeModule !== 'labs' || activeBench !== 'rc-circuit') return;
    const canvas = rcCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tauSec = Math.max(0.01, (rc.resistanceOhm * rc.capacitanceUf) / 1_000_000);
    let rafId = 0;
    let lastTs = performance.now();
    let simT = 0;
    let phase = 0;
    let uiClock = 0;

    const draw = (now: number) => {
      const dt = Math.min(0.04, Math.max(0.001, (now - lastTs) / 1000));
      lastTs = now;

      if (rcRunning) {
        simT += dt;
        if (simT > tauSec * 5.2) {
          simT = 0;
        }
        phase = (phase + dt * 45) % 24;
      }

      const expTerm = Math.exp(-simT / tauSec);
      const vc = rc.mode === 'charge' ? rc.emf * (1 - expTerm) : rc.emf * expTerm;
      const currentA =
        rc.mode === 'charge'
          ? (rc.emf / rc.resistanceOhm) * expTerm
          : -(rc.emf / rc.resistanceOhm) * expTerm;
      const energyMj = 0.5 * (rc.capacitanceUf / 1_000_000) * vc * vc * 1000;

      uiClock += dt;
      if (uiClock >= 0.08) {
        uiClock = 0;
        setRcTelemetry({
          tMs: simT * 1000,
          vc,
          currentMa: currentA * 1000,
          tauMs: tauSec * 1000,
          energyMj,
        });
      }

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth || 720;
      const h = canvas.clientHeight || 390;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = '#09101f';
      ctx.fillRect(0, 0, w, h);

      // Left Schematic loop
      const sx = 38;
      const sy = 64;
      const sw = Math.min(210, w * 0.3);
      const sh = h - 130;

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(sx, sy, sw, sh);

      // Animated current dots proportional to |I|
      const speedNorm = Math.min(1, Math.abs(currentA) / Math.max(1e-6, rc.emf / rc.resistanceOhm));
      if (speedNorm > 0.03) {
        ctx.fillStyle = `rgba(34, 211, 238, ${0.35 + speedNorm * 0.65})`;
        for (let k = 0; k < 4; k++) {
          const tFrac = ((phase / 24 + k * 0.25) % 1);
          const xTop = sx + tFrac * sw;
          ctx.beginPath();
          ctx.arc(xTop, sy, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Battery badge on left branch
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(sx - 24, sy + sh / 2 - 22, 48, 44);
      ctx.strokeStyle = '#fbbf24';
      ctx.strokeRect(sx - 24, sy + sh / 2 - 22, 48, 44);
      ctx.fillStyle = '#fde68a';
      ctx.font = '700 11px JetBrains Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(rc.mode === 'charge' ? `${rc.emf}V` : '0V', sx, sy + sh / 2 + 4);

      // Resistor badge on top branch
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(sx + sw / 2 - 34, sy - 14, 68, 28);
      ctx.strokeStyle = '#34d399';
      ctx.strokeRect(sx + sw / 2 - 34, sy - 14, 68, 28);
      ctx.fillStyle = '#6ee7b7';
      ctx.fillText(`${rc.resistanceOhm}Ω`, sx + sw / 2, sy + 4);

      // Capacitor badge on right branch
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(sx + sw - 28, sy + sh / 2 - 24, 56, 48);
      ctx.strokeStyle = '#a78bfa';
      ctx.strokeRect(sx + sw - 28, sy + sh / 2 - 24, 56, 48);
      ctx.fillStyle = '#ddd6fe';
      ctx.fillText(`${rc.capacitanceUf}µF`, sx + sw, sy + sh / 2 + 4);
      ctx.textAlign = 'left';

      // Right Oscilloscope Trace (0 to 5 tau)
      const ox = sx + sw + 58;
      const oy = 42;
      const ow = w - ox - 28;
      const oh = h - 94;

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const px = ox + (i / 5) * ow;
        ctx.beginPath();
        ctx.moveTo(px, oy);
        ctx.lineTo(px, oy + oh);
        ctx.stroke();
        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 10px JetBrains Mono, monospace';
        ctx.fillText(`${i}τ`, px - 6, oy + oh + 16);
      }
      for (let j = 0; j <= 4; j++) {
        const py = oy + (j / 4) * oh;
        ctx.beginPath();
        ctx.moveTo(ox, py);
        ctx.lineTo(ox + ow, py);
        ctx.stroke();
      }

      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox, oy, ow, oh);

      // Plot Vc(t) curve in cyan & |I(t)| curve in amber
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const frac = i / 180;
        const t = frac * 5 * tauSec;
        const val = rc.mode === 'charge' ? 1 - Math.exp(-t / tauSec) : Math.exp(-t / tauSec);
        const px = ox + frac * ow;
        const py = oy + oh - val * oh;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      for (let i = 0; i <= 180; i++) {
        const frac = i / 180;
        const t = frac * 5 * tauSec;
        const val = Math.exp(-t / tauSec);
        const px = ox + frac * ow;
        const py = oy + oh - val * oh;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Current cursor line
      const cursorX = ox + Math.min(1, simT / (5 * tauSec)) * ow;
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cursorX, oy);
      ctx.lineTo(cursorX, oy + oh);
      ctx.stroke();

      ctx.fillStyle = '#22d3ee';
      ctx.font = '600 10px JetBrains Mono, monospace';
      ctx.fillText('Vc(t)', ox + 10, oy + 16);
      ctx.fillStyle = '#f59e0b';
      ctx.fillText('|I(t)|', ox + 52, oy + 16);

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [activeModule, activeBench, rc, rcRunning, rcResetTick]);

  return (
    <div className="space-y-5">
      {/* Header + Elite Switcher */}
      <div
        className={`rounded-xl border p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between bg-white dark:bg-slate-900 ${
          visualEffectsOn
            ? 'asan-elite-card border-blue-900/40 dark:border-cyan-400/50'
            : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="asan-elite-badge rounded px-1.5 py-0.5 text-[10px] font-bold">
              ELITE LABS
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-900 dark:text-cyan-300">
              <ShieldCheck className="h-3.5 w-3.5" />
              Exclusive to Elite Membership
            </span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            The Virtual Laboratories &amp; 3D Motion Visualizer
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Interactive physics, optics, chemistry titration, and RC circuit benches alongside a full WebGL 3D Motion Visualizer.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setActiveModule('labs')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeModule === 'labs'
                ? 'bg-blue-900 dark:bg-cyan-500 text-white dark:text-slate-950 shadow-xs'
                : 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            <FlaskConical className="h-4 w-4" />
            The Virtual Laboratories
          </button>
          <button
            type="button"
            onClick={() => setActiveModule('motion-3d')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeModule === 'motion-3d'
                ? 'bg-blue-900 dark:bg-cyan-500 text-white dark:text-slate-950 shadow-xs'
                : 'text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700'
            }`}
          >
            <Box className="h-4 w-4" />
            The 3D Motion Visualizer
          </button>
        </div>
      </div>

      {activeModule === 'motion-3d' ? (
        <MotionVisualizer3D />
      ) : (
        <div className="space-y-4">
          {/* Lab Bench Selector */}
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {(
              [
                {
                  id: 'mechanics',
                  title: 'Inclined Plane & Atwood Lab',
                  tag: 'Physics · Mechanics',
                  icon: Compass,
                },
                {
                  id: 'optics',
                  title: 'Thin Lens Ray-Optics Bench',
                  tag: 'Physics · Wave & Ray Optics',
                  icon: Atom,
                },
                {
                  id: 'titration',
                  title: 'Acid–Base Titration Burette',
                  tag: 'Chemistry · Volumetric Lab',
                  icon: Beaker,
                },
                {
                  id: 'rc-circuit',
                  title: 'DC & RC Oscilloscope Lab',
                  tag: 'Electromagnetism · Circuits',
                  icon: Zap,
                },
              ] as const
            ).map((bench) => {
              const Icon = bench.icon;
              const selected = activeBench === bench.id;
              return (
                <button
                  key={bench.id}
                  type="button"
                  onClick={() => setActiveBench(bench.id)}
                  className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                    selected
                      ? 'border-blue-900 dark:border-cyan-400 bg-blue-50/70 dark:bg-cyan-950/30 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      selected
                        ? 'bg-blue-900 dark:bg-cyan-500 text-white dark:text-slate-950'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                      {bench.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {bench.tag}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Bench Workspace */}
          {activeBench === 'mechanics' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-200">
                  <span className="font-mono font-semibold text-cyan-300">
                    LAB 01 · INCLINED PLANE &amp; ATWOOD DYNAMICS
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setMechRunning((r) => !r)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      {mechRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {mechRunning ? 'Pause' : 'Play'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMechResetTick((n) => n + 1)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </button>
                  </div>
                </div>
                <canvas ref={mechCanvasRef} className="w-full h-[380px] block" />
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-t border-slate-800 bg-slate-900/90 px-4 py-2.5 text-[11px] tabular-nums">
                  <div>
                    <div className="text-slate-400">Status</div>
                    <div className="font-semibold text-cyan-300 truncate">{mechTelemetry.regime}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Acceleration a</div>
                    <div className="font-mono font-bold text-white">{mechTelemetry.a.toFixed(2)} m/s²</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Velocity v</div>
                    <div className="font-mono font-bold text-emerald-300">{mechTelemetry.v.toFixed(2)} m/s</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Tension T</div>
                    <div className="font-mono font-bold text-amber-300">{mechPhysics.tension.toFixed(2)} N</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Normal N</div>
                    <div className="font-mono font-bold text-slate-200">{mechPhysics.normal.toFixed(2)} N</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Experimental Controls
                </h2>
                <div className="space-y-3 text-xs">
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Incline Angle θ</span>
                      <span className="font-mono font-semibold">{mech.thetaDeg}°</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={75}
                      step={1}
                      value={mech.thetaDeg}
                      onChange={(e) => setMech((p) => ({ ...p, thetaDeg: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Ramp Mass m₁</span>
                      <span className="font-mono font-semibold">{mech.m1.toFixed(1)} kg</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={15}
                      step={0.1}
                      value={mech.m1}
                      onChange={(e) => setMech((p) => ({ ...p, m1: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Hanging Mass m₂</span>
                      <span className="font-mono font-semibold">{mech.m2.toFixed(1)} kg</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={15}
                      step={0.1}
                      value={mech.m2}
                      onChange={(e) => setMech((p) => ({ ...p, m2: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Static Friction μₛ</span>
                      <span className="font-mono font-semibold">{mech.muS.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={0.8}
                      step={0.01}
                      value={mech.muS}
                      onChange={(e) =>
                        setMech((p) => ({
                          ...p,
                          muS: Number(e.target.value),
                          muK: Math.min(p.muK, Number(e.target.value)),
                        }))
                      }
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Kinetic Friction μₖ</span>
                      <span className="font-mono font-semibold">{mech.muK.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={mech.muS}
                      step={0.01}
                      value={mech.muK}
                      onChange={(e) => setMech((p) => ({ ...p, muK: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Gravity g</span>
                      <span className="font-mono font-semibold">{mech.g.toFixed(2)} m/s²</span>
                    </div>
                    <input
                      type="range"
                      min={1.62}
                      max={20}
                      step={0.05}
                      value={mech.g}
                      onChange={(e) => setMech((p) => ({ ...p, g: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 space-y-1">
                  <div>a = (m₂g − m₁g sinθ ± μₖN) / (m₁ + m₂)</div>
                  <div>|m₂g − m₁g sinθ| = {Math.abs(mechPhysics.w2 - mechPhysics.w1Par).toFixed(2)} N</div>
                  <div>f_s(max) = μₛN = {mechPhysics.maxStatic.toFixed(2)} N</div>
                </div>
              </div>
            </div>
          )}

          {activeBench === 'optics' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-200">
                  <span className="font-mono font-semibold text-cyan-300">
                    LAB 02 · THIN LENS PRINCIPAL RAY TRACING BENCH
                  </span>
                  <span className="font-mono text-[11px] text-amber-300">{opticsPhysics.nature}</span>
                </div>
                <canvas ref={opticsCanvasRef} className="w-full h-[380px] block" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-slate-800 bg-slate-900/90 px-4 py-2.5 text-[11px] tabular-nums">
                  <div>
                    <div className="text-slate-400">Focal Length f</div>
                    <div className="font-mono font-bold text-amber-300">{opticsPhysics.f.toFixed(1)} cm</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Object Distance u</div>
                    <div className="font-mono font-bold text-emerald-300">{opticsPhysics.u.toFixed(1)} cm</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Image Distance v</div>
                    <div className="font-mono font-bold text-cyan-300">
                      {Number.isFinite(opticsPhysics.v) ? `${opticsPhysics.v.toFixed(2)} cm` : '∞'}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Magnification m</div>
                    <div className="font-mono font-bold text-white">
                      {Number.isFinite(opticsPhysics.m) ? `${opticsPhysics.m.toFixed(2)}×` : '∞'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Optical Bench Parameters
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {(['convex', 'concave'] as const).map((lt) => (
                    <button
                      key={lt}
                      type="button"
                      onClick={() => setOptics((p) => ({ ...p, lensType: lt }))}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${
                        optics.lensType === lt
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {lt} Lens
                    </button>
                  ))}
                </div>
                <div className="space-y-3 text-xs">
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Focal Magnitude |f|</span>
                      <span className="font-mono font-semibold">{optics.focalCm} cm</span>
                    </div>
                    <input
                      type="range"
                      min={6}
                      max={25}
                      step={0.5}
                      value={optics.focalCm}
                      onChange={(e) => setOptics((p) => ({ ...p, focalCm: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Object Distance |u|</span>
                      <span className="font-mono font-semibold">{optics.objectDistCm} cm</span>
                    </div>
                    <input
                      type="range"
                      min={4}
                      max={42}
                      step={0.5}
                      value={optics.objectDistCm}
                      onChange={(e) =>
                        setOptics((p) => ({ ...p, objectDistCm: Number(e.target.value) }))
                      }
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Object Height h₀</span>
                      <span className="font-mono font-semibold">{optics.objectHeightCm.toFixed(1)} cm</span>
                    </div>
                    <input
                      type="range"
                      min={1.5}
                      max={7}
                      step={0.2}
                      value={optics.objectHeightCm}
                      onChange={(e) =>
                        setOptics((p) => ({ ...p, objectHeightCm: Number(e.target.value) }))
                      }
                      className="w-full accent-blue-600"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 space-y-1">
                  <div>1/f = 1/v − 1/u</div>
                  <div>P = 100 / f = {(100 / opticsPhysics.f).toFixed(2)} D</div>
                  <div>
                    hᵢ ={' '}
                    {Number.isFinite(opticsPhysics.hi) ? `${opticsPhysics.hi.toFixed(2)} cm` : '∞'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeBench === 'titration' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-200">
                  <span className="font-mono font-semibold text-cyan-300">
                    LAB 03 · VOLUMETRIC ACID–BASE TITRATION BENCH
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setTitration((p) => ({
                          ...p,
                          vbAddedMl: Math.min(50, +(p.vbAddedMl + 0.25).toFixed(2)),
                        }))
                      }
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      <Droplets className="h-3.5 w-3.5" />
                      +0.25 mL Drop
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoTitrate((v) => !v)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      {autoTitrate ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {autoTitrate ? 'Stop Tap' : 'Open Tap'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAutoTitrate(false);
                        setTitration((p) => ({ ...p, vbAddedMl: 0 }));
                      }}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset Flask
                    </button>
                  </div>
                </div>
                <canvas ref={titrationCanvasRef} className="w-full h-[380px] block" />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-slate-800 bg-slate-900/90 px-4 py-2.5 text-[11px] tabular-nums">
                  <div>
                    <div className="text-slate-400">Live pH</div>
                    <div className="font-mono font-bold text-cyan-300">
                      {titrationReadout.currentPh.toFixed(2)} pH
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">NaOH Added Vb</div>
                    <div className="font-mono font-bold text-white">
                      {titration.vbAddedMl.toFixed(2)} mL
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Equivalence Vol</div>
                    <div className="font-mono font-bold text-violet-300">
                      {titrationReadout.eqMl.toFixed(2)} mL
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-400">Indicator Visual</div>
                    <div className="font-semibold text-emerald-300 truncate">
                      {titrationReadout.ind.label}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Reagent &amp; Burette Controls
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: 'strong', label: 'HCl (Strong)' },
                      { id: 'weak', label: 'CH₃COOH (Weak)' },
                    ] as const
                  ).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setTitration((p) => ({ ...p, acidType: a.id }))}
                      className={`rounded-lg border px-2.5 py-2 text-xs font-semibold ${
                        titration.acidType === a.id
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Indicator
                  </label>
                  <select
                    value={titration.indicator}
                    onChange={(e) =>
                      setTitration((p) => ({
                        ...p,
                        indicator: e.target.value as TitrationState['indicator'],
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs"
                  >
                    <option value="phenolphthalein">Phenolphthalein (pH 8.2–9.8)</option>
                    <option value="bromothymol">Bromothymol Blue (pH 6.0–7.6)</option>
                    <option value="methyl_orange">Methyl Orange (pH 3.1–4.4)</option>
                  </select>
                </div>
                <div className="space-y-3 text-xs">
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">NaOH Added Vb</span>
                      <span className="font-mono font-semibold">{titration.vbAddedMl.toFixed(2)} mL</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={0.25}
                      value={titration.vbAddedMl}
                      onChange={(e) => {
                        setAutoTitrate(false);
                        setTitration((p) => ({ ...p, vbAddedMl: Number(e.target.value) }));
                      }}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Acid Molarity Cₐ</span>
                      <span className="font-mono font-semibold">{titration.ca.toFixed(2)} M</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={0.25}
                      step={0.01}
                      value={titration.ca}
                      onChange={(e) => setTitration((p) => ({ ...p, ca: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">NaOH Molarity C_b</span>
                      <span className="font-mono font-semibold">{titration.cb.toFixed(2)} M</span>
                    </div>
                    <input
                      type="range"
                      min={0.05}
                      max={0.25}
                      step={0.01}
                      value={titration.cb}
                      onChange={(e) => setTitration((p) => ({ ...p, cb: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Flask Acid Vol Vₐ</span>
                      <span className="font-mono font-semibold">{titration.vaMl} mL</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={40}
                      step={5}
                      value={titration.vaMl}
                      onChange={(e) => setTitration((p) => ({ ...p, vaMl: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 space-y-1">
                  <div>CₐVₐ = C_bV_eq ⇒ V_eq = {titrationReadout.eqMl.toFixed(2)} mL</div>
                  <div>{titration.acidType === 'weak' ? 'Buffer: pH = pKₐ + log([A⁻]/[HA])' : 'Strong: pH = −log₁₀([H⁺])'}</div>
                </div>
              </div>
            </div>
          )}

          {activeBench === 'rc-circuit' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-950 overflow-hidden flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-4 py-2.5 text-xs text-slate-200">
                  <span className="font-mono font-semibold text-cyan-300">
                    LAB 04 · RC TRANSIENT OSCILLOSCOPE LAB
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setRcRunning((r) => !r)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      {rcRunning ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {rcRunning ? 'Freeze Trace' : 'Run Sweep'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRcResetTick((n) => n + 1)}
                      className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-700 whitespace-nowrap shrink-0"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Re-Trigger
                    </button>
                  </div>
                </div>
                <canvas ref={rcCanvasRef} className="w-full h-[380px] block" />
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 border-t border-slate-800 bg-slate-900/90 px-4 py-2.5 text-[11px] tabular-nums">
                  <div>
                    <div className="text-slate-400">Time t</div>
                    <div className="font-mono font-bold text-white">{rcTelemetry.tMs.toFixed(0)} ms</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Capacitor Vc</div>
                    <div className="font-mono font-bold text-cyan-300">{rcTelemetry.vc.toFixed(2)} V</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Current I(t)</div>
                    <div className="font-mono font-bold text-amber-300">{rcTelemetry.currentMa.toFixed(2)} mA</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Time Const τ</div>
                    <div className="font-mono font-bold text-emerald-300">{rcTelemetry.tauMs.toFixed(0)} ms</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Stored Energy</div>
                    <div className="font-mono font-bold text-violet-300">{rcTelemetry.energyMj.toFixed(2)} mJ</div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
                <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Circuit Component Values
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {(['charge', 'discharge'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => {
                        setRc((p) => ({ ...p, mode: m }));
                        setRcResetTick((n) => n + 1);
                      }}
                      className={`rounded-lg border px-3 py-2 text-xs font-semibold capitalize ${
                        rc.mode === m
                          ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {m} Capacitor
                    </button>
                  ))}
                </div>
                <div className="space-y-3 text-xs">
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Source EMF V₀</span>
                      <span className="font-mono font-semibold">{rc.emf} V</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={24}
                      step={1}
                      value={rc.emf}
                      onChange={(e) => setRc((p) => ({ ...p, emf: Number(e.target.value) }))}
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Resistance R</span>
                      <span className="font-mono font-semibold">{rc.resistanceOhm} Ω</span>
                    </div>
                    <input
                      type="range"
                      min={200}
                      max={5000}
                      step={100}
                      value={rc.resistanceOhm}
                      onChange={(e) =>
                        setRc((p) => ({ ...p, resistanceOhm: Number(e.target.value) }))
                      }
                      className="w-full accent-blue-600"
                    />
                  </label>
                  <label className="block space-y-1">
                    <div className="flex justify-between tabular-nums">
                      <span className="text-slate-600 dark:text-slate-300">Capacitance C</span>
                      <span className="font-mono font-semibold">{rc.capacitanceUf} µF</span>
                    </div>
                    <input
                      type="range"
                      min={100}
                      max={2200}
                      step={50}
                      value={rc.capacitanceUf}
                      onChange={(e) =>
                        setRc((p) => ({ ...p, capacitanceUf: Number(e.target.value) }))
                      }
                      className="w-full accent-blue-600"
                    />
                  </label>
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60 p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 space-y-1">
                  <div>τ = RC = {rcTelemetry.tauMs.toFixed(1)} ms</div>
                  <div>{rc.mode === 'charge' ? 'Vc(t) = V₀(1 − e^(−t/τ))' : 'Vc(t) = V₀e^(−t/τ)'}</div>
                  <div>E_max = ½CV₀² = {(0.5 * (rc.capacitanceUf / 1000) * rc.emf * rc.emf).toFixed(2)} mJ</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
