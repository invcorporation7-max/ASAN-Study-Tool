import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Activity,
  ArrowRight,
  Axis3D,
  Box,
  Check,
  Circle,
  Clock,
  Code,
  Compass,
  Copy,
  Cpu,
  Edit3,
  Eraser,
  FastForward,
  Grid,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Move,
  Pause,
  PenTool,
  Play,
  Printer,
  RotateCcw,
  RotateCw,
  Sliders,
  Sparkles,
  Square,
  Trash2,
  Unlock,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type SlicePlaneType = 'xy' | 'yz' | 'xz';
export type MotionCoordRep = 'cartesian' | 'polar' | 'vector';
export type Shape3DType = 'none' | 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus';

export interface StationarySliceLayer {
  id: string;
  plane: SlicePlaneType;
  offset: number;
  label: string;
  dataUrl: string;
}

export interface GeometricCrossSectionShape {
  id: string;
  name: string;
  sectionType: 'Transverse Section' | 'Longitudinal Section';
  category: 'Cylinders & Tubes' | 'Cones & Spheres' | 'Torus & Ellipsoids' | 'Prisms & Columns' | 'Structural Beams' | 'Curves & Polygons';
  dimensionsText: string;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, color: string) => void;
}

export interface ReferenceFrameDef {
  id: string;
  name: string;
  type: 'inertial' | 'moving_constant_v' | 'accelerating' | 'rotating';
  origin: [number, number, number];
  velocity: [number, number, number];
  acceleration: [number, number, number];
  angularVelocity: number; // rad/s about Z
  color: string;
}

export const REFERENCE_FRAMES_PRESETS: ReferenceFrameDef[] = [
  {
    id: 's0',
    name: 'S₀: Inertial Lab Frame (Global Origin)',
    type: 'inertial',
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    acceleration: [0, 0, 0],
    angularVelocity: 0,
    color: '#38bdf8',
  },
  {
    id: 's1',
    name: 'S₁: Uniform Moving Frame (v = 2.0 m/s +X)',
    type: 'moving_constant_v',
    origin: [2, 0, 0],
    velocity: [2.0, 0, 0],
    acceleration: [0, 0, 0],
    angularVelocity: 0,
    color: '#22c55e',
  },
  {
    id: 's2',
    name: 'S₂: Accelerating Frame (a = 2.5 m/s² +X, -1.0 m/s² +Y)',
    type: 'accelerating',
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    acceleration: [2.5, -1.0, 0],
    angularVelocity: 0,
    color: '#f59e0b',
  },
  {
    id: 's3',
    name: 'S₃: Rotating Turntable Frame (ω = 1.25 rad/s about Z)',
    type: 'rotating',
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    acceleration: [0, 0, 0],
    angularVelocity: 1.25,
    color: '#a855f7',
  },
];

// Curated library of 30 geometric shapes with transverse/longitudinal sections and defined dimensions
export const GEOMETRIC_SHAPES_30: GeometricCrossSectionShape[] = [
  // 1-4: Cylinders & Tubes
  {
    id: 'cyl_trans',
    name: 'Cylinder',
    sectionType: 'Transverse Section',
    category: 'Cylinders & Tubes',
    dimensionsText: 'Diameter ⌀ = 3.0 m · Area = 7.07 m²',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 65, 0, Math.PI * 2);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      // Center mark & diameter dimension line
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx - 65, cy);
      ctx.lineTo(cx + 65, cy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('⌀ = 3.0 m', cx - 24, cy - 6);
    },
  },
  {
    id: 'cyl_long',
    name: 'Cylinder',
    sectionType: 'Longitudinal Section',
    category: 'Cylinders & Tubes',
    dimensionsText: 'Width W = 3.0 m · Height H = 6.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 50, cy - 80, 100, 160);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 50, cy - 80, 100, 160);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('W = 3.0 m', cx - 24, cy + 95);
      ctx.fillText('H = 6.0 m', cx + 55, cy);
    },
  },
  {
    id: 'pipe_trans',
    name: 'Hollow Cylindrical Pipe',
    sectionType: 'Transverse Section',
    category: 'Cylinders & Tubes',
    dimensionsText: 'Outer ⌀ = 4.0 m · Inner ⌀ = 2.4 m · Wall t = 0.8 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 75, 0, Math.PI * 2);
      ctx.arc(cx, cy, 45, 0, Math.PI * 2, true);
      ctx.fillStyle = `${col}44`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('OD=4.0m · ID=2.4m', cx - 48, cy - 82);
    },
  },
  {
    id: 'pipe_long',
    name: 'Hollow Cylindrical Pipe',
    sectionType: 'Longitudinal Section',
    category: 'Cylinders & Tubes',
    dimensionsText: 'Width W = 4.0 m · Height H = 6.0 m · Wall t = 0.8 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 70, cy - 75, 25, 150);
      ctx.fillRect(cx + 45, cy - 75, 25, 150);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 70, cy - 75, 25, 150);
      ctx.strokeRect(cx + 45, cy - 75, 25, 150);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Bore (Hollow Cavity)', cx - 55, cy);
    },
  },

  // 5-8: Cones & Spheres
  {
    id: 'cone_trans',
    name: 'Solid Cone',
    sectionType: 'Transverse Section',
    category: 'Cones & Spheres',
    dimensionsText: 'Circular Base Radius R = 2.5 m · Height H = 5.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 60, 0, Math.PI * 2);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Base R = 2.5 m', cx - 35, cy - 4);
    },
  },
  {
    id: 'cone_long',
    name: 'Solid Cone',
    sectionType: 'Longitudinal Section',
    category: 'Cones & Spheres',
    dimensionsText: 'Axial Triangle: Base B = 5.0 m · Altitude H = 5.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 80);
      ctx.lineTo(cx + 65, cy + 60);
      ctx.lineTo(cx - 65, cy + 60);
      ctx.closePath();
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Apex H=5.0m', cx - 30, cy - 90);
      ctx.fillText('Base B=5.0m', cx - 30, cy + 75);
    },
  },
  {
    id: 'frustum_trans',
    name: 'Truncated Cone / Frustum',
    sectionType: 'Transverse Section',
    category: 'Cones & Spheres',
    dimensionsText: 'Top Radius R₁ = 1.5 m · Base Radius R₂ = 3.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 70, 0, Math.PI * 2);
      ctx.arc(cx, cy, 35, 0, Math.PI * 2, true);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('R₁=1.5m · R₂=3.0m', cx - 45, cy - 78);
    },
  },
  {
    id: 'frustum_long',
    name: 'Truncated Cone / Frustum',
    sectionType: 'Longitudinal Section',
    category: 'Cones & Spheres',
    dimensionsText: 'Trapezoid: Base = 6.0 m · Top = 3.0 m · Height = 4.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 35, cy - 50);
      ctx.lineTo(cx + 35, cy - 50);
      ctx.lineTo(cx + 70, cy + 50);
      ctx.lineTo(cx - 70, cy + 50);
      ctx.closePath();
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Top = 3.0 m', cx - 25, cy - 60);
      ctx.fillText('Base = 6.0 m', cx - 30, cy + 65);
    },
  },
  {
    id: 'sphere_trans',
    name: 'Solid Sphere',
    sectionType: 'Transverse Section',
    category: 'Cones & Spheres',
    dimensionsText: 'Equatorial Great Circle: Radius R = 3.0 m · Area = 28.27 m²',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 70, 0, Math.PI * 2);
      ctx.fillStyle = `${col}44`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Great Circle R = 3.0 m', cx - 55, cy);
    },
  },
  {
    id: 'sphere_long',
    name: 'Solid Sphere',
    sectionType: 'Longitudinal Section',
    category: 'Cones & Spheres',
    dimensionsText: 'Meridian Plane Circle: Radius R = 3.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 70, 0, Math.PI * 2);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      // Axis lines
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(cx, cy - 70);
      ctx.lineTo(cx, cy + 70);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Polar Axis', cx + 6, cy - 40);
    },
  },
  {
    id: 'spherical_cap',
    name: 'Spherical Cap / Calotte',
    sectionType: 'Transverse Section',
    category: 'Cones & Spheres',
    dimensionsText: 'Circular Cap Base: Radius r = 2.2 m · Sagitta h = 1.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 55, 0, Math.PI * 2);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Base r = 2.2 m', cx - 35, cy);
    },
  },

  // 12-15: Torus & Ellipsoids
  {
    id: 'torus_trans',
    name: 'Torus (Donut)',
    sectionType: 'Transverse Section',
    category: 'Torus & Ellipsoids',
    dimensionsText: 'Twin Disjoint Circles: Major R = 4.0 m · Tube r = 1.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}44`;
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      // Left tube
      ctx.beginPath();
      ctx.arc(cx - 55, cy, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Right tube
      ctx.beginPath();
      ctx.arc(cx + 55, cy, 25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('r = 1.0 m', cx - 75, cy + 38);
      ctx.fillText('r = 1.0 m', cx + 35, cy + 38);
      ctx.fillText('Center Separation = 8.0 m', cx - 65, cy - 35);
    },
  },
  {
    id: 'torus_long',
    name: 'Torus (Donut)',
    sectionType: 'Longitudinal Section',
    category: 'Torus & Ellipsoids',
    dimensionsText: 'Equatorial Annulus: Outer R+r = 5.0 m · Inner R-r = 3.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 80, 0, Math.PI * 2);
      ctx.arc(cx, cy, 45, 0, Math.PI * 2, true);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Outer = 5.0 m · Inner = 3.0 m', cx - 75, cy - 88);
    },
  },
  {
    id: 'elliptic_cyl_trans',
    name: 'Elliptic Cylinder',
    sectionType: 'Transverse Section',
    category: 'Torus & Ellipsoids',
    dimensionsText: 'Ellipse: Semi-major a = 3.5 m · Semi-minor b = 2.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 75, 45, 0, 0, Math.PI * 2);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('a = 3.5 m · b = 2.0 m', cx - 55, cy);
    },
  },
  {
    id: 'ellipsoid_long',
    name: 'Solid Ellipsoid',
    sectionType: 'Longitudinal Section',
    category: 'Torus & Ellipsoids',
    dimensionsText: 'Elliptic Meridian: Semi-major a = 4.0 m · Semi-minor b = 2.5 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 80, 50, 0, 0, Math.PI * 2);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('a = 4.0 m · b = 2.5 m', cx - 55, cy);
    },
  },

  // 16-22: Prisms & Columns
  {
    id: 'cuboid_trans',
    name: 'Rectangular Cuboid',
    sectionType: 'Transverse Section',
    category: 'Prisms & Columns',
    dimensionsText: 'Rectangle: Width W = 4.0 m · Length L = 2.5 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 70, cy - 45, 140, 90);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 70, cy - 45, 140, 90);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('W = 4.0 m · L = 2.5 m', cx - 55, cy + 4);
    },
  },
  {
    id: 'cuboid_long',
    name: 'Rectangular Cuboid',
    sectionType: 'Longitudinal Section',
    category: 'Prisms & Columns',
    dimensionsText: 'Rectangle: Length L = 4.0 m · Height H = 5.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 60, cy - 75, 120, 150);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 60, cy - 75, 120, 150);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('L = 4.0 m · H = 5.0 m', cx - 55, cy);
    },
  },
  {
    id: 'square_col',
    name: 'Square Column',
    sectionType: 'Transverse Section',
    category: 'Prisms & Columns',
    dimensionsText: 'Square: Side s = 3.0 m · Area = 9.0 m²',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 55, cy - 55, 110, 110);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - 55, cy - 55, 110, 110);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('s = 3.0 m', cx - 24, cy + 4);
    },
  },
  {
    id: 'tri_prism_trans',
    name: 'Triangular Prism',
    sectionType: 'Transverse Section',
    category: 'Prisms & Columns',
    dimensionsText: 'Equilateral Triangle: Side a = 3.5 m · Height h = 3.03 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 65);
      ctx.lineTo(cx + 65, cy + 50);
      ctx.lineTo(cx - 65, cy + 50);
      ctx.closePath();
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('a = 3.5 m', cx - 24, cy + 65);
    },
  },
  {
    id: 'hex_prism_trans',
    name: 'Hexagonal Prism',
    sectionType: 'Transverse Section',
    category: 'Prisms & Columns',
    dimensionsText: 'Regular Hexagon: Across Flats D = 4.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      const r = 65;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i * Math.PI) / 3;
        const x = cx + r * Math.cos(ang);
        const y = cy + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Hexagon D = 4.0 m', cx - 48, cy + 4);
    },
  },
  {
    id: 'oct_col_trans',
    name: 'Octagonal Column',
    sectionType: 'Transverse Section',
    category: 'Prisms & Columns',
    dimensionsText: 'Regular Octagon: Diameter D = 4.5 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      const r = 68;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = (i * Math.PI) / 4 + Math.PI / 8;
        const x = cx + r * Math.cos(ang);
        const y = cy + r * Math.sin(ang);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Octagon D = 4.5 m', cx - 50, cy + 4);
    },
  },

  // 23-26: Structural Beams
  {
    id: 'ibeam_trans',
    name: 'Structural I-Beam',
    sectionType: 'Transverse Section',
    category: 'Structural Beams',
    dimensionsText: 'Flange b = 3.0 m · Depth d = 5.0 m · Web tw = 0.6 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}44`;
      // Top Flange
      ctx.fillRect(cx - 65, cy - 70, 130, 20);
      // Web
      ctx.fillRect(cx - 15, cy - 50, 30, 100);
      // Bottom Flange
      ctx.fillRect(cx - 65, cy + 50, 130, 20);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(cx - 65, cy - 70, 130, 20);
      ctx.strokeRect(cx - 15, cy - 50, 30, 100);
      ctx.strokeRect(cx - 65, cy + 50, 130, 20);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('I-Beam (Flange 3.0m, Web 5.0m)', cx - 80, cy - 80);
    },
  },
  {
    id: 'tbeam_trans',
    name: 'Structural T-Beam',
    sectionType: 'Transverse Section',
    category: 'Structural Beams',
    dimensionsText: 'Top Flange W = 3.5 m · Stem Depth H = 4.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 65, cy - 60, 130, 22);
      ctx.fillRect(cx - 15, cy - 38, 30, 95);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(cx - 65, cy - 60, 130, 22);
      ctx.strokeRect(cx - 15, cy - 38, 30, 95);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('T-Beam (W=3.5m, H=4.0m)', cx - 65, cy + 72);
    },
  },
  {
    id: 'cbeam_trans',
    name: 'Channel C-Beam',
    sectionType: 'Transverse Section',
    category: 'Structural Beams',
    dimensionsText: 'Web Depth H = 4.0 m · Flanges b = 2.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 50, cy - 65, 25, 130);
      ctx.fillRect(cx - 25, cy - 65, 75, 20);
      ctx.fillRect(cx - 25, cy + 45, 75, 20);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(cx - 50, cy - 65, 25, 130);
      ctx.strokeRect(cx - 25, cy - 65, 75, 20);
      ctx.strokeRect(cx - 25, cy + 45, 75, 20);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Channel C-Beam', cx - 45, cy);
    },
  },
  {
    id: 'lbeam_trans',
    name: 'Angle Iron L-Beam',
    sectionType: 'Transverse Section',
    category: 'Structural Beams',
    dimensionsText: 'Equal Legs: L₁ = 3.0 m · L₂ = 3.0 m · t = 0.6 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.fillStyle = `${col}33`;
      ctx.fillRect(cx - 55, cy - 60, 25, 120);
      ctx.fillRect(cx - 30, cy + 35, 85, 25);
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(cx - 55, cy - 60, 25, 120);
      ctx.strokeRect(cx - 30, cy + 35, 85, 25);
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Angle L-Beam', cx - 15, cy - 10);
    },
  },

  // 27-30: Curves & Polygons
  {
    id: 'parabola_long',
    name: 'Parabolic Dish Reflector',
    sectionType: 'Longitudinal Section',
    category: 'Curves & Polygons',
    dimensionsText: 'Aperture = 6.0 m · Focal Length f = 1.5 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2 + 30;
      ctx.beginPath();
      ctx.moveTo(cx - 75, cy - 80);
      ctx.quadraticCurveTo(cx, cy + 30, cx + 75, cy - 80);
      ctx.strokeStyle = col;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Aperture = 6.0 m', cx - 48, cy - 90);
      ctx.fillText('Focus f = 1.5 m', cx - 40, cy - 25);
    },
  },
  {
    id: 'aerofoil_long',
    name: 'Symmetric Aerofoil NACA 0012',
    sectionType: 'Longitudinal Section',
    category: 'Curves & Polygons',
    dimensionsText: 'Chord Length C = 5.0 m · Max Thickness = 12%',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx + 80, cy);
      ctx.bezierCurveTo(cx + 30, cy - 35, cx - 60, cy - 40, cx - 75, cy);
      ctx.bezierCurveTo(cx - 60, cy + 40, cx + 30, cy + 35, cx + 80, cy);
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Chord C = 5.0 m', cx - 40, cy + 4);
    },
  },
  {
    id: 'trapezoid_long',
    name: 'Trapezoidal Lamina',
    sectionType: 'Longitudinal Section',
    category: 'Curves & Polygons',
    dimensionsText: 'Base a = 4.5 m · Top b = 2.5 m · Height h = 3.0 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 40, cy - 45);
      ctx.lineTo(cx + 40, cy - 45);
      ctx.lineTo(cx + 70, cy + 45);
      ctx.lineTo(cx - 70, cy + 45);
      ctx.closePath();
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Top 2.5m / Base 4.5m', cx - 60, cy + 4);
    },
  },
  {
    id: 'cross_trans',
    name: 'Cruciform Cross Lamina',
    sectionType: 'Transverse Section',
    category: 'Curves & Polygons',
    dimensionsText: 'Span = 4.0 m · Arm Width = 1.2 m',
    draw: (ctx, w, h, col) => {
      const cx = w / 2, cy = h / 2;
      const arm = 65, wHalf = 20;
      ctx.beginPath();
      ctx.moveTo(cx - wHalf, cy - arm);
      ctx.lineTo(cx + wHalf, cy - arm);
      ctx.lineTo(cx + wHalf, cy - wHalf);
      ctx.lineTo(cx + arm, cy - wHalf);
      ctx.lineTo(cx + arm, cy + wHalf);
      ctx.lineTo(cx + wHalf, cy + wHalf);
      ctx.lineTo(cx + wHalf, cy + arm);
      ctx.lineTo(cx - wHalf, cy + arm);
      ctx.lineTo(cx - wHalf, cy + wHalf);
      ctx.lineTo(cx - arm, cy + wHalf);
      ctx.lineTo(cx - arm, cy - wHalf);
      ctx.lineTo(cx - wHalf, cy - wHalf);
      ctx.closePath();
      ctx.fillStyle = `${col}33`;
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fde047';
      ctx.font = '10px monospace';
      ctx.fillText('Span = 4.0 m', cx - 35, cy + 4);
    },
  },
];

export const MotionVisualizer3D: React.FC = () => {
  const { dbUser } = useAuth();
  const visualEffectsOn = dbUser?.eliteVisualEffects !== false;

  const mountRef = useRef<HTMLDivElement | null>(null);
  const whiteboardCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Requirement: Do not allow drag to rotate by default and allow only when drag to rotate checkbox is checked
  const [dragRotateEnabled, setDragRotateEnabled] = useState<boolean>(false);

  // Requirement: Time in motion controllable by scaling with actual time (1x default, 0.0001x to 10000x)
  const [timeScale, setTimeScale] = useState<number>(1.0);
  const [simRunning, setSimRunning] = useState<boolean>(true);
  const [simTime, setSimTime] = useState<number>(0);

  // 3D Navigation & Coordinate Transformations State
  const [zoomLevel, setZoomLevel] = useState<number>(1.0);
  const [panX, setPanX] = useState<number>(0);
  const [panY, setPanY] = useState<number>(0);
  const [panZ, setPanZ] = useState<number>(0);
  const [rotX, setRotX] = useState<number>(0);
  const [rotY, setRotY] = useState<number>(0);
  const [rotZ, setRotZ] = useState<number>(0);

  // Arbitrary fixed line rotation
  const [arbitraryLineAngle, setArbitraryLineAngle] = useState<number>(0);
  const [lineDirX, setLineDirX] = useState<number>(1);
  const [lineDirY, setLineDirY] = useState<number>(1);
  const [lineDirZ, setLineDirZ] = useState<number>(0);

  // Translucent slice plane state
  const [slicePlane, setSlicePlane] = useState<SlicePlaneType>('xy');
  const [sliceOffset, setSliceOffset] = useState<number>(0);

  // Stationary 3D Printed Layers Stack
  const [printedSlices, setPrintedSlices] = useState<StationarySliceLayer[]>([]);

  // 30 Geometric Shapes on 2D Lamina
  const [selectedShape30Id, setSelectedShape30Id] = useState<string>('cyl_trans');

  // Multiple Reference Frames
  const [activeFrameId, setActiveFrameId] = useState<string>('s0');
  const activeFrame = REFERENCE_FRAMES_PRESETS.find((f) => f.id === activeFrameId) || REFERENCE_FRAMES_PRESETS[0];

  // 3D Shapes & Representations
  const [active3DShape, setActive3DShape] = useState<Shape3DType>('cylinder');
  const [coordRep, setCoordRep] = useState<MotionCoordRep>('cartesian');

  // Main UI Tab
  const [activeTab, setActiveTab] = useState<'whiteboard' | 'printer' | 'frames' | 'codeblocks' | 'coordinates'>('whiteboard');

  // Whiteboard drawing tools
  const [penColor, setPenColor] = useState<string>('#38bdf8');
  const [penSize, setPenSize] = useState<number>(4);
  const [isErasing, setIsErasing] = useState<boolean>(false);
  const isDrawingRef = useRef<boolean>(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  // Code block text state for interactive editing & execution
  const [codeBlockScript, setCodeBlockScript] = useState<string>(() =>
    JSON.stringify(
      {
        simulation: {
          timeScale: 1.0,
          gravity: [0, -9.81, 0],
          frameAcceleration: [0.0, 0.0, 0.0],
        },
        referenceFrames: [
          { id: 'S0', name: 'Inertial Lab Frame', origin: [0, 0, 0], velocity: [0, 0, 0] },
          { id: 'S1', name: 'Moving Train Frame', origin: [2, 0, 0], velocity: [2, 0, 0] },
        ],
        objects: [
          {
            id: 'particle_bob',
            shape: 'sphere',
            dimensions: { radius: 0.38 },
            effects: { color: '#22d3ee', shine: 0.85, metalness: 0.6 },
            initialVelocity: [8.5, 8.5, 4.25],
          },
          {
            id: 'structural_body',
            shape: 'cylinder',
            dimensions: { radius: 1.5, height: 4.0 },
            effects: { color: '#38bdf8', shine: 0.9, opacity: 0.8 },
            positionWrtOrigin: [4, 3, 4],
          },
        ],
      },
      null,
      2
    )
  );
  const [codeExecStatus, setCodeExecStatus] = useState<string | null>(null);

  // Three.js internal references
  const sliceTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const stationarySlicesGroupRef = useRef<THREE.Group | null>(null);

  const stateRef = useRef({
    zoomLevel: 1.0,
    panX: 0,
    panY: 0,
    panZ: 0,
    rotX: 0,
    rotY: 0,
    rotZ: 0,
    arbitraryLineAngle: 0,
    lineDirX: 1,
    lineDirY: 1,
    lineDirZ: 0,
    slicePlane: 'xy' as SlicePlaneType,
    sliceOffset: 0,
    active3DShape: 'cylinder' as Shape3DType,
    simRunning: true,
    timeScale: 1.0,
    dragRotateEnabled: false,
    activeFrameId: 's0',
  });

  // Sync stateRef
  useEffect(() => {
    stateRef.current = {
      zoomLevel,
      panX,
      panY,
      panZ,
      rotX,
      rotY,
      rotZ,
      arbitraryLineAngle,
      lineDirX,
      lineDirY,
      lineDirZ,
      slicePlane,
      sliceOffset,
      active3DShape,
      simRunning,
      timeScale,
      dragRotateEnabled,
      activeFrameId,
    };
    if (controlsRef.current) {
      controlsRef.current.enableRotate = dragRotateEnabled;
    }
  }, [
    zoomLevel,
    panX,
    panY,
    panZ,
    rotX,
    rotY,
    rotZ,
    arbitraryLineAngle,
    lineDirX,
    lineDirY,
    lineDirZ,
    slicePlane,
    sliceOffset,
    active3DShape,
    simRunning,
    timeScale,
    dragRotateEnabled,
    activeFrameId,
  ]);

  // Motion physics calculations
  const g = 9.81;
  const v0 = 12;
  const thetaRad = Math.PI / 4;
  const phiRad = Math.PI / 6;
  const vx = v0 * Math.cos(thetaRad) * Math.cos(phiRad);
  const vy = v0 * Math.sin(thetaRad);
  const vz = v0 * Math.cos(thetaRad) * Math.sin(phiRad);

  const curT = simTime % 2.5;
  const posX = vx * curT;
  const posY = Math.max(0, vy * curT - 0.5 * g * curT * curT);
  const posZ = vz * curT;
  const velX = vx;
  const velY = vy - g * curT;
  const velZ = vz;
  const speed = Math.sqrt(velX * velX + velY * velY + velZ * velZ);

  // Position relative to active reference frame
  const frameOriginX = activeFrame.origin[0] + activeFrame.velocity[0] * curT + 0.5 * activeFrame.acceleration[0] * curT * curT;
  const frameOriginY = activeFrame.origin[1] + activeFrame.velocity[1] * curT + 0.5 * activeFrame.acceleration[1] * curT * curT;
  const frameOriginZ = activeFrame.origin[2] + activeFrame.velocity[2] * curT + 0.5 * activeFrame.acceleration[2] * curT * curT;

  const relX = posX - frameOriginX;
  const relY = posY - frameOriginY;
  const relZ = posZ - frameOriginZ;
  const relSpeed = Math.sqrt(
    Math.pow(velX - activeFrame.velocity[0] - activeFrame.acceleration[0] * curT, 2) +
    Math.pow(velY - activeFrame.velocity[1] - activeFrame.acceleration[1] * curT, 2) +
    Math.pow(velZ - activeFrame.velocity[2] - activeFrame.acceleration[2] * curT, 2)
  );

  // Polar coordinates
  const polarR = Math.sqrt(posX * posX + posZ * posZ);
  const polarTheta = (Math.atan2(posZ, posX) * 180) / Math.PI;

  // Repaint Whiteboard with chosen cross-section
  const imprintCrossSectionOnCanvas = (shapeId: string) => {
    const shape = GEOMETRIC_SHAPES_30.find((s) => s.id === shapeId);
    if (!shape) return;
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#09101f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Grid
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 30) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 30) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Title & Section Tag
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 12px monospace';
    ctx.fillText(`${shape.name.toUpperCase()} · ${shape.sectionType.toUpperCase()}`, 12, 22);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(shape.dimensionsText, 12, 38);

    // Call shape drawing function
    shape.draw(ctx, canvas.width, canvas.height + 15, penColor);

    if (sliceTextureRef.current) {
      sliceTextureRef.current.needsUpdate = true;
    }
  };

  // Initial draw
  useEffect(() => {
    imprintCrossSectionOnCanvas('cyl_trans');
  }, []);

  // Bake/Print current slice into stationary 3D printed layer
  const handleBakeSliceLayer = () => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL('image/png');
    const shapeObj = GEOMETRIC_SHAPES_30.find((s) => s.id === selectedShape30Id);
    const newLayer: StationarySliceLayer = {
      id: `slice_${Date.now()}`,
      plane: slicePlane,
      offset: sliceOffset,
      label: `Layer #${printedSlices.length + 1} (${shapeObj?.name || 'Custom'}) @ ${sliceOffset.toFixed(1)}m`,
      dataUrl,
    };

    setPrintedSlices((prev) => [...prev, newLayer]);

    // Instantiate in Three.js stationary slices group
    const group = stationarySlicesGroupRef.current;
    if (group) {
      const img = new Image();
      img.src = dataUrl;
      img.onload = () => {
        const tex = new THREE.Texture(img);
        tex.needsUpdate = true;
        const mat = new THREE.MeshStandardMaterial({
          map: tex,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        });
        const geo = new THREE.PlaneGeometry(12, 12);
        const mesh = new THREE.Mesh(geo, mat);

        if (slicePlane === 'xy') {
          mesh.position.set(0, 6, sliceOffset);
        } else if (slicePlane === 'yz') {
          mesh.position.set(sliceOffset, 6, 0);
          mesh.rotation.y = Math.PI / 2;
        } else {
          mesh.position.set(0, sliceOffset, 0);
          mesh.rotation.x = Math.PI / 2;
        }
        mesh.name = newLayer.id;
        group.add(mesh);
      };
    }

    // Auto-advance offset like a 3D printer
    setSliceOffset((prev) => +(prev + 1.0).toFixed(1));
  };

  const handleClearStationarySlices = () => {
    setPrintedSlices([]);
    const group = stationarySlicesGroupRef.current;
    if (group) {
      while (group.children.length > 0) {
        const obj = group.children[0];
        group.remove(obj);
      }
    }
  };

  // Three.js Mount Setup (runs once)
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 540;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x09101f);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 200);
    camera.position.set(16, 12, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(0, 3, 0);
    // Requirement: Do not allow drag to rotate by default
    controls.enableRotate = false;
    controlsRef.current = controls;

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 1.2);
    scene.add(hemiLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 2.0);
    dirLight.position.set(12, 20, 14);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Coordinate Group
    const coordGroup = new THREE.Group();
    scene.add(coordGroup);

    // Stationary Slices Group (3D printer stacked layers)
    const stationaryGroup = new THREE.Group();
    stationarySlicesGroupRef.current = stationaryGroup;
    coordGroup.add(stationaryGroup);

    // 1. Transparent Wireframe X-Z Ground Grid
    const gridHelper = new THREE.GridHelper(24, 24, 0x38bdf8, 0x334155);
    gridHelper.position.y = 0;
    const gridMat = gridHelper.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.35;
    coordGroup.add(gridHelper);

    // 2. Axes Helper
    const axesHelper = new THREE.AxesHelper(14);
    coordGroup.add(axesHelper);

    // Axis Arrows
    const createAxisCone = (color: number, pos: [number, number, number], rot: [number, number, number]) => {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.25, 0.8, 16),
        new THREE.MeshBasicMaterial({ color })
      );
      cone.position.set(...pos);
      cone.rotation.set(...rot);
      coordGroup.add(cone);
    };
    createAxisCone(0xef4444, [14, 0, 0], [0, 0, -Math.PI / 2]); // +X
    createAxisCone(0x22c55e, [0, 14, 0], [0, 0, 0]); // +Y
    createAxisCone(0x3b82f6, [0, 0, 14], [Math.PI / 2, 0, 0]); // +Z

    // 3. Transparent Origin (0,0,0) - NOT SOLID
    const originSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 24, 24),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x0284c7,
        emissiveIntensity: 0.6,
        transparent: true,
        opacity: 0.45,
        roughness: 0.1,
        metalness: 0.8,
      })
    );
    originSphere.position.set(0, 0, 0);
    coordGroup.add(originSphere);

    // Glowing origin rings
    const ringGeo = new THREE.RingGeometry(0.45, 0.55, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const ringX = new THREE.Mesh(ringGeo, ringMat);
    ringX.rotation.y = Math.PI / 2;
    coordGroup.add(ringX);

    const ringY = new THREE.Mesh(ringGeo, ringMat);
    ringY.rotation.x = Math.PI / 2;
    coordGroup.add(ringY);

    // 4. Fixed Rotation Line Mesh
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-14, -14, 0),
      new THREE.Vector3(14, 14, 0),
    ]);
    const lineMat = new THREE.LineDashedMaterial({
      color: 0xf59e0b,
      dashSize: 0.6,
      gapSize: 0.3,
      transparent: true,
      opacity: 0.85,
    });
    const fixedLine = new THREE.Line(lineGeo, lineMat);
    fixedLine.computeLineDistances();
    coordGroup.add(fixedLine);

    // 5. Active Translucent Slice Plane Mesh
    const wbCanvas = whiteboardCanvasRef.current || document.createElement('canvas');
    const sliceTex = new THREE.CanvasTexture(wbCanvas);
    sliceTex.colorSpace = THREE.SRGBColorSpace;
    sliceTextureRef.current = sliceTex;

    const sliceGeo = new THREE.PlaneGeometry(12, 12);
    const sliceMat = new THREE.MeshStandardMaterial({
      map: sliceTex,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      roughness: 0.25,
      metalness: 0.15,
    });
    const activeSliceMesh = new THREE.Mesh(sliceGeo, sliceMat);
    activeSliceMesh.position.set(0, 6, 0);
    coordGroup.add(activeSliceMesh);

    // 6. 3D Shape Mesh
    const shapeGeo = new THREE.CylinderGeometry(1.5, 1.5, 3.5, 24);
    const shapeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.25,
      metalness: 0.55,
      transparent: true,
      opacity: 0.8,
    });
    const shapeMesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial> =
      new THREE.Mesh(shapeGeo, shapeMat);
    shapeMesh.position.set(4, 3, 4);
    coordGroup.add(shapeMesh);

    // 7. Motion Particle & Dynamic Vector Arrows
    const particle = new THREE.Mesh(
      new THREE.SphereGeometry(0.36, 20, 20),
      new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0ea5e9, emissiveIntensity: 0.9 })
    );
    coordGroup.add(particle);

    const arrowR = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 0), 1, 0x22d3ee);
    const arrowV = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 0), 1, 0xf59e0b);
    const arrowA = new THREE.ArrowHelper(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 0), 1, 0xf43f5e);
    coordGroup.add(arrowR);
    coordGroup.add(arrowV);
    coordGroup.add(arrowA);

    // Reference Frame Triad Visualizer
    const frameTriad = new THREE.Group();
    const frameAxes = new THREE.AxesHelper(6);
    frameTriad.add(frameAxes);
    coordGroup.add(frameTriad);

    // Animation Loop
    let animId = 0;
    const clock = new THREE.Clock();
    let currentShapeType: Shape3DType = 'cylinder';

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const st = stateRef.current;

      // Update camera zoom
      camera.zoom = st.zoomLevel;
      camera.updateProjectionMatrix();

      // Update Coordinate Transformations
      coordGroup.position.set(st.panX, st.panY, st.panZ);

      const euler = new THREE.Euler(
        THREE.MathUtils.degToRad(st.rotX),
        THREE.MathUtils.degToRad(st.rotY),
        THREE.MathUtils.degToRad(st.rotZ),
        'XYZ'
      );
      const qMaster = new THREE.Quaternion().setFromEuler(euler);

      const lineVec = new THREE.Vector3(st.lineDirX, st.lineDirY, st.lineDirZ).normalize();
      if (lineVec.lengthSq() > 0.001) {
        const qLine = new THREE.Quaternion().setFromAxisAngle(
          lineVec,
          THREE.MathUtils.degToRad(st.arbitraryLineAngle)
        );
        qMaster.multiply(qLine);

        const p1 = lineVec.clone().multiplyScalar(-14);
        const p2 = lineVec.clone().multiplyScalar(14);
        lineGeo.setFromPoints([p1, p2]);
        fixedLine.computeLineDistances();
      }

      coordGroup.quaternion.copy(qMaster);

      // Update Active Slice Plane
      activeSliceMesh.rotation.set(0, 0, 0);
      if (st.slicePlane === 'xy') {
        activeSliceMesh.position.set(0, 6, st.sliceOffset);
      } else if (st.slicePlane === 'yz') {
        activeSliceMesh.position.set(st.sliceOffset, 6, 0);
        activeSliceMesh.rotation.y = Math.PI / 2;
      } else {
        activeSliceMesh.position.set(0, st.sliceOffset, 0);
        activeSliceMesh.rotation.x = Math.PI / 2;
      }

      // Update 3D Geometry
      if (currentShapeType !== st.active3DShape) {
        currentShapeType = st.active3DShape;
        shapeMesh.visible = st.active3DShape !== 'none';
        shapeMesh.geometry.dispose();
        if (st.active3DShape === 'cylinder') {
          shapeMesh.geometry = new THREE.CylinderGeometry(1.5, 1.5, 3.5, 24);
        } else if (st.active3DShape === 'sphere') {
          shapeMesh.geometry = new THREE.SphereGeometry(1.8, 24, 20);
        } else if (st.active3DShape === 'cone') {
          shapeMesh.geometry = new THREE.ConeGeometry(1.8, 3.5, 24);
        } else if (st.active3DShape === 'torus') {
          shapeMesh.geometry = new THREE.TorusGeometry(1.8, 0.6, 16, 32);
        } else {
          shapeMesh.geometry = new THREE.BoxGeometry(3, 3, 3);
        }
      }

      // Update Motion with Time Scaling
      if (st.simRunning) {
        // Scaled delta time
        const scaledDelta = delta * st.timeScale;
        setSimTime((t) => t + scaledDelta);

        const tNow = (clock.getElapsedTime() * 0.8 * st.timeScale) % 2.5;
        const curPx = vx * tNow;
        const curPy = Math.max(0, vy * tNow - 0.5 * g * tNow * tNow);
        const curPz = vz * tNow;
        const curVx = vx;
        const curVy = vy - g * tNow;
        const curVz = vz;

        particle.position.set(curPx, curPy, curPz);

        const posV = new THREE.Vector3(curPx, curPy, curPz);
        const velV = new THREE.Vector3(curVx, curVy, curVz);
        const accV = new THREE.Vector3(0, -g, 0);

        arrowR.position.set(0, 0, 0);
        if (posV.lengthSq() > 0.01) {
          arrowR.setDirection(posV.clone().normalize());
          arrowR.setLength(posV.length(), 0.6, 0.3);
        }

        arrowV.position.copy(posV);
        if (velV.lengthSq() > 0.01) {
          arrowV.setDirection(velV.clone().normalize());
          arrowV.setLength(Math.min(4, velV.length() * 0.3), 0.5, 0.25);
        }

        arrowA.position.copy(posV);
        arrowA.setDirection(accV.clone().normalize());
        arrowA.setLength(2.2, 0.5, 0.25);
      }

      if (sliceTextureRef.current) {
        sliceTextureRef.current.needsUpdate = true;
      }

      controls.update();
      renderer.render(scene, camera);
    };

    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
    };
  }, []);

  // 2D Whiteboard Drawing Handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    isDrawingRef.current = true;
    lastPointRef.current = { x, y };
  };

  const drawOnWhiteboard = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = whiteboardCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(lastPointRef.current?.x || x, lastPointRef.current?.y || y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = isErasing ? '#09101f' : penColor;
    ctx.lineWidth = isErasing ? 24 : penSize;
    ctx.lineCap = 'round';
    ctx.stroke();

    lastPointRef.current = { x, y };

    if (sliceTextureRef.current) {
      sliceTextureRef.current.needsUpdate = true;
    }
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    lastPointRef.current = null;
    if (sliceTextureRef.current) {
      sliceTextureRef.current.needsUpdate = true;
    }
  };

  // Run Code Block execution
  const handleExecuteCodeBlock = () => {
    try {
      const parsed = JSON.parse(codeBlockScript);
      if (parsed.simulation?.timeScale !== undefined) {
        setTimeScale(Number(parsed.simulation.timeScale));
      }
      if (parsed.objects && Array.isArray(parsed.objects)) {
        const primary = parsed.objects[0];
        if (primary?.shape && ['box', 'cylinder', 'sphere', 'cone', 'torus'].includes(primary.shape)) {
          setActive3DShape(primary.shape);
        }
      }
      setCodeExecStatus('Code Block executed successfully! 3D parameters and physics updated.');
      setTimeout(() => setCodeExecStatus(null), 3500);
    } catch (err) {
      setCodeExecStatus(`Syntax Error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div
        className={`rounded-2xl border p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white dark:bg-slate-900 ${
          visualEffectsOn ? 'asan-elite-card border-blue-600 dark:border-cyan-400' : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="asan-elite-badge rounded px-2 py-0.5 text-[10px] font-bold">3D MOTION &amp; 3D PRINTER SLICES</span>
            <span className="text-xs text-blue-700 dark:text-cyan-400 font-semibold">30 Imprinted Shapes · Time Scaling · Multiple Reference Frames</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            3D Motion Visualizer &amp; 3D Printer Slice Studio
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Paint slice by slice with 30 geometric shapes imprinted with defined dimensions. Freeze slices into stationary 3D printed layers, simulate in multiple reference frames, scale time from micro to cosmic speeds, and drive kinematics via code blocks.
          </p>
        </div>

        {/* Top Control Bar: Drag-Rotate Lock Checkbox & Zoom */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Requirement: Do not allow drag to rotate by default and allow only when drag to rotate checkbox is checked */}
          <label className="flex items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-3 py-1.5 text-xs font-semibold cursor-pointer shadow-xs">
            <input
              type="checkbox"
              checked={dragRotateEnabled}
              onChange={(e) => setDragRotateEnabled(e.target.checked)}
              className="h-4 w-4 rounded accent-blue-600 cursor-pointer"
            />
            <span className="flex items-center gap-1 text-slate-800 dark:text-slate-200">
              {dragRotateEnabled ? <Unlock className="h-3.5 w-3.5 text-emerald-500" /> : <Lock className="h-3.5 w-3.5 text-amber-500" />}
              Drag to Rotate 3D View
            </span>
          </label>

          {/* Single Zoom Option */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs shadow-xs">
            <ZoomOut
              className="h-4 w-4 text-cyan-500 cursor-pointer"
              onClick={() => setZoomLevel((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))}
            />
            <input
              type="range"
              min={0.4}
              max={2.5}
              step={0.05}
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="w-20 accent-blue-600"
              title="Zoom Control"
            />
            <ZoomIn
              className="h-4 w-4 text-cyan-500 cursor-pointer"
              onClick={() => setZoomLevel((z) => Math.min(2.5, +(z + 0.2).toFixed(2)))}
            />
            <span className="font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200 w-8 text-right">
              {zoomLevel.toFixed(1)}x
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              setZoomLevel(1.0);
              setPanX(0);
              setPanY(0);
              setPanZ(0);
              setRotX(0);
              setRotY(0);
              setRotZ(0);
              setArbitraryLineAngle(0);
              setTimeScale(1.0);
            }}
            className="inline-flex items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      {/* Main Viewport & Studio Tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: 3D Viewport & Time Scale Controls */}
        <div className="lg:col-span-7 space-y-4">
          <div className="relative h-[480px] sm:h-[540px] w-full rounded-2xl border border-slate-200 dark:border-cyan-500/40 bg-[#09101f] overflow-hidden shadow-2xl">
            <div ref={mountRef} className="h-full w-full" />

            {/* Readout Overlay */}
            <div className="absolute top-4 left-4 z-10 rounded-xl border border-slate-700/80 bg-slate-950/90 p-3 text-xs space-y-1 font-mono text-slate-200 pointer-events-none shadow-lg max-w-[280px]">
              <div className="text-cyan-400 font-bold flex items-center gap-1.5">
                <Axis3D className="h-4 w-4" />
                Origin (0,0,0) Transparent Halo
              </div>
              <div className="text-[11px] text-slate-300">
                Frame: <span className="font-bold text-amber-300">{activeFrame.name.split(':')[0]}</span>
              </div>
              <div className="text-[11px] text-emerald-400">
                Printed Slices: {printedSlices.length} Stationary Layers
              </div>
              <div className="text-[11px] text-cyan-300">
                Scale: {timeScale}x · 1s real = {timeScale}s sim
              </div>
            </div>

            {/* Play/Pause & Speed Controls on Bottom */}
            <div className="absolute bottom-4 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-auto">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSimRunning(!simRunning)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-2 text-xs font-bold shadow-lg"
                >
                  {simRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  {simRunning ? 'Pause' : 'Play'}
                </button>

                <button
                  type="button"
                  onClick={handleBakeSliceLayer}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-2 text-xs font-bold shadow-lg"
                  title="Freeze current 2D plane as a stationary layer on 3D surface"
                >
                  <Printer className="h-4 w-4" />
                  Bake / Print Layer to 3D
                </button>
              </div>

              {/* Time Scale Quick Bar */}
              <div className="flex items-center gap-1.5 bg-slate-900/90 border border-slate-700 p-1 rounded-xl text-xs font-mono">
                <Clock className="h-3.5 w-3.5 text-cyan-400 ml-1.5" />
                <span className="text-[11px] text-slate-400 mr-1">Time Speed:</span>
                {[0.01, 0.1, 1, 10, 100].map((sc) => (
                  <button
                    key={sc}
                    type="button"
                    onClick={() => setTimeScale(sc)}
                    className={`px-2 py-0.5 rounded-md font-bold text-[10px] transition-colors ${
                      timeScale === sc ? 'bg-cyan-500 text-slate-950 shadow-xs' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {sc >= 1 ? `${sc}x` : `${sc}x`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Time Controller & Scaled Physics Bar */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                <FastForward className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
                Time Controller: Micro-Second to Cosmic Scales
              </span>
              <span className="text-xs font-mono font-bold text-cyan-600 dark:text-cyan-400">
                1s Actual = {timeScale >= 1 ? `${timeScale}s` : `${timeScale * 1000}ms`} Sim Time
              </span>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                <span>0.0001x (Femto/Slow-Mo)</span>
                <span>1.0x (Actual Real-Time)</span>
                <span>10000x (Cosmic / Long Time)</span>
              </div>
              <input
                type="range"
                min={-3}
                max={4}
                step={0.2}
                value={Math.log10(timeScale)}
                onChange={(e) => setTimeScale(+(Math.pow(10, Number(e.target.value))).toFixed(4))}
                className="w-full accent-blue-600"
              />
            </div>

            {/* Coordinate Rep Selector */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Compass className="h-4 w-4 text-emerald-500" />
                Kinematics: Absolute vs Frame {activeFrame.name.split(':')[0]}
              </div>

              <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs">
                {(['cartesian', 'polar', 'vector'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setCoordRep(mode)}
                    className={`px-2.5 py-1 rounded-md font-semibold capitalize transition-colors ${
                      coordRep === mode ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Readouts */}
            {coordRep === 'cartesian' && (
              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="rounded-xl border border-blue-500/30 bg-blue-50/20 dark:bg-blue-950/20 p-2.5 space-y-1">
                  <div className="text-[10px] text-blue-600 dark:text-blue-400 font-bold uppercase">Wrt Origin S₀ (Absolute)</div>
                  <div>x_abs: {posX.toFixed(2)} m · y_abs: {posY.toFixed(2)} m · z_abs: {posZ.toFixed(2)} m</div>
                  <div className="text-[11px] text-slate-400">|v_abs| = {speed.toFixed(2)} m/s</div>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/20 p-2.5 space-y-1">
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 font-bold uppercase">Wrt Frame {activeFrame.name.split(':')[0]}</div>
                  <div>x&apos;: {relX.toFixed(2)} m · y&apos;: {relY.toFixed(2)} m · z&apos;: {relZ.toFixed(2)} m</div>
                  <div className="text-[11px] text-slate-400">|v_rel| = {relSpeed.toFixed(2)} m/s</div>
                </div>
              </div>
            )}

            {coordRep === 'vector' && (
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-50/20 dark:bg-indigo-950/20 p-3 font-mono text-xs text-indigo-900 dark:text-indigo-200 space-y-1">
                <div>r⃗_abs(t) = ({posX.toFixed(2)})î + ({posY.toFixed(2)})ĵ + ({posZ.toFixed(2)})k̂  [m] (Cyan Arrow)</div>
                <div>r⃗&apos;(t) = ({relX.toFixed(2)})î + ({relY.toFixed(2)})ĵ + ({relZ.toFixed(2)})k̂  [m] (Wrt Active Frame)</div>
                <div>v⃗_abs(t) = ({velX.toFixed(2)})î + ({velY.toFixed(2)})ĵ + ({velZ.toFixed(2)})k̂  [m/s] (|v| = {speed.toFixed(2)} m/s)</div>
                <div>a⃗(t) = (0.00)î + (-9.81)ĵ + (0.00)k̂  [m/s²] (Gravity Rose Arrow)</div>
              </div>
            )}

            {coordRep === 'polar' && (
              <div className="grid grid-cols-3 gap-2 font-mono text-xs text-center">
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-50/20 dark:bg-cyan-950/20 p-2.5">
                  <div className="text-[10px] text-slate-400">r(t) = √(x² + z²)</div>
                  <div className="font-bold text-sm text-cyan-700 dark:text-cyan-300">{polarR.toFixed(2)} m</div>
                </div>
                <div className="rounded-xl border border-amber-500/30 bg-amber-50/20 dark:bg-amber-950/20 p-2.5">
                  <div className="text-[10px] text-slate-400">θ(t) = atan2(z, x)</div>
                  <div className="font-bold text-sm text-amber-700 dark:text-amber-300">{polarTheta.toFixed(1)}°</div>
                </div>
                <div className="rounded-xl border border-purple-500/30 bg-purple-50/20 dark:bg-purple-950/20 p-2.5">
                  <div className="text-[10px] text-slate-400">Height y(t)</div>
                  <div className="font-bold text-sm text-purple-700 dark:text-purple-300">{posY.toFixed(2)} m</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Tabbed Studio (Whiteboard, 30 Shapes, 3D Printer Slices, Reference Frames, Code Blocks) */}
        <div className="lg:col-span-5 space-y-4">
          {/* Studio Navigation Tabs */}
          <div className="flex border-b border-slate-200 dark:border-slate-800 gap-1 pb-1 text-xs font-semibold overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('whiteboard')}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === 'whiteboard' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
              }`}
            >
              2D Lamina &amp; 30 Shapes
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('printer')}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === 'printer' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
              }`}
            >
              🖨️ 3D Printer Slices ({printedSlices.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('frames')}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === 'frames' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
              }`}
            >
              Frames of Reference
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('codeblocks')}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === 'codeblocks' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
              }`}
            >
              &lt;/&gt; Code Blocks
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('coordinates')}
              className={`px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${
                activeTab === 'coordinates' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100'
              }`}
            >
              Axes &amp; Angles
            </button>
          </div>

          {/* TAB 1: 2D WHITEBOARD & 30 SHAPES SELECTOR */}
          {activeTab === 'whiteboard' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <PenTool className="h-4 w-4 text-cyan-500" />
                    2D Lamina Slice Canvas &amp; 30 Shapes
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Directly imprint transverse or longitudinal sections with defined dimensions.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => imprintCrossSectionOnCanvas(selectedShape30Id)}
                  className="inline-flex items-center gap-1 text-[11px] text-cyan-600 hover:text-cyan-500 font-semibold"
                >
                  <RotateCcw className="h-3 w-3" />
                  Redraw
                </button>
              </div>

              {/* 30 Shapes Imprinter Picker */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-700 dark:text-slate-300">
                  Select Geometric Shape to Imprint:
                </label>
                <select
                  value={selectedShape30Id}
                  onChange={(e) => {
                    setSelectedShape30Id(e.target.value);
                    imprintCrossSectionOnCanvas(e.target.value);
                  }}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-semibold"
                >
                  {GEOMETRIC_SHAPES_30.map((sh, idx) => (
                    <option key={sh.id} value={sh.id}>
                      {idx + 1}. {sh.name} [{sh.sectionType}] — {sh.dimensionsText}
                    </option>
                  ))}
                </select>
              </div>

              {/* Whiteboard Drawing Canvas */}
              <div className="rounded-xl border border-slate-700 overflow-hidden bg-[#09101f] flex items-center justify-center">
                <canvas
                  ref={whiteboardCanvasRef}
                  width={380}
                  height={270}
                  onMouseDown={startDrawing}
                  onMouseMove={drawOnWhiteboard}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  className="cursor-crosshair block w-full touch-none"
                />
              </div>

              {/* Action Buttons: Bake to 3D Printer & Plane controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-slate-500">Plane:</span>
                  <select
                    value={slicePlane}
                    onChange={(e) => setSlicePlane(e.target.value as SlicePlaneType)}
                    className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-semibold"
                  >
                    <option value="xy">XY Plane</option>
                    <option value="yz">YZ Plane</option>
                    <option value="xz">XZ Plane</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleBakeSliceLayer}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 text-xs font-bold shadow-xs"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Bake Layer to 3D
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: 3D PRINTER SLICES (STATIONARY LAYERS) */}
          {activeTab === 'printer' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Printer className="h-4 w-4 text-amber-500" />
                    3D Printer Layer Stack (Stationary Slices)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Stationary slices frozen onto the 3D surface layer-by-layer.
                  </p>
                </div>
                {printedSlices.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearStationarySlices}
                    className="text-[11px] font-bold text-rose-500 hover:text-rose-600"
                  >
                    Clear Slices
                  </button>
                )}
              </div>

              {printedSlices.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-400 space-y-2">
                  <p>No stationary layers printed yet.</p>
                  <p className="text-[11px]">
                    Draw on the 2D Lamina canvas or choose an imprinted shape, then click <strong>&ldquo;Bake Layer to 3D&rdquo;</strong> to freeze it in place.
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {printedSlices.map((layer, idx) => (
                    <div
                      key={layer.id}
                      className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-6 w-6 rounded-md bg-amber-500/20 text-amber-600 dark:text-amber-400 font-mono font-bold flex items-center justify-center text-[10px]">
                          #{idx + 1}
                        </span>
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">{layer.label}</div>
                          <div className="text-[10px] font-mono text-slate-400">{layer.plane.toUpperCase()}-Plane @ Offset {layer.offset.toFixed(1)}m</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60">
                        Stationary
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: REFERENCE FRAMES */}
          {activeTab === 'frames' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Compass className="h-4 w-4 text-emerald-500" />
                Multiple Frames of Reference
              </h3>

              <div className="space-y-2">
                {REFERENCE_FRAMES_PRESETS.map((rf) => (
                  <button
                    key={rf.id}
                    type="button"
                    onClick={() => setActiveFrameId(rf.id)}
                    className={`w-full p-3 rounded-xl border text-left text-xs transition-all ${
                      activeFrameId === rf.id
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 font-bold shadow-xs'
                        : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-slate-900 dark:text-slate-100">{rf.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded uppercase font-mono" style={{ backgroundColor: `${rf.color}22`, color: rf.color }}>
                        {rf.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono mt-1">
                      Origin: ({rf.origin.join(', ')}) · Vel: ({rf.velocity.join(', ')}) m/s · Acc: ({rf.acceleration.join(', ')}) m/s²
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50/50 dark:bg-slate-950/40 text-[11px] space-y-1 text-slate-600 dark:text-slate-300">
                <div className="font-bold text-slate-800 dark:text-slate-200">Non-Inertial Fictitious Forces:</div>
                <div>• Inertial Force: F_inertial = -m·A_frame</div>
                <div>• Coriolis Force: F_coriolis = -2m·(ω × v_rel)</div>
                <div>• Centrifugal Force: F_centrifugal = -m·ω × (ω × r_rel)</div>
              </div>
            </div>
          )}

          {/* TAB 4: CODE BLOCKS SECTION */}
          {activeTab === 'codeblocks' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Code className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
                    3D Motion &amp; Object Creation Code Block
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Declarative script defining object dimensions, colors, shine, gravity, and frame acceleration.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(codeBlockScript);
                    setCodeExecStatus('Code copied to clipboard!');
                    setTimeout(() => setCodeExecStatus(null), 2500);
                  }}
                  className="inline-flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </button>
              </div>

              {codeExecStatus && (
                <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  {codeExecStatus}
                </div>
              )}

              {/* Code Editor Area */}
              <div className="rounded-xl border border-slate-700 bg-slate-950 p-2.5 font-mono text-xs">
                <textarea
                  value={codeBlockScript}
                  onChange={(e) => setCodeBlockScript(e.target.value)}
                  rows={13}
                  className="w-full bg-transparent text-cyan-300 outline-none resize-none font-mono text-xs leading-relaxed"
                  spellCheck={false}
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExecuteCodeBlock}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white p-2.5 font-bold text-xs shadow-md transition-colors"
                >
                  <Play className="h-3.5 w-3.5" />
                  Execute &amp; Run Code Block
                </button>
              </div>
            </div>
          )}

          {/* TAB 5: AXES & ROTATIONS */}
          {activeTab === 'coordinates' && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4 shadow-xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <RotateCw className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
                Rotate 3D Coordinate System
              </h3>

              <div className="space-y-3 text-xs">
                <label className="block space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-red-500">Pitch (Rotate X-Axis)</span>
                    <span className="font-mono">{rotX}°</span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={rotX}
                    onChange={(e) => setRotX(Number(e.target.value))}
                    className="w-full accent-red-500"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-emerald-500">Yaw (Rotate Y-Axis)</span>
                    <span className="font-mono">{rotY}°</span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={rotY}
                    onChange={(e) => setRotY(Number(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </label>

                <label className="block space-y-1">
                  <div className="flex justify-between font-semibold">
                    <span className="text-blue-500">Roll (Rotate Z-Axis)</span>
                    <span className="font-mono">{rotZ}°</span>
                  </div>
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    value={rotZ}
                    onChange={(e) => setRotZ(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </label>
              </div>

              {/* Translation step buttons */}
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Translate Along X, Y, Z Axes
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-red-500 font-bold">X-Axis ({panX})</span>
                    <div className="flex gap-1 w-full">
                      <button
                        type="button"
                        onClick={() => setPanX((x) => x - 1)}
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-1 font-bold text-xs hover:bg-slate-100"
                      >
                        -X
                      </button>
                      <button
                        type="button"
                        onClick={() => setPanX((x) => x + 1)}
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-1 font-bold text-xs hover:bg-slate-100"
                      >
                        +X
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-emerald-500 font-bold">Y-Axis ({panY})</span>
                    <div className="flex gap-1 w-full">
                      <button
                        type="button"
                        onClick={() => setPanY((y) => y - 1)}
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-1 font-bold text-xs hover:bg-slate-100"
                      >
                        -Y
                      </button>
                      <button
                        type="button"
                        onClick={() => setPanY((y) => y + 1)}
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-1 font-bold text-xs hover:bg-slate-100"
                      >
                        +Y
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col items-center gap-1">
                    <span className="text-[10px] text-blue-500 font-bold">Z-Axis ({panZ})</span>
                    <div className="flex gap-1 w-full">
                      <button
                        type="button"
                        onClick={() => setPanZ((z) => z - 1)}
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-1 font-bold text-xs hover:bg-slate-100"
                      >
                        -Z
                      </button>
                      <button
                        type="button"
                        onClick={() => setPanZ((z) => z + 1)}
                        className="flex-1 rounded-lg border border-slate-300 dark:border-slate-700 py-1 font-bold text-xs hover:bg-slate-100"
                      >
                        +Z
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
