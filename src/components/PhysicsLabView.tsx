import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Award,
  CheckCircle2,
  Code,
  Compass,
  Copy,
  Cpu,
  Droplets,
  Eye,
  Gauge,
  Layers,
  Pause,
  Play,
  RefreshCcw,
  Sliders,
  Sparkles,
  Target,
  Volume2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type PhysicsExpId =
  | 'pendulum'
  | 'vernier'
  | 'screw_gauge'
  | 'spherometer'
  | 'hookes_law'
  | 'stokes_law'
  | 'resonance_tube';

export const PhysicsLabView: React.FC = () => {
  const { dbUser } = useAuth();
  const visualEffectsOn = dbUser?.eliteVisualEffects !== false;

  const [activeExp, setActiveExp] = useState<PhysicsExpId>('pendulum');
  const [viewMode, setViewMode] = useState<'apparatus' | 'codeblocks'>('apparatus');

  // Animation clocks
  const [animTime, setAnimTime] = useState<number>(0);
  const [isSimRunning, setIsSimRunning] = useState<boolean>(true);

  // Code Block Script State
  const [codeScript, setCodeScript] = useState<string>(() =>
    JSON.stringify(
      {
        experiment: 'pendulum',
        parameters: {
          pendulumLength: 1.2,
          pendulumGravity: 9.81,
          pendulumAmplitudeDeg: 18,
        },
      },
      null,
      2
    )
  );
  const [codeStatus, setCodeStatus] = useState<string | null>(null);

  // 1. Simple Pendulum State
  const [pendulumLength, setPendulumLength] = useState<number>(1.2); // meters
  const [pendulumGravity, setPendulumGravity] = useState<number>(9.81);
  const [pendulumAmplitudeDeg, setPendulumAmplitudeDeg] = useState<number>(18);
  const timePeriod = 2 * Math.PI * Math.sqrt(pendulumLength / Math.max(0.1, pendulumGravity));

  // 2. Vernier Callipers State (Wire radius)
  const [mainScaleMm, setMainScaleMm] = useState<number>(3.0); // 3 mm = 0.3 cm
  const [vernierCoincide, setVernierCoincide] = useState<number>(7);
  const vernierReadingMm = mainScaleMm + vernierCoincide * 0.1; // mm
  const wireRadiusMm = vernierReadingMm / 2;

  // 3. Screw Gauge State (Metallic Bob diameter)
  const [pitchScaleMm, setPitchScaleMm] = useState<number>(6.0);
  const [circularDiv, setCircularDiv] = useState<number>(45);
  const screwReadingMm = pitchScaleMm + circularDiv * 0.01; // mm

  // 4. Spherometer State (Curvature & focal length)
  const [spherometerLegDist, setSpherometerLegDist] = useState<number>(5.0); // cm
  const [spherometerShedHeight, setSpherometerShedHeight] = useState<number>(0.25); // cm
  const radiusOfCurvature = (spherometerLegDist * spherometerLegDist) / (6 * spherometerShedHeight) + spherometerShedHeight / 2;
  const estimatedFocalLength = radiusOfCurvature / 2;

  // 5. Hooke's Law State
  const [springConstant, setSpringConstant] = useState<number>(30); // N/m
  const [appliedLoadKg, setAppliedLoadKg] = useState<number>(0.6); // kg
  const loadForce = appliedLoadKg * 9.81;
  const springExtensionCm = (loadForce / springConstant) * 100;

  // 6. Stokes' Law State (Viscosity of Glycerine)
  const [ballRadiusMm, setBallRadiusMm] = useState<number>(2.5); // mm
  const [ballDropProgress, setBallDropProgress] = useState<number>(0); // 0 to 1
  const [ballDropActive, setBallDropActive] = useState<boolean>(true);
  const ballRadiusM = ballRadiusMm / 1000;
  const densityBall = 7800; // steel
  const densityGlycerine = 1260;
  const viscosityGlycerine = 1.41;
  const terminalVelocity = (2 * ballRadiusM * ballRadiusM * (densityBall - densityGlycerine) * 9.81) / (9 * viscosityGlycerine);

  // 7. Resonance Tube State
  const [tuningFrequencyHz, setTuningFrequencyHz] = useState<number>(512); // Hz
  const speedOfSound = 343; // m/s
  const expectedWaveLength = speedOfSound / tuningFrequencyHz; // meters
  const firstResonanceLengthCm = (expectedWaveLength / 4) * 100;
  const [waterLevelCm, setWaterLevelCm] = useState<number>(16.8);
  const isResonating = Math.abs(waterLevelCm - firstResonanceLengthCm) < 1.5;

  // Continuous animation loop for oscillating instruments
  useEffect(() => {
    let frameId = 0;
    let lastTs = performance.now();
    const loop = (now: number) => {
      const dt = (now - lastTs) / 1000;
      lastTs = now;
      if (isSimRunning) {
        setAnimTime((t) => t + dt);
      }
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [isSimRunning]);

  // Stokes law ball fall animation
  useEffect(() => {
    if (!ballDropActive || !isSimRunning) return;
    const interval = setInterval(() => {
      setBallDropProgress((p) => {
        if (p >= 1) return 0; // loop
        return p + 0.015;
      });
    }, 40);
    return () => clearInterval(interval);
  }, [ballDropActive, isSimRunning]);

  // Pendulum oscillation angle calculation
  const currentPendulumAngleRad =
    ((pendulumAmplitudeDeg * Math.PI) / 180) *
    Math.cos((2 * Math.PI * animTime) / timePeriod);

  const PHYSICS_APPARATUS_PRESETS = [
    {
      id: 'pendulum' as PhysicsExpId,
      name: 'Simple Pendulum Oscillations',
      signature: 'apparatus.pendulum.run({ pendulumLength, pendulumGravity, pendulumAmplitudeDeg })',
      desc: 'Controls string suspension length, local gravitational field g, and initial angular displacement.',
      formula: 'T = 2π√(L/g)',
      payload: {
        apparatus: 'apparatus.pendulum',
        experiment: 'pendulum',
        parameters: {
          pendulumLength: 1.25,
          pendulumGravity: 9.81,
          pendulumAmplitudeDeg: 15,
        },
        readout: 'Period T (seconds), Oscillation frequency f (Hz)',
      },
    },
    {
      id: 'vernier' as PhysicsExpId,
      name: 'Vernier Callipers Thin Wire Radius',
      signature: 'apparatus.vernier.measureWire({ mainScaleMm, vernierCoincide })',
      desc: 'Sets main scale reading (MSR) and coincident vernier division with 0.1 mm precision loupe.',
      formula: 'Total = MSR + (VSR × 0.1 mm); Radius = Total / 2',
      payload: {
        apparatus: 'apparatus.vernier',
        experiment: 'vernier',
        parameters: {
          mainScaleMm: 3.0,
          vernierCoincide: 8,
        },
        readout: 'Wire Diameter (mm), Radius (mm), Cross Section Area (mm²)',
      },
    },
    {
      id: 'screw_gauge' as PhysicsExpId,
      name: 'Screw Gauge Micrometer Bob Diameter',
      signature: 'apparatus.screwGauge.measureBob({ pitchScaleMm, circularDiv })',
      desc: 'Sets linear sleeve pitch division and circular thimble head division with 0.01 mm least count.',
      formula: 'Total = PSR + (HSR × 0.01 mm); Volume = 4/3 π r³',
      payload: {
        apparatus: 'apparatus.screwGauge',
        experiment: 'screw_gauge',
        parameters: {
          pitchScaleMm: 6.0,
          circularDiv: 45,
        },
        readout: 'Metallic Bob Diameter (mm), Spherical Volume (mm³)',
      },
    },
    {
      id: 'spherometer' as PhysicsExpId,
      name: 'Spherometer Lens Curvature & Focal Length',
      signature: 'apparatus.spherometer.computeCurvature({ spherometerLegDist, spherometerShedHeight })',
      desc: 'Measures outer leg equilateral distance (l) and central screw sagitta height (h) over curved lens.',
      formula: 'R = (l² / 6h) + (h / 2); f = R / 2',
      payload: {
        apparatus: 'apparatus.spherometer',
        experiment: 'spherometer',
        parameters: {
          spherometerLegDist: 5.0,
          spherometerShedHeight: 0.28,
        },
        readout: 'Radius of Curvature R (cm), Estimated Focal Length f (cm)',
      },
    },
    {
      id: 'hookes_law' as PhysicsExpId,
      name: 'Hooke’s Law Helical Spring Elasticity',
      signature: 'apparatus.hookesLaw.applyLoad({ springConstant, appliedLoadKg })',
      desc: 'Applies slotted brass weights onto helical spring suspended from rigid retort stand.',
      formula: 'F = mg; Δx = F / k; Strain Energy U = ½ k Δx²',
      payload: {
        apparatus: 'apparatus.hookesLaw',
        experiment: 'hookes_law',
        parameters: {
          springConstant: 35,
          appliedLoadKg: 0.75,
        },
        readout: 'Applied Gravitational Force (N), Spring Extension Δx (cm)',
      },
    },
    {
      id: 'stokes_law' as PhysicsExpId,
      name: 'Stokes’ Law Viscosity of Glycerine',
      signature: 'apparatus.stokesLaw.dropBall({ ballRadiusMm })',
      desc: 'Drops smooth steel ball of given radius into tall glass cylinder filled with pure viscous glycerine.',
      formula: 'v_terminal = 2 r² (ρ - σ) g / (9 η)',
      payload: {
        apparatus: 'apparatus.stokesLaw',
        experiment: 'stokes_law',
        parameters: {
          ballRadiusMm: 3.0,
        },
        readout: 'Terminal Velocity v_t (m/s), Viscous Drag Force F_v (N)',
      },
    },
    {
      id: 'resonance_tube' as PhysicsExpId,
      name: 'Resonance Tube Acoustic Standing Waves',
      signature: 'apparatus.resonanceTube.tuneAcoustics({ tuningFrequencyHz, waterLevelCm })',
      desc: 'Sets tuning fork frequency and adjusts reservoir water level to achieve quarter-wave acoustic resonance.',
      formula: 'λ = v / f; First Resonance L₁ = λ / 4',
      payload: {
        apparatus: 'apparatus.resonanceTube',
        experiment: 'resonance_tube',
        parameters: {
          tuningFrequencyHz: 512,
          waterLevelCm: 16.8,
        },
        readout: 'Resonance Detection Flag, Standing Wavelength λ (cm)',
      },
    },
  ];

  const handleRunPhysicsCode = () => {
    try {
      const parsed = JSON.parse(codeScript);
      const targetExp =
        parsed.experiment ||
        (parsed.apparatus ? parsed.apparatus.replace('apparatus.', '') : null);

      if (
        targetExp &&
        ['pendulum', 'vernier', 'screw_gauge', 'spherometer', 'hookes_law', 'stokes_law', 'resonance_tube'].includes(
          targetExp
        )
      ) {
        setActiveExp(targetExp as PhysicsExpId);
      }
      if (parsed.parameters) {
        if (parsed.parameters.pendulumLength !== undefined) setPendulumLength(Number(parsed.parameters.pendulumLength));
        if (parsed.parameters.pendulumGravity !== undefined) setPendulumGravity(Number(parsed.parameters.pendulumGravity));
        if (parsed.parameters.pendulumAmplitudeDeg !== undefined) setPendulumAmplitudeDeg(Number(parsed.parameters.pendulumAmplitudeDeg));
        if (parsed.parameters.mainScaleMm !== undefined) setMainScaleMm(Number(parsed.parameters.mainScaleMm));
        if (parsed.parameters.vernierCoincide !== undefined) setVernierCoincide(Number(parsed.parameters.vernierCoincide));
        if (parsed.parameters.pitchScaleMm !== undefined) setPitchScaleMm(Number(parsed.parameters.pitchScaleMm));
        if (parsed.parameters.circularDiv !== undefined) setCircularDiv(Number(parsed.parameters.circularDiv));
        if (parsed.parameters.spherometerLegDist !== undefined) setSpherometerLegDist(Number(parsed.parameters.spherometerLegDist));
        if (parsed.parameters.spherometerShedHeight !== undefined) setSpherometerShedHeight(Number(parsed.parameters.spherometerShedHeight));
        if (parsed.parameters.springConstant !== undefined) setSpringConstant(Number(parsed.parameters.springConstant));
        if (parsed.parameters.appliedLoadKg !== undefined) setAppliedLoadKg(Number(parsed.parameters.appliedLoadKg));
        if (parsed.parameters.ballRadiusMm !== undefined) setBallRadiusMm(Number(parsed.parameters.ballRadiusMm));
        if (parsed.parameters.tuningFrequencyHz !== undefined) setTuningFrequencyHz(Number(parsed.parameters.tuningFrequencyHz));
        if (parsed.parameters.waterLevelCm !== undefined) setWaterLevelCm(Number(parsed.parameters.waterLevelCm));
      }
      setCodeStatus('Apparatus Function executed successfully! Visual instrument synchronized.');
      setTimeout(() => setCodeStatus(null), 4000);
    } catch (err) {
      setCodeStatus(`Syntax Error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className={`rounded-2xl border p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between bg-white dark:bg-slate-900 ${
          visualEffectsOn ? 'asan-elite-card border-blue-600 dark:border-cyan-400' : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="asan-elite-badge rounded px-2 py-0.5 text-[10px] font-bold">PHYSICS LABORATORY</span>
            <span className="text-xs text-blue-700 dark:text-cyan-400 font-semibold">Visual Apparatus Bench &amp; Measurement Suite</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Virtual Physics Lab &amp; Visual Instruments
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            High-fidelity visual renderings of real laboratory instruments: Simple Pendulum, Vernier Callipers with coincidence loupe, Screw Gauge micrometer, Spherometer, Hooke&apos;s Law spring stand, Stokes&apos; Law glycerine cylinder, and acoustic Resonance Tube.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Mode Switcher */}
          <div className="flex rounded-xl border border-slate-200 dark:border-slate-800 p-1 bg-slate-50 dark:bg-slate-950 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('apparatus')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                viewMode === 'apparatus' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              🔬 Visual Bench
            </button>
            <button
              type="button"
              onClick={() => setViewMode('codeblocks')}
              className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
                viewMode === 'codeblocks' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              &lt;/&gt; Apparatus Code Blocks
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsSimRunning(!isSimRunning)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 shrink-0"
          >
            {isSimRunning ? <Pause className="h-4 w-4 text-amber-500" /> : <Play className="h-4 w-4 text-emerald-500" />}
            {isSimRunning ? 'Pause Dynamics' : 'Resume'}
          </button>
        </div>
      </div>

      {viewMode === 'codeblocks' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Apparatus Functions Directory */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Apparatus Functions Catalog
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-cyan-300 font-semibold">
                7 Callable APIs
              </span>
            </div>

            <div className="space-y-2.5 max-h-[700px] overflow-y-auto pr-1">
              {PHYSICS_APPARATUS_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2 shadow-xs hover:border-blue-500/50 transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {preset.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCodeScript(JSON.stringify(preset.payload, null, 2));
                        setActiveExp(preset.id);
                        setCodeStatus(`Loaded "${preset.name}" into editor.`);
                        setTimeout(() => setCodeStatus(null), 2500);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900 text-blue-700 dark:text-cyan-300 text-[10px] font-bold shrink-0 border border-blue-200 dark:border-blue-800 cursor-pointer"
                    >
                      Load Preset
                    </button>
                  </div>
                  <div className="rounded-lg bg-slate-950 px-2.5 py-1.5 font-mono text-[11px] text-cyan-400 break-all select-all">
                    {preset.signature}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    {preset.desc}
                  </p>
                  <div className="flex items-center justify-between text-[10px] font-mono pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="text-slate-500">Formula:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{preset.formula}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Code Block Editor & Live Apparatus Telemetry */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-cyan-400">
                    <Code className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 dark:text-slate-100">
                      Physics Apparatus Code Block
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Declarative parameters script to drive physical lab apparatus and compute exact measurements.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(codeScript);
                      setCodeStatus('Apparatus script copied to clipboard!');
                      setTimeout(() => setCodeStatus(null), 2500);
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const def = PHYSICS_APPARATUS_PRESETS[0];
                      setCodeScript(JSON.stringify(def.payload, null, 2));
                      setActiveExp('pendulum');
                    }}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <RefreshCcw className="h-3.5 w-3.5" />
                    Reset
                  </button>
                </div>
              </div>

              {codeStatus && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <span>{codeStatus}</span>
                </div>
              )}

              {/* Code Editor */}
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs shadow-inner">
                <textarea
                  value={codeScript}
                  onChange={(e) => setCodeScript(e.target.value)}
                  rows={14}
                  className="w-full bg-transparent text-cyan-300 outline-none resize-none font-mono text-xs leading-relaxed"
                  spellCheck={false}
                />
              </div>

              <div className="flex flex-wrap gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleRunPhysicsCode}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white py-2.5 px-4 font-bold text-xs shadow-md transition-colors cursor-pointer"
                >
                  <Play className="h-3.5 w-3.5" />
                  ▶ Execute Physics Apparatus Code
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('apparatus')}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 py-2.5 px-4 font-semibold text-xs transition-colors cursor-pointer"
                >
                  <Eye className="h-3.5 w-3.5 text-blue-600 dark:text-cyan-400" />
                  Open in Visual Bench
                </button>
              </div>
            </div>

            {/* Live Apparatus Telemetry & Real-Time Readout */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 shadow-xs">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <Gauge className="h-4 w-4 text-emerald-500" />
                Live Apparatus Telemetry: {activeExp.toUpperCase()}
              </h4>

              {activeExp === 'pendulum' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Period (T)</div>
                    <div className="font-mono font-bold text-blue-600 dark:text-cyan-400 text-sm mt-0.5">{timePeriod.toFixed(3)} s</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Frequency (f)</div>
                    <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">{(1 / timePeriod).toFixed(3)} Hz</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Length (L)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{pendulumLength.toFixed(2)} m</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Gravity (g)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{pendulumGravity.toFixed(2)} m/s²</div>
                  </div>
                </div>
              )}

              {activeExp === 'vernier' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Wire Diameter</div>
                    <div className="font-mono font-bold text-blue-600 dark:text-cyan-400 text-sm mt-0.5">{vernierReadingMm.toFixed(2)} mm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Wire Radius</div>
                    <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">{wireRadiusMm.toFixed(2)} mm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">MSR Reading</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{mainScaleMm.toFixed(1)} mm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Coincidence Div</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">#{vernierCoincide}</div>
                  </div>
                </div>
              )}

              {activeExp === 'screw_gauge' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Bob Diameter</div>
                    <div className="font-mono font-bold text-blue-600 dark:text-cyan-400 text-sm mt-0.5">{screwReadingMm.toFixed(2)} mm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Bob Radius</div>
                    <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">{(screwReadingMm / 2).toFixed(2)} mm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Pitch Scale (PSR)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{pitchScaleMm.toFixed(1)} mm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Circular Div (HSR)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">#{circularDiv}</div>
                  </div>
                </div>
              )}

              {activeExp === 'spherometer' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Radius of Curvature</div>
                    <div className="font-mono font-bold text-blue-600 dark:text-cyan-400 text-sm mt-0.5">{radiusOfCurvature.toFixed(2)} cm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Focal Length (f)</div>
                    <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">{estimatedFocalLength.toFixed(2)} cm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Leg Distance (l)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{spherometerLegDist.toFixed(1)} cm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Sagitta Height (h)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{spherometerShedHeight.toFixed(2)} cm</div>
                  </div>
                </div>
              )}

              {activeExp === 'hookes_law' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Applied Force</div>
                    <div className="font-mono font-bold text-blue-600 dark:text-cyan-400 text-sm mt-0.5">{loadForce.toFixed(2)} N</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Spring Extension</div>
                    <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">{springExtensionCm.toFixed(1)} cm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Spring Constant (k)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{springConstant} N/m</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Applied Mass (m)</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{appliedLoadKg.toFixed(2)} kg</div>
                  </div>
                </div>
              )}

              {activeExp === 'stokes_law' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Terminal Velocity</div>
                    <div className="font-mono font-bold text-blue-600 dark:text-cyan-400 text-sm mt-0.5">{terminalVelocity.toFixed(3)} m/s</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Ball Radius</div>
                    <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">{ballRadiusMm.toFixed(1)} mm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Glycerine Viscosity</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{viscosityGlycerine} Pa·s</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Steel Density</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{densityBall} kg/m³</div>
                  </div>
                </div>
              )}

              {activeExp === 'resonance_tube' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Tuning Fork</div>
                    <div className="font-mono font-bold text-blue-600 dark:text-cyan-400 text-sm mt-0.5">{tuningFrequencyHz} Hz</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Resonant Length L₁</div>
                    <div className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm mt-0.5">{firstResonanceLengthCm.toFixed(1)} cm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Water Level</div>
                    <div className="font-mono font-bold text-slate-800 dark:text-slate-200 text-sm mt-0.5">{waterLevelCm.toFixed(1)} cm</div>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                    <div className="text-[10px] text-slate-500">Acoustic Status</div>
                    <div className={`font-mono font-bold text-sm mt-0.5 ${isResonating ? 'text-amber-500 animate-pulse' : 'text-slate-500'}`}>
                      {isResonating ? 'RESONATING ⚡' : 'Damped'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {viewMode === 'apparatus' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Navigation: Experiment Selector */}
        <div className="lg:col-span-4 space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 px-1 mb-2">
            Select Physical Apparatus
          </div>
          {(
            [
              { id: 'pendulum', title: 'Simple Pendulum', desc: 'Oscillating bob & gravity verification', icon: Compass },
              { id: 'vernier', title: 'Vernier Callipers', desc: 'Jaws & coincidence loupe for thin wire', icon: Sliders },
              { id: 'screw_gauge', title: 'Screw Gauge (Micrometer)', desc: 'Thimble pitch & spherical bob diameter', icon: Gauge },
              { id: 'spherometer', title: 'Spherometer', desc: 'Curvature disc & lens focal length', icon: Target },
              { id: 'hookes_law', title: 'Hooke’s Law Apparatus', desc: 'Retort stand, coil spring & weights', icon: Activity },
              { id: 'stokes_law', title: 'Stokes’ Law & Viscosity', desc: 'Glass cylinder, glycerine & falling ball', icon: Layers },
              { id: 'resonance_tube', title: 'Acoustic Resonance Tube', desc: 'Water reservoir, tuning fork & wave node', icon: Cpu },
            ] as const
          ).map((exp) => {
            const Icon = exp.icon;
            const isSelected = activeExp === exp.id;
            return (
              <button
                key={exp.id}
                type="button"
                onClick={() => setActiveExp(exp.id)}
                className={`w-full flex items-start gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-950 dark:text-cyan-200 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                }`}
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                    isSelected ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold">{exp.title}</div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{exp.desc}</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Right Workspace: Visual Instrument Stage & Controls */}
        <div className="lg:col-span-8 space-y-4">
          {/* 1. SIMPLE PENDULUM VISUAL */}
          {activeExp === 'pendulum' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Simple Pendulum Visual Apparatus
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Oscillation period T = 2π√(L/g). Observe harmonic motion in real-time.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold px-3 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-cyan-300 border border-blue-200 dark:border-blue-800">
                  T = {timePeriod.toFixed(3)} s
                </span>
              </div>

              {/* Visual SVG Stage */}
              <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-4 flex flex-col items-center justify-center min-h-[300px] relative overflow-hidden shadow-inner">
                {/* Protractor scale arc */}
                <div className="absolute top-6 w-72 h-36 border-t-2 border-slate-700/60 rounded-t-full pointer-events-none flex justify-between px-2 text-[9px] font-mono text-slate-500">
                  <span>-30°</span>
                  <span>-15°</span>
                  <span>0°</span>
                  <span>+15°</span>
                  <span>+30°</span>
                </div>

                {/* Ceiling Clamp Stand */}
                <div className="w-36 h-4 bg-slate-700 rounded-b-md shadow-md z-10 flex items-center justify-center">
                  <div className="h-3 w-3 rounded-full bg-amber-400 shadow-xs" />
                </div>

                {/* Swinging Pendulum String & Bob */}
                <div
                  className="relative origin-top flex flex-col items-center transition-transform"
                  style={{
                    height: `${Math.min(220, pendulumLength * 120)}px`,
                    transform: `rotate(${currentPendulumAngleRad}rad)`,
                  }}
                >
                  {/* String */}
                  <div className="w-0.5 h-full bg-gradient-to-b from-amber-200 via-slate-300 to-amber-300 shadow-xs" />

                  {/* Metallic Bob */}
                  <div className="relative -mt-1 w-9 h-9 rounded-full bg-gradient-to-br from-amber-300 via-amber-500 to-amber-800 shadow-2xl border border-amber-200 flex items-center justify-center">
                    <div className="w-2 h-2 rounded-full bg-white/60 blur-[0.5px]" />
                  </div>
                </div>

                {/* Real-Time Angle Badge */}
                <div className="absolute bottom-3 left-4 text-[11px] font-mono text-cyan-300 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-800">
                  θ(t) = {((currentPendulumAngleRad * 180) / Math.PI).toFixed(1)}°
                </div>
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Pendulum String Length (L)</span>
                    <span className="font-mono">{pendulumLength.toFixed(2)} m</span>
                  </div>
                  <input
                    type="range"
                    min={0.4}
                    max={2.5}
                    step={0.05}
                    value={pendulumLength}
                    onChange={(e) => setPendulumLength(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Acceleration Due to Gravity (g)</span>
                    <span className="font-mono">{pendulumGravity.toFixed(2)} m/s²</span>
                  </div>
                  <input
                    type="range"
                    min={1.6}
                    max={20.0}
                    step={0.1}
                    value={pendulumGravity}
                    onChange={(e) => setPendulumGravity(Number(e.target.value))}
                    className="w-full accent-blue-600"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 2. VERNIER CALLIPERS VISUAL */}
          {activeExp === 'vernier' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Vernier Callipers Instrument &amp; Coincidence Loupe
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Measuring thin copper wire diameter. Least Count = 0.1 mm (0.01 cm).
                  </p>
                </div>
                <span className="font-mono text-xs font-bold px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Radius = {wireRadiusMm.toFixed(2)} mm
                </span>
              </div>

              {/* Visual Instrument SVG Stage */}
              <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-6 relative overflow-hidden min-h-[280px] flex flex-col justify-center">
                {/* Main Scale Steel Bar */}
                <div className="relative w-full h-12 bg-gradient-to-r from-slate-400 via-slate-300 to-slate-400 rounded-sm shadow-md border-b-2 border-slate-600 flex items-center px-4 overflow-hidden">
                  {/* Millimeter Ticks */}
                  <div className="flex items-end w-full h-full pb-1">
                    {Array.from({ length: 30 }).map((_, i) => (
                      <div key={i} className="flex-1 flex flex-col items-center">
                        <div
                          className={`w-0.5 bg-slate-900 ${
                            i % 10 === 0 ? 'h-6' : i % 5 === 0 ? 'h-4' : 'h-2'
                          }`}
                        />
                        {i % 10 === 0 && (
                          <span className="text-[8px] font-mono text-slate-900 mt-0.5 font-bold">
                            {i / 10}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Fixed Left Jaw & Clamped Thin Wire */}
                <div className="relative flex items-start -mt-12 pl-6">
                  {/* Fixed Jaw */}
                  <div className="w-8 h-32 bg-slate-400 border-r border-slate-600 rounded-b-md shadow-md" />

                  {/* Clamped Thin Wire */}
                  <div
                    className="h-16 bg-gradient-to-r from-amber-600 via-amber-400 to-amber-700 shadow-md self-center my-auto transition-all"
                    style={{ width: `${Math.max(6, vernierReadingMm * 6)}px` }}
                    title={`Thin wire diameter = ${vernierReadingMm.toFixed(2)} mm`}
                  />

                  {/* Sliding Vernier Jaw */}
                  <div className="relative -ml-1">
                    <div className="w-24 h-28 bg-gradient-to-b from-slate-200 to-slate-300 border-l border-slate-500 rounded-b-md shadow-lg p-1.5 flex flex-col justify-between">
                      <div className="text-[9px] font-mono font-bold text-slate-800 text-center">
                        VERNIER (0.1 mm)
                      </div>
                      {/* Vernier 10 scale ticks */}
                      <div className="flex justify-between px-1 pb-1">
                        {Array.from({ length: 11 }).map((_, k) => (
                          <div key={k} className="flex flex-col items-center">
                            <div
                              className={`w-0.5 ${
                                k === vernierCoincide ? 'bg-red-600 h-4 font-bold scale-125' : 'bg-slate-700 h-2.5'
                              }`}
                            />
                            {k % 5 === 0 && <span className="text-[7px] font-mono text-slate-800">{k}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Magnified Loupe Viewport on Coincidence */}
                <div className="absolute right-6 top-6 w-28 h-28 rounded-full border-4 border-emerald-400 bg-slate-900/90 shadow-2xl p-2 flex flex-col items-center justify-center text-center font-mono text-xs">
                  <div className="text-[10px] text-emerald-300 font-bold">COINCIDENCE</div>
                  <div className="text-xl font-bold text-white my-0.5">{vernierCoincide}th div</div>
                  <div className="text-[9px] text-slate-400">VSR = {(vernierCoincide * 0.1).toFixed(2)} mm</div>
                </div>
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Main Scale Reading (MSR)</span>
                    <span className="font-mono">{mainScaleMm.toFixed(1)} mm</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={12}
                    step={1}
                    value={mainScaleMm}
                    onChange={(e) => setMainScaleMm(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Vernier Coinciding Division (VSD)</span>
                    <span className="font-mono">{vernierCoincide}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={1}
                    value={vernierCoincide}
                    onChange={(e) => setVernierCoincide(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 3. SCREW GAUGE (MICROMETER) VISUAL */}
          {activeExp === 'screw_gauge' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Screw Gauge (Micrometer) &amp; Clamped Bob
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Pitch = 1 mm, 100 circular divisions. Least count = 0.01 mm.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold px-3 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  Bob Diameter = {screwReadingMm.toFixed(2)} mm
                </span>
              </div>

              {/* Visual Instrument SVG Stage */}
              <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-6 relative overflow-hidden min-h-[260px] flex items-center justify-center">
                {/* U-Shaped Metal Frame */}
                <div className="relative flex items-center">
                  {/* Heavy Steel U Frame */}
                  <div className="w-24 h-36 rounded-l-full border-8 border-slate-500 border-r-0 flex items-center justify-end pr-2">
                    {/* Fixed Anvil */}
                    <div className="w-4 h-6 bg-slate-300 rounded-l-xs" />
                  </div>

                  {/* Clamped Metallic Bob */}
                  <div
                    className="rounded-full bg-gradient-to-br from-slate-200 via-slate-400 to-slate-700 shadow-xl border border-slate-300 shrink-0 mx-1"
                    style={{
                      width: `${Math.max(20, screwReadingMm * 4.2)}px`,
                      height: `${Math.max(20, screwReadingMm * 4.2)}px`,
                    }}
                    title={`Metallic Bob Diameter = ${screwReadingMm.toFixed(2)} mm`}
                  />

                  {/* Movable Spindle */}
                  <div className="w-10 h-6 bg-slate-300 border-l border-slate-400 shadow-inner" />

                  {/* Main Barrel with Pitch Scale & Datum Line */}
                  <div className="w-28 h-12 bg-gradient-to-b from-slate-300 to-slate-400 border border-slate-500 relative flex items-center px-1">
                    <div className="w-full h-0.5 bg-red-600" title="Reference Datum Line" />
                    <div className="absolute top-1 left-2 text-[9px] font-mono text-slate-900 font-bold">
                      {pitchScaleMm} mm
                    </div>
                  </div>

                  {/* Rotating Circular Thimble */}
                  <div className="w-20 h-16 bg-gradient-to-b from-slate-200 via-slate-100 to-slate-300 border border-slate-400 rounded-r-md shadow-lg flex flex-col justify-center items-center font-mono">
                    <div className="text-[8px] text-slate-500">CIRCULAR</div>
                    <div className="text-xs font-bold text-slate-900">{circularDiv} div</div>
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Pitch Scale Reading (PSR)</span>
                    <span className="font-mono">{pitchScaleMm} mm</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={pitchScaleMm}
                    onChange={(e) => setPitchScaleMm(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Circular Scale Divisions (CSR)</span>
                    <span className="font-mono">{circularDiv}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={99}
                    step={1}
                    value={circularDiv}
                    onChange={(e) => setCircularDiv(Number(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 4. SPHEROMETER VISUAL */}
          {activeExp === 'spherometer' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Spherometer &amp; Curved Glass Lens
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Formula R = (l² / 6h) + (h / 2). Radius of curvature and focal length.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold px-3 py-1 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  Focal Length ≈ {estimatedFocalLength.toFixed(2)} cm
                </span>
              </div>

              {/* Visual Instrument SVG Stage */}
              <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-6 relative overflow-hidden min-h-[260px] flex flex-col items-center justify-center">
                {/* Central Screw Milled Head */}
                <div className="w-10 h-6 bg-slate-600 rounded-t-sm shadow-md" />

                {/* Circular Disc Scale (100 divisions) */}
                <div className="w-36 h-8 bg-gradient-to-r from-slate-300 via-slate-100 to-slate-300 border-2 border-slate-500 rounded-full shadow-lg flex items-center justify-center font-mono text-[10px] text-slate-900 font-bold">
                  CIRCULAR DISC ({spherometerShedHeight.toFixed(3)} cm)
                </div>

                {/* Vertical Central Screw Leg & 3 Outer Triangular Legs */}
                <div className="relative w-56 flex justify-between items-end h-24">
                  {/* Outer Leg 1 */}
                  <div className="w-2.5 h-full bg-slate-400 rounded-b-full shadow-md" />
                  {/* Central Screw touching curved vertex */}
                  <div
                    className="w-2.5 bg-amber-400 rounded-b-full shadow-md transition-all"
                    style={{ height: `${90 - spherometerShedHeight * 40}%` }}
                  />
                  {/* Outer Leg 2 */}
                  <div className="w-2.5 h-full bg-slate-400 rounded-b-full shadow-md" />
                </div>

                {/* Curved Glass Convex Lens */}
                <div className="w-64 h-10 border-t-4 border-cyan-400 bg-cyan-500/20 rounded-t-full shadow-lg mt-1" />
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Distance Between Legs (l)</span>
                    <span className="font-mono">{spherometerLegDist.toFixed(1)} cm</span>
                  </div>
                  <input
                    type="range"
                    min={3.0}
                    max={8.0}
                    step={0.1}
                    value={spherometerLegDist}
                    onChange={(e) => setSpherometerLegDist(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Sagitta Elevation Height (h)</span>
                    <span className="font-mono">{spherometerShedHeight.toFixed(3)} cm</span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={0.6}
                    step={0.01}
                    value={spherometerShedHeight}
                    onChange={(e) => setSpherometerShedHeight(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 5. HOOKE'S LAW VISUAL */}
          {activeExp === 'hookes_law' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Hooke&apos;s Law Helical Spring Stand
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Restoring force F = -kx. Observe physical spring extension with slotted weights.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold px-3 py-1 rounded-xl bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  Extension = {springExtensionCm.toFixed(1)} cm
                </span>
              </div>

              {/* Visual Instrument SVG Stage */}
              <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-6 relative overflow-hidden min-h-[300px] flex items-center justify-center">
                {/* Laboratory Stand Rod */}
                <div className="absolute left-1/3 top-6 bottom-6 w-3 bg-slate-600 rounded-sm shadow-md" />
                <div className="absolute left-1/4 bottom-6 w-36 h-4 bg-slate-700 rounded-md" />

                {/* Upper Clamp Arm */}
                <div className="absolute left-1/3 top-10 w-24 h-3 bg-slate-500 rounded-r-md" />

                {/* Vertical Ruler alongside */}
                <div className="absolute right-1/4 top-10 bottom-12 w-6 border border-slate-700 bg-slate-900/90 rounded-sm flex flex-col justify-between p-1 font-mono text-[8px] text-slate-500">
                  <span>0cm</span>
                  <span>10cm</span>
                  <span>20cm</span>
                  <span>30cm</span>
                  <span>40cm</span>
                </div>

                {/* Dynamic Coiled Spring */}
                <div className="relative flex flex-col items-center ml-16">
                  {/* Coils */}
                  <div
                    className="w-8 border-x-4 border-dashed border-slate-300 transition-all duration-300"
                    style={{ height: `${Math.min(180, 50 + springExtensionCm * 4)}px` }}
                  />

                  {/* Knife-Edge Pointer */}
                  <div className="w-16 h-1 bg-red-500 shadow-md self-end -mr-6" title="Knife edge pointer" />

                  {/* Slotted Weights Hanger */}
                  <div className="w-10 h-10 rounded-md bg-gradient-to-b from-amber-400 to-amber-600 shadow-lg border border-amber-300 flex items-center justify-center font-mono text-[10px] font-bold text-amber-950">
                    {appliedLoadKg.toFixed(2)}kg
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Spring Constant (k)</span>
                    <span className="font-mono">{springConstant} N/m</span>
                  </div>
                  <input
                    type="range"
                    min={10}
                    max={80}
                    step={5}
                    value={springConstant}
                    onChange={(e) => setSpringConstant(Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Slotted Weights Load (m)</span>
                    <span className="font-mono">{appliedLoadKg.toFixed(2)} kg</span>
                  </div>
                  <input
                    type="range"
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    value={appliedLoadKg}
                    onChange={(e) => setAppliedLoadKg(Number(e.target.value))}
                    className="w-full accent-purple-500"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 6. STOKES' LAW & VISCOSITY VISUAL */}
          {activeExp === 'stokes_law' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Stokes&apos; Law Viscous Fluid Cylinder
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Terminal velocity v = (2r²(ρ - σ)g) / 9η in pure glycerine.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold px-3 py-1 rounded-xl bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                  v = {(terminalVelocity * 100).toFixed(2)} cm/s
                </span>
              </div>

              {/* Visual Instrument SVG Stage */}
              <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-6 relative overflow-hidden min-h-[300px] flex items-center justify-center">
                {/* Tall Glass Cylinder filled with Glycerine */}
                <div className="relative w-28 h-64 border-2 border-slate-400 bg-amber-400/20 backdrop-blur-xs rounded-b-2xl overflow-hidden shadow-2xl flex flex-col justify-between">
                  {/* Mark A */}
                  <div className="w-full border-b border-dashed border-red-500 pt-8 px-1 text-[8px] font-mono text-red-400">
                    MARK A
                  </div>

                  {/* Falling Steel Ball */}
                  <div
                    className="absolute left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-br from-slate-100 via-slate-400 to-slate-800 shadow-xl border border-slate-300 transition-all duration-75"
                    style={{
                      width: `${Math.max(10, ballRadiusMm * 4.5)}px`,
                      height: `${Math.max(10, ballRadiusMm * 4.5)}px`,
                      top: `${Math.min(220, 15 + ballDropProgress * 200)}px`,
                    }}
                    title={`Steel sphere radius = ${ballRadiusMm} mm`}
                  />

                  {/* Mark B */}
                  <div className="w-full border-t border-dashed border-red-500 pb-8 px-1 text-[8px] font-mono text-red-400 text-right">
                    MARK B
                  </div>
                </div>

                {/* Stopwatch Readout Badge */}
                <div className="absolute right-8 top-8 rounded-xl border border-slate-700 bg-slate-900/90 p-3 font-mono text-xs text-slate-200 space-y-1">
                  <div className="text-teal-300 font-bold">FLUID: GLYCERINE</div>
                  <div className="text-[11px] text-slate-400">Viscosity η = 1.41 Pa·s</div>
                  <button
                    type="button"
                    onClick={() => setBallDropProgress(0)}
                    className="mt-2 w-full rounded-lg bg-teal-600 hover:bg-teal-500 text-white py-1 text-xs font-semibold"
                  >
                    Drop New Ball
                  </button>
                </div>
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Steel Ball Radius (r)</span>
                    <span className="font-mono">{ballRadiusMm.toFixed(1)} mm</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={5.0}
                    step={0.1}
                    value={ballRadiusMm}
                    onChange={(e) => setBallRadiusMm(Number(e.target.value))}
                    className="w-full accent-teal-500"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 7. RESONANCE TUBE VISUAL */}
          {activeExp === 'resonance_tube' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-5 shadow-xs">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                    Acoustic Resonance Tube Apparatus
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Acoustic quarter-wave resonance (l₁ ≈ λ/4). Adjust water column to amplify sound.
                  </p>
                </div>
                <span className="font-mono text-xs font-bold px-3 py-1 rounded-xl bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800">
                  Target λ/4 ≈ {firstResonanceLengthCm.toFixed(1)} cm
                </span>
              </div>

              {/* Visual Instrument SVG Stage */}
              <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-6 relative overflow-hidden min-h-[320px] flex items-center justify-center">
                {/* Vibrating Tuning Fork */}
                <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center">
                  <div className={`text-xs font-mono font-bold flex items-center gap-1 ${isResonating ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`}>
                    <Volume2 className="h-4 w-4" />
                    {tuningFrequencyHz} Hz Tuning Fork
                  </div>
                  <div className="w-8 h-8 border-x-4 border-slate-300 rounded-b-md mt-1" />
                </div>

                {/* Resonance Glass Tube & Water Column */}
                <div className="relative w-20 h-64 border-2 border-slate-300 bg-slate-900/60 rounded-b-lg overflow-hidden shadow-2xl flex flex-col justify-end mt-8">
                  {/* Acoustic Standing Wave Pattern inside air column */}
                  <div className="relative w-full flex-1 flex items-center justify-center overflow-hidden">
                    {isResonating && (
                      <div className="w-12 h-full border-x-2 border-cyan-400/80 bg-cyan-400/20 rounded-full animate-ping" />
                    )}
                  </div>

                  {/* Water column */}
                  <div
                    className="w-full bg-gradient-to-t from-blue-700 to-cyan-500 transition-all duration-300"
                    style={{ height: `${Math.min(90, Math.max(10, waterLevelCm * 3.5))}%` }}
                  />
                </div>

                {/* Resonance Alert Banner */}
                {isResonating && (
                  <div className="absolute bottom-4 inset-x-8 rounded-xl border border-emerald-500 bg-emerald-950/90 p-3 text-center text-xs font-bold text-emerald-300 shadow-xl flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-400" />
                    ACOUSTIC RESONANCE DETECTED! Loud sound amplified (Node at water, Antinode at mouth).
                  </div>
                )}
              </div>

              {/* Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Tuning Fork Frequency</span>
                    <span className="font-mono">{tuningFrequencyHz} Hz</span>
                  </div>
                  <select
                    value={tuningFrequencyHz}
                    onChange={(e) => setTuningFrequencyHz(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
                  >
                    <option value={256}>256 Hz (C Tuning Fork)</option>
                    <option value={320}>320 Hz (E Tuning Fork)</option>
                    <option value={384}>384 Hz (G Tuning Fork)</option>
                    <option value={512}>512 Hz (High C₂ Tuning Fork)</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span>Resonance Water Level Height</span>
                    <span className="font-mono">{waterLevelCm.toFixed(1)} cm</span>
                  </div>
                  <input
                    type="range"
                    min={5.0}
                    max={40.0}
                    step={0.2}
                    value={waterLevelCm}
                    onChange={(e) => setWaterLevelCm(Number(e.target.value))}
                    className="w-full accent-cyan-500"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
