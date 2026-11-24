import React, { useEffect, useState } from 'react';

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
  const [dotCount, setDotCount] = useState<1 | 2 | 3>(1);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDotCount((prev) => (prev === 1 ? 2 : prev === 2 ? 3 : 1));
    }, 420);
    return () => window.clearInterval(timer);
  }, []);

  const dots = '.'.repeat(dotCount);

  // Precompute deterministic radial ticks & micro-dots
  const outerTicks = Array.from({ length: 96 }, (_, i) => {
    const deg = (i * 360) / 96;
    const isMajor = i % 4 === 0;
    const isMedium = i % 2 === 0;
    const r1 = 156;
    const r2 = isMajor ? 174 : isMedium ? 168 : 163;
    const p1 = polar(r1, deg);
    const p2 = polar(r2, deg);
    return { i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, isMajor };
  });

  const rightCollarHoles = [-24, -10, 4, 18, 32].map((deg) => polar(138, deg));
  const leftCollarHoles = [164, 180, 196].map((deg) => polar(138, deg));

  const bracketNodes = [25, 115, 205, 295].map((deg) => ({
    deg,
    pos: polar(118, deg),
  }));

  const microDots = Array.from({ length: 64 }, (_, i) => {
    const pos = polar(103, (i * 360) / 64);
    return { i, cx: pos.x, cy: pos.y };
  });

  const innerTicks = Array.from({ length: 60 }, (_, i) => {
    const deg = (i * 360) / 60;
    const p1 = polar(81, deg);
    const p2 = polar(i % 5 === 0 ? 92 : 89, deg);
    return { i, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, major: i % 5 === 0 };
  });

  return (
    <div
      className="flex min-h-screen w-full flex-col items-center justify-center bg-white px-4 py-8 text-slate-900 select-none"
      style={{ backgroundColor: '#FFFFFF' }}
    >
      <div className="flex flex-col items-center">
        <div className="relative flex items-center justify-center w-[280px] h-[280px] sm:w-[340px] sm:h-[340px]">
          <svg
            viewBox="0 0 440 440"
            className="h-full w-full overflow-visible"
            role="img"
            aria-label="ASAN loading technical ring"
          >
            {/* Chunk 1 (Anti-clockwise slow): Outermost angled trace lines with endpoint nodes */}
            <g
              className="asan-hud-ccw"
              style={
                {
                  '--hud-dur': '38s',
                  transformOrigin: '220px 220px',
                } as React.CSSProperties
              }
            >
              <rect x="0" y="0" width="440" height="440" fill="none" />
              <polyline
                points="344,108 370,82 406,82"
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="1.4"
                strokeOpacity="0.65"
              />
              <circle cx="409" cy="82" r="2.8" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.5" />

              <polyline
                points="98,106 72,80 34,80"
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="1.4"
                strokeOpacity="0.65"
              />
              <circle cx="31" cy="80" r="2.8" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.5" />

              <polyline
                points="94,332 66,360 32,360"
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="1.4"
                strokeOpacity="0.65"
              />
              <circle cx="29" cy="360" r="2.8" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.5" />

              <polyline
                points="346,334 374,362 408,362"
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="1.4"
                strokeOpacity="0.65"
              />
              <circle cx="411" cy="362" r="2.8" fill="#FFFFFF" stroke="#0284C7" strokeWidth="1.5" />
            </g>

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
                r="156"
                fill="none"
                stroke="#BAE6FD"
                strokeWidth="1"
              />
              {outerTicks.map((t) => (
                <line
                  key={t.i}
                  x1={t.x1}
                  y1={t.y1}
                  x2={t.x2}
                  y2={t.y2}
                  stroke={t.isMajor ? '#0284C7' : '#38BDF8'}
                  strokeWidth={t.isMajor ? '1.8' : '1.1'}
                  strokeOpacity={t.isMajor ? '0.85' : '0.65'}
                />
              ))}
            </g>

            {/* Chunk 3 (Anti-clockwise): Outer thick curved collar with punched white holes + dashed tracks */}
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
              {/* Primary thick curved collar arc */}
              <path
                d={arcPath(138, -36, 44)}
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="14"
                strokeLinecap="butt"
              />
              {rightCollarHoles.map((pt, idx) => (
                <circle key={`rh-${idx}`} cx={pt.x} cy={pt.y} r="2.5" fill="#FFFFFF" />
              ))}

              {/* Opposite secondary collar arc */}
              <path
                d={arcPath(138, 152, 208)}
                fill="none"
                stroke="#0284C7"
                strokeWidth="10"
                strokeLinecap="butt"
                strokeOpacity="0.9"
              />
              {leftCollarHoles.map((pt, idx) => (
                <circle key={`lh-${idx}`} cx={pt.x} cy={pt.y} r="2.1" fill="#FFFFFF" />
              ))}

              {/* Connecting dashed & hairline arcs on r=138 */}
              <path
                d={arcPath(138, 56, 140)}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="3"
                strokeDasharray="6 6"
              />
              <path
                d={arcPath(138, 220, 312)}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="3"
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
                r="118"
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="1.2"
                strokeOpacity="0.45"
              />
              <path
                d={arcPath(118, -10, 42)}
                fill="none"
                stroke="#0284C7"
                strokeWidth="4.5"
              />
              <path
                d={arcPath(118, 130, 178)}
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="4.5"
              />
              <path
                d={arcPath(118, 250, 292)}
                fill="none"
                stroke="#38BDF8"
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
                    fill="#FFFFFF"
                    stroke="#0284C7"
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
                r="96.5"
                fill="none"
                stroke="#7DD3FC"
                strokeWidth="1"
              />
              {microDots.map((d) => (
                <circle
                  key={d.i}
                  cx={d.cx}
                  cy={d.cy}
                  r="1.65"
                  fill="#0284C7"
                  fillOpacity="0.75"
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
                  stroke={t.major ? '#0284C7' : '#0EA5E9'}
                  strokeWidth={t.major ? '2.1' : '1.4'}
                  strokeOpacity={t.major ? '0.9' : '0.65'}
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
                d={arcPath(69, -120, -25)}
                fill="none"
                stroke="#0EA5E9"
                strokeWidth="7"
                strokeLinecap="butt"
              />
              <path
                d={arcPath(69, 45, 145)}
                fill="none"
                stroke="#0284C7"
                strokeWidth="6"
                strokeLinecap="butt"
              />
              <path
                d={arcPath(69, 175, 220)}
                fill="none"
                stroke="#7DD3FC"
                strokeWidth="2.5"
              />
            </g>

            {/* Chunk 8 (Clockwise): Innermost core delicate arcs */}
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
                d={arcPath(55, 0, 110)}
                fill="none"
                stroke="#0284C7"
                strokeWidth="2"
              />
              <path
                d={arcPath(55, 165, 295)}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="1.6"
              />
            </g>
          </svg>

          {/* Static Center Brand Name */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="font-display text-xl sm:text-2xl font-extrabold tracking-[0.22em] text-slate-900 pl-[0.22em]">
              ASAN
            </span>
          </div>
        </div>

        {/* Animated Loading. -> Loading.. -> Loading... */}
        <div
          className="mt-3 flex items-center justify-center font-mono text-sm sm:text-base font-semibold tracking-wider text-slate-800"
          aria-live="polite"
        >
          <span>Loading</span>
          <span className="inline-block w-[3ch] text-left text-sky-600">{dots}</span>
        </div>
      </div>

      {children && <div className="mt-6 w-full max-w-md">{children}</div>}
    </div>
  );
};
