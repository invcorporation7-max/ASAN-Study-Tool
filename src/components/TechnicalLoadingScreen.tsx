import React, { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext';

interface TechnicalLoadingScreenProps {
  children?: React.ReactNode;
}

const CX = 220;
const CY = 220;

function polar(r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return {
    x: Number((CX + r * Math.cos(rad)).toFixed(2)),
    y: Number((CY + r * Math.sin(rad)).toFixed(2)),
  };
}

function arcPath(r: number, startDeg: number, endDeg: number): string {
  const start = polar(r, startDeg);
  const end = polar(r, endDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export const TechnicalLoadingScreen: React.FC<TechnicalLoadingScreenProps> = ({
  children,
}) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [dotCount, setDotCount] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDotCount((prev) => (prev === 1 ? 2 : prev === 2 ? 3 : 1));
    }, 420);
    return () => window.clearInterval(timer);
  }, []);

  const dots = '.'.repeat(dotCount);

  // Theme-adaptive color tokens:
  // Light mode -> Pure white background + navy blue rings
  // Dark mode  -> Dark site background (#020617) + light-colored blue rings
  const bgHex = isDark ? '#020617' : '#FFFFFF';
  const ringDark = isDark ? '#7DD3FC' : '#172554';
  const ringPrimary = isDark ? '#BAE6FD' : '#1E3A8A';
  const ringMid = isDark ? '#38BDF8' : '#1D4ED8';
  const ringSoft = isDark ? '#E0F2FE' : '#3B82F6';
  const cutoutFill = bgHex;

  // Expanded ring radii so there is clear breathing room around "ASAN"
  const outerTicks = Array.from({ length: 96 }, (_, i) => {
    const deg = (i * 360) / 96;
    const isMajor = i % 4 === 0;
    const isMedium = i % 2 === 0;
    const r1 = 187;
    const r2 = isMajor ? 206 : isMedium ? 199 : 194;
    const p1 = polar(r1, deg);
    const p2 = polar(r2, deg);
    return { i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, isMajor };
  });

  const rightCollarHoles = [-24, -10, 4, 18, 32].map((deg) => polar(169, deg));
  const leftCollarHoles = [164, 180, 196].map((deg) => polar(169, deg));

  const bracketNodes = [25, 115, 205, 295].map((deg) => ({
    deg,
    pos: polar(147, deg),
  }));

  const microDots = Array.from({ length: 64 }, (_, i) => {
    const pos = polar(132, (i * 360) / 64);
    return { i, cx: pos.x, cy: pos.y };
  });

  const innerTicks = Array.from({ length: 60 }, (_, i) => {
    const deg = (i * 360) / 60;
    const p1 = polar(108, deg);
    const p2 = polar(i % 5 === 0 ? 119 : 116, deg);
    return { i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, major: i % 5 === 0 };
  });

  return (
    <div
      className={`flex min-h-screen w-full flex-col items-center justify-center px-4 py-8 select-none transition-colors ${
        isDark ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'
      }`}
      style={{ backgroundColor: bgHex }}
    >
      <div className="flex flex-col items-center">
        <div className="relative flex items-center justify-center w-[280px] h-[280px] sm:w-[340px] sm:h-[340px]">
          <svg
            viewBox="0 0 440 440"
            className="h-full w-full overflow-visible"
            role="img"
            aria-label="ASAN loading technical ring"
          >
            {/* Chunk 2 (Clockwise): Outer radial tick perimeter dial */}
            <g
              className="asan-hud-cw"
              style={
                {
                  '--hud-dur': '32s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              <circle
                cx={CX}
                cy={CY}
                r="187"
                fill="none"
                stroke={ringSoft}
                strokeOpacity={isDark ? '0.45' : '0.35'}
                strokeWidth="1"
              />
              {outerTicks.map((t) => (
                <line
                  key={t.i}
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  stroke={t.isMajor ? ringPrimary : ringMid}
                  strokeWidth={t.isMajor ? '1.8' : '1.1'}
                  strokeOpacity={t.isMajor ? '0.9' : '0.68'}
                />
              ))}
            </g>

            {/* Chunk 3 (Anti-clockwise): Outer thick curved collar with punched holes + dashed tracks */}
            <g
              className="asan-hud-ccw"
              style={
                {
                  '--hud-dur': '20s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              <path
                d={arcPath(169, -36, 44)}
                fill="none"
                stroke={ringMid}
                strokeWidth="13"
                strokeLinecap="butt"
              />
              {rightCollarHoles.map((pt, idx) => (
                <circle key={`rh-${idx}`} cx={pt.x} cy={pt.y} r="2.4" fill={cutoutFill} />
              ))}

              <path
                d={arcPath(169, 152, 208)}
                fill="none"
                stroke={ringPrimary}
                strokeWidth="9.5"
                strokeLinecap="butt"
                strokeOpacity="0.92"
              />
              {leftCollarHoles.map((pt, idx) => (
                <circle key={`lh-${idx}`} cx={pt.x} cy={pt.y} r="2.0" fill={cutoutFill} />
              ))}

              <path
                d={arcPath(169, 56, 140)}
                fill="none"
                stroke={ringSoft}
                strokeWidth="2.8"
                strokeDasharray="6 6"
              />
              <path
                d={arcPath(169, 220, 312)}
                fill="none"
                stroke={ringSoft}
                strokeWidth="2.8"
                strokeDasharray="10 5"
              />
            </g>

            {/* Chunk 4 (Clockwise): Mid segmented arc + rectangular HUD bracket nodes */}
            <g
              className="asan-hud-cw"
              style={
                {
                  '--hud-dur': '16s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              <circle
                cx={CX}
                cy={CY}
                r="147"
                fill="none"
                stroke={ringMid}
                strokeWidth="1.2"
                strokeOpacity="0.45"
              />
              <path
                d={arcPath(147, -10, 42)}
                fill="none"
                stroke={ringPrimary}
                strokeWidth="4.5"
              />
              <path
                d={arcPath(147, 130, 178)}
                fill="none"
                stroke={ringMid}
                strokeWidth="4.5"
              />
              <path
                d={arcPath(147, 250, 292)}
                fill="none"
                stroke={ringSoft}
                strokeWidth="3.5"
              />
              {bracketNodes.map((node) => (
                <g
                  key={node.deg}
                  transform={`translate(${node.pos.x}, ${node.pos.y}) rotate(${node.deg})`}
                >
                  <rect
                    x="-6"
                    y="-3.5"
                    width="12"
                    height="7"
                    fill={cutoutFill}
                    stroke={ringPrimary}
                    strokeWidth="1.5"
                  />
                </g>
              ))}
            </g>

            {/* Chunk 5 (Anti-clockwise): Micro-dot calibration ring */}
            <g
              className="asan-hud-ccw"
              style={
                {
                  '--hud-dur': '24s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              <circle
                cx={CX}
                cy={CY}
                r="125.5"
                fill="none"
                stroke={ringSoft}
                strokeOpacity="0.65"
                strokeWidth="1"
              />
              {microDots.map((d) => (
                <circle
                  key={d.i}
                  cx={d.cx}
                  cy={d.cy}
                  r="1.65"
                  fill={ringPrimary}
                  fillOpacity="0.8"
                />
              ))}
            </g>

            {/* Chunk 6 (Clockwise): Dense inner radial tick dial */}
            <g
              className="asan-hud-cw"
              style={
                {
                  '--hud-dur': '22s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              {innerTicks.map((t) => (
                <line
                  key={t.i}
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  stroke={t.major ? ringPrimary : ringMid}
                  strokeWidth={t.major ? '2.1' : '1.4'}
                  strokeOpacity={t.major ? '0.92' : '0.68'}
                />
              ))}
            </g>

            {/* Chunk 7 (Anti-clockwise): Inner thick segmented rotor arcs */}
            <g
              className="asan-hud-ccw"
              style={
                {
                  '--hud-dur': '12s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              <path
                d={arcPath(94, -120, -25)}
                fill="none"
                stroke={ringMid}
                strokeWidth="7"
                strokeLinecap="butt"
              />
              <path
                d={arcPath(94, 45, 145)}
                fill="none"
                stroke={ringPrimary}
                strokeWidth="6"
                strokeLinecap="butt"
              />
              <path
                d={arcPath(94, 175, 220)}
                fill="none"
                stroke={ringSoft}
                strokeWidth="2.5"
              />
            </g>

            {/* Chunk 8 (Clockwise): Innermost core delicate arcs (spaced far from ASAN) */}
            <g
              className="asan-hud-cw"
              style={
                {
                  '--hud-dur': '8s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              <path
                d={arcPath(78, 0, 110)}
                fill="none"
                stroke={ringDark}
                strokeWidth="2"
              />
              <path
                d={arcPath(78, 165, 295)}
                fill="none"
                stroke={ringSoft}
                strokeWidth="1.6"
              />
            </g>
          </svg>

          {/* Static Center Brand Name */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span
              className={`font-display text-lg sm:text-xl font-extrabold tracking-[0.2em] pl-[0.2em] ${
                isDark ? 'text-sky-100' : 'text-blue-950'
              }`}
            >
              ASAN
            </span>
          </div>
        </div>

        {/* Animated Loading. -> Loading.. -> Loading... */}
        <div
          className={`mt-3 flex items-center justify-center font-mono text-sm sm:text-base font-semibold tracking-wider ${
            isDark ? 'text-sky-200' : 'text-blue-950'
          }`}
          aria-live="polite"
        >
          <span>Loading</span>
          <span className={`inline-block w-[3ch] text-left ${isDark ? 'text-sky-300' : 'text-blue-800'}`}>
            {dots}
          </span>
        </div>
      </div>

      {children && <div className="mt-6 w-full max-w-md">{children}</div>}
    </div>
  );
};
