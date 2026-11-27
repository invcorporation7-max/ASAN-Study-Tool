import React, { useState } from 'react';
import {
  AlertCircle,
  Beaker,
  Check,
  CheckCircle2,
  ChevronRight,
  Code,
  Copy,
  Droplet,
  Droplets,
  Eye,
  Flame,
  FlaskConical,
  Gauge,
  Info,
  Layers,
  Package,
  Pipette,
  Play,
  Plus,
  RefreshCcw,
  ShieldAlert,
  Sparkles,
  TestTube,
  Trash2,
  Wind,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export interface SaltItem {
  id: string;
  name: string;
  formula: string;
  category: string;
  type: 'salt_sachet' | 'salt_bottle' | 'acid_beaker' | 'base_beaker';
  label: string; // e.g. "C-10", "C-14", "NaCl"
  defaultColor: string;
  solubility: 'soluble' | 'sparingly' | 'insoluble';
}

export const KNOWN_SALTS: SaltItem[] = [
  { id: 'nacl', name: 'Sodium Chloride (Common Salt)', formula: 'NaCl', category: 'Neutral Salt', type: 'salt_bottle', label: 'NaCl', defaultColor: 'rgba(255, 255, 255, 0.9)', solubility: 'soluble' },
  { id: 'cuso4', name: 'Copper Sulfate Pentahydrate', formula: 'CuSO₄·5H₂O', category: 'Transition Metal Salt', type: 'salt_bottle', label: 'CuSO₄', defaultColor: 'rgba(37, 99, 235, 0.85)', solubility: 'soluble' },
  { id: 'feso4', name: 'Iron(II) Sulfate Heptahydrate', formula: 'FeSO₄·7H₂O', category: 'Transition Metal Salt', type: 'salt_bottle', label: 'FeSO₄', defaultColor: 'rgba(52, 211, 153, 0.75)', solubility: 'soluble' },
  { id: 'pbno32', name: 'Lead(II) Nitrate', formula: 'Pb(NO₃)₂', category: 'Heavy Metal Salt', type: 'salt_bottle', label: 'Pb(NO₃)₂', defaultColor: 'rgba(241, 245, 249, 0.95)', solubility: 'soluble' },
  { id: 'caco3', name: 'Calcium Carbonate', formula: 'CaCO₃', category: 'Insoluble Salt', type: 'salt_bottle', label: 'CaCO₃', defaultColor: 'rgba(248, 250, 252, 0.98)', solubility: 'insoluble' },
  { id: 'nh4cl', name: 'Ammonium Chloride', formula: 'NH₄Cl', category: 'Acidic Salt', type: 'salt_bottle', label: 'NH₄Cl', defaultColor: 'rgba(226, 232, 240, 0.9)', solubility: 'soluble' },
  { id: 'znso4', name: 'Zinc Sulfate', formula: 'ZnSO₄', category: 'Transition Metal Salt', type: 'salt_bottle', label: 'ZnSO₄', defaultColor: 'rgba(240, 249, 255, 0.85)', solubility: 'soluble' },
];

export const UNKNOWN_SALTS: SaltItem[] = [
  { id: 'c10', name: 'Unknown Salt C-10 (White Powder)', formula: 'C-10 (Salt Sachet)', category: 'Unknown Sachet', type: 'salt_sachet', label: 'C-10', defaultColor: 'rgba(203, 213, 225, 0.85)', solubility: 'soluble' },
  { id: 'c11', name: 'Unknown Salt C-11 (Blue Crystals)', formula: 'C-11 (Salt Sachet)', category: 'Unknown Sachet', type: 'salt_sachet', label: 'C-11', defaultColor: 'rgba(59, 130, 246, 0.8)', solubility: 'soluble' },
  { id: 'c12', name: 'Unknown Salt C-12 (Chalky Powder)', formula: 'C-12 (Salt Sachet)', category: 'Unknown Sachet', type: 'salt_sachet', label: 'C-12', defaultColor: 'rgba(248, 250, 252, 0.95)', solubility: 'insoluble' },
  { id: 'c13', name: 'Unknown Salt C-13 (Heavy Crystals)', formula: 'C-13 (Salt Sachet)', category: 'Unknown Sachet', type: 'salt_sachet', label: 'C-13', defaultColor: 'rgba(226, 232, 240, 0.9)', solubility: 'soluble' },
  { id: 'c14', name: 'Unknown Acid C-14 (Liquid in Beaker)', formula: 'C-14 (Acid in Beaker)', category: 'Unknown Acid', type: 'acid_beaker', label: 'C-14', defaultColor: 'rgba(255, 255, 255, 0.25)', solubility: 'soluble' },
  { id: 'c15', name: 'Unknown Base C-15 (Liquid in Beaker)', formula: 'C-15 (Base in Beaker)', category: 'Unknown Base', type: 'base_beaker', label: 'C-15', defaultColor: 'rgba(255, 255, 255, 0.25)', solubility: 'soluble' },
];

export const STUDENT_REAGENTS = [
  { id: 'dil_hcl', name: 'Dilute Hydrochloric Acid', formula: 'Dil. HCl', desc: 'Tests for carbonates, sulfides, group I cations' },
  { id: 'dil_h2so4', name: 'Dilute Sulfuric Acid', formula: 'Dil. H₂SO₄', desc: 'Acid medium, sulfate group test' },
  { id: 'acetic_acid', name: 'Acetic Acid', formula: 'CH₃COOH', desc: 'Weak organic acid for buffer reactions' },
  { id: 'iodine', name: 'Iodine Solution', formula: 'I₂ in KI', desc: 'Forms golden yellow PbI₂ precipitate' },
  { id: 'lime_water', name: 'Lime Water', formula: 'Ca(OH)₂', desc: 'Turns milky with evolved CO₂ gas' },
  { id: 'ethanol', name: 'Ethanol', formula: 'C₂H₅OH', desc: 'Organic solvent and esterification agent' },
];

export const STRONG_REAGENTS = [
  { id: 'conc_h2so4', name: 'Concentrated Sulfuric Acid', formula: 'Conc. H₂SO₄ (98%)', hazard: 'Dehydrating & Corrosive' },
  { id: 'conc_hcl', name: 'Concentrated Hydrochloric Acid', formula: 'Conc. HCl (37%)', hazard: 'Fuming & Pungent' },
  { id: 'conc_naoh', name: 'Sodium Hydroxide', formula: 'NaOH (40%)', hazard: 'Strong Alkali / Caustic' },
  { id: 'nh4oh', name: 'Ammonium Hydroxide', formula: 'NH₄OH (conc)', hazard: 'Strong Ammonia Fumes' },
  { id: 'bacl2', name: 'Barium Chloride Solution', formula: 'BaCl₂ (5%)', hazard: 'Forms BaSO₄ White Ppt' },
  { id: 'agno3', name: 'Silver Nitrate Solution', formula: 'AgNO₃ (aq)', hazard: 'Forms AgCl Curdy White Ppt' },
  { id: 'conc_hno3', name: 'Concentrated Nitric Acid', formula: 'Conc. HNO₃', hazard: 'Strong Oxidizing Acid' },
];

export const INDICATORS = [
  { id: 'phenolphthalein', name: 'Phenolphthalein', color: 'rgba(244, 114, 182, 0.8)', hint: 'Colorless in Acid · Vivid Pink in Alkali' },
  { id: 'methyl_orange', name: 'Methyl Orange', color: 'rgba(249, 115, 22, 0.85)', hint: 'Red in Acid (pH < 3.1) · Yellow in Alkali' },
  { id: 'blue_litmus', name: 'Blue Litmus Soln', color: 'rgba(37, 99, 235, 0.85)', hint: 'Turns Red in Acid · Stays Blue in Alkali' },
  { id: 'red_litmus', name: 'Red Litmus Soln', color: 'rgba(239, 68, 68, 0.85)', hint: 'Turns Blue in Alkali · Stays Red in Acid' },
];

export interface DefinedExperiment {
  id: string;
  title: string;
  aim: string;
  requiredApparatus: string[];
  suggestedSalt: string;
  suggestedReagent: string;
  expectedColor: string;
  precipitateSpec: string;
  gasSpec: string;
  principle: string;
}

export const PREDEFINED_EXPERIMENTS: DefinedExperiment[] = [
  {
    id: 'exp_carbonate',
    title: '1. Identification of Carbonate Radical (CO₃²⁻)',
    aim: 'Test solid sample for carbonate using dilute acid and confirm evolved gas with lime water.',
    requiredApparatus: ['Test Tube', 'Test Tube Holder', 'Pipette', 'Lime Water Beaker'],
    suggestedSalt: 'caco3',
    suggestedReagent: 'dil_hcl',
    expectedColor: 'rgba(241, 245, 249, 0.5)',
    precipitateSpec: 'White CaCO₃ suspended, then dissolves with effervescence',
    gasSpec: 'Brisk effervescence of CO₂ gas (turns lime water milky)',
    principle: 'CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂↑. CO₂ + Ca(OH)₂ → CaCO₃↓ (milky) + H₂O.',
  },
  {
    id: 'exp_sulfate',
    title: '2. Confirmation of Sulfate Radical (SO₄²⁻)',
    aim: 'Form a heavy white insoluble precipitate of barium sulfate upon adding BaCl₂.',
    requiredApparatus: ['Test Tube', 'Wash Bottle', 'Dropping Pipette'],
    suggestedSalt: 'cuso4',
    suggestedReagent: 'bacl2',
    expectedColor: 'rgba(56, 189, 248, 0.4)',
    precipitateSpec: 'Dense White Precipitate of BaSO₄ (insoluble in dil. HCl)',
    gasSpec: 'None',
    principle: 'SO₄²⁻ + Ba²⁺ → BaSO₄↓ (Dense white precipitate, insoluble in concentrated mineral acids).',
  },
  {
    id: 'exp_chloride',
    title: '3. Detection of Chloride Radical (Cl⁻)',
    aim: 'Reaction of chloride solution with silver nitrate yielding curdy white AgCl.',
    requiredApparatus: ['Test Tube', 'Wash Bottle', 'Dropping Pipette'],
    suggestedSalt: 'nacl',
    suggestedReagent: 'agno3',
    expectedColor: 'rgba(248, 250, 252, 0.6)',
    precipitateSpec: 'Curdy White Precipitate of AgCl (soluble in excess NH₄OH)',
    gasSpec: 'None',
    principle: 'Cl⁻ + Ag⁺ → AgCl↓ (Curdy white precipitate). AgCl + 2NH₄OH → [Ag(NH₃)₂]Cl + 2H₂O (complex dissolves).',
  },
  {
    id: 'exp_lead_iodide',
    title: '4. Golden Rain Test for Lead (Pb²⁺)',
    aim: 'Form glistening golden-yellow precipitate of lead(II) iodide using iodine/potassium iodide.',
    requiredApparatus: ['Test Tube', 'Bunsen Burner', 'Test Tube Holder'],
    suggestedSalt: 'pbno32',
    suggestedReagent: 'iodine',
    expectedColor: 'rgba(250, 204, 21, 0.85)',
    precipitateSpec: 'Golden Yellow Glistening Precipitate of PbI₂',
    gasSpec: 'None',
    principle: 'Pb²⁺ + 2I⁻ → PbI₂↓ (Golden yellow crystal precipitate that dissolves on boiling and recrystallizes).',
  },
  {
    id: 'exp_copper_complex',
    title: '5. Copper Tetrammine Complexation',
    aim: 'Observe pale blue Cu(OH)₂ forming first, then dissolving into intense deep royal azure blue [Cu(NH₃)₄]²⁺.',
    requiredApparatus: ['Test Tube', 'Dropping Pipette'],
    suggestedSalt: 'cuso4',
    suggestedReagent: 'nh4oh',
    expectedColor: 'rgba(30, 58, 138, 0.9)',
    precipitateSpec: 'Pale blue Cu(OH)₂ dissolves in excess NH₄OH',
    gasSpec: 'Slight ammonia vapor smell',
    principle: 'Cu²⁺ + 2NH₄OH → Cu(OH)₂↓ + 2NH₄⁺. Cu(OH)₂ + 4NH₃ → [Cu(NH₃)₄]²⁺ (Deep royal azure blue).',
  },
  {
    id: 'exp_ammonium_heat',
    title: '6. Sublimation of Ammonium Salt',
    aim: 'Dry heating of ammonium chloride producing dense white sublimed fumes and salt ring.',
    requiredApparatus: ['Test Tube', 'Test Tube Holder', 'Bunsen Burner'],
    suggestedSalt: 'nh4cl',
    suggestedReagent: '',
    expectedColor: 'rgba(226, 232, 240, 0.4)',
    precipitateSpec: 'White sublimed crystalline deposit on upper cooler test tube walls',
    gasSpec: 'Dense white fumes of NH₃ and HCl recombination',
    principle: 'NH₄Cl(s) ⇌ NH₃(g) + HCl(g). Thermal dissociation and reversible sublimation.',
  },
];

export interface TubeSlot {
  id: number; // 1 to 10
  salt: SaltItem | null;
  waterMl: number; // 0 to 20
  reagents: string[];
  indicator: string | null;
  isHeating: boolean;
  burnerFlameType: 'blue' | 'yellow';
  customColor?: string;
  notes: string;
}

export function computeReaction(tube: TubeSlot): {
  liquidColor: string;
  liquidVolumeMl: number;
  precipitate: string;
  precipitateColor: string;
  gas: string;
  observations: string[];
} {
  let liquidColor = 'rgba(255, 255, 255, 0.06)';
  let liquidVolumeMl = tube.waterMl + tube.reagents.length * 2.5;
  let precipitate = '';
  let precipitateColor = 'rgba(255, 255, 255, 0.9)';
  let gas = '';
  const observations: string[] = [];

  const hasSalt = tube.salt !== null;
  const hasWater = tube.waterMl > 0;
  const saltId = tube.salt?.id || '';

  if (hasSalt) {
    if (!hasWater && tube.reagents.length === 0) {
      observations.push(`Dry solid crystals of ${tube.salt?.name} in test tube.`);
      liquidColor = 'rgba(255, 255, 255, 0.05)';
    } else {
      if (tube.salt?.solubility === 'insoluble') {
        observations.push(`${tube.salt?.name} is insoluble; forms milky suspension.`);
        liquidColor = 'rgba(248, 250, 252, 0.7)';
        precipitate = `${tube.salt.formula} powder settles at bottom`;
      } else {
        liquidColor = tube.salt?.defaultColor || 'rgba(56, 189, 248, 0.35)';
        observations.push(`Dissolved ${tube.salt?.name} in water to form clear aqueous solution.`);
      }
    }
  }

  // Indicator color overrides
  if (tube.indicator) {
    if (tube.indicator === 'phenolphthalein') {
      if (tube.reagents.includes('conc_naoh') || tube.reagents.includes('nh4oh') || saltId === 'c15') {
        liquidColor = 'rgba(219, 39, 119, 0.85)';
        observations.push('Phenolphthalein gives intense magenta-pink in alkaline medium.');
      } else {
        liquidColor = 'rgba(241, 245, 249, 0.3)';
        observations.push('Phenolphthalein is colorless in acidic/neutral solution.');
      }
    } else if (tube.indicator === 'methyl_orange') {
      if (tube.reagents.includes('dil_hcl') || tube.reagents.includes('dil_h2so4') || tube.reagents.includes('conc_h2so4') || saltId === 'c14') {
        liquidColor = 'rgba(239, 68, 68, 0.85)';
        observations.push('Methyl orange turns crimson red in acidic solution.');
      } else {
        liquidColor = 'rgba(250, 204, 21, 0.85)';
        observations.push('Methyl orange remains yellow in neutral or alkaline solution.');
      }
    } else if (tube.indicator === 'blue_litmus') {
      if (tube.reagents.includes('dil_hcl') || tube.reagents.includes('dil_h2so4') || saltId === 'nh4cl' || saltId === 'c14') {
        liquidColor = 'rgba(239, 68, 68, 0.85)';
        observations.push('Blue litmus turns red confirming acidic hydronium ions.');
      } else {
        liquidColor = 'rgba(37, 99, 235, 0.85)';
        observations.push('Blue litmus solution remains blue.');
      }
    } else if (tube.indicator === 'red_litmus') {
      if (tube.reagents.includes('conc_naoh') || tube.reagents.includes('nh4oh') || saltId === 'c15') {
        liquidColor = 'rgba(37, 99, 235, 0.85)';
        observations.push('Red litmus turns blue confirming presence of hydroxide (OH⁻) ions.');
      } else {
        liquidColor = 'rgba(239, 68, 68, 0.85)';
        observations.push('Red litmus solution remains red.');
      }
    }
  }

  // Specific chemical reactions
  // 1. Carbonate effervescence with acid
  if ((saltId === 'caco3' || saltId === 'c12') && (tube.reagents.includes('dil_hcl') || tube.reagents.includes('dil_h2so4'))) {
    gas = 'CO₂ Gas Effervescence (Brisk Bubbling)';
    observations.push('Brisk effervescence of colorless, odorless CO₂ gas: CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂↑.');
    if (tube.reagents.includes('lime_water')) {
      observations.push('Lime water turns milky due to insoluble calcium carbonate formation.');
    }
  }

  // 2. Sulfate + BaCl2
  if ((saltId === 'cuso4' || saltId === 'feso4' || saltId === 'znso4' || saltId === 'c11') && tube.reagents.includes('bacl2')) {
    precipitate = 'Dense White Precipitate (BaSO₄)';
    precipitateColor = 'rgba(255, 255, 255, 0.96)';
    observations.push('Heavy white precipitate of BaSO₄ formed: SO₄²⁻ + Ba²⁺ → BaSO₄↓ (insoluble in dil. HCl).');
  }

  // 3. Chloride + AgNO3
  if ((saltId === 'nacl' || saltId === 'nh4cl' || saltId === 'c10') && tube.reagents.includes('agno3')) {
    precipitate = 'Curdy White Precipitate (AgCl)';
    precipitateColor = 'rgba(250, 250, 250, 0.98)';
    observations.push('Curdy white precipitate of AgCl formed: Cl⁻ + Ag⁺ → AgCl↓ (soluble in NH₄OH).');
  }

  // 4. Lead + Iodine
  if ((saltId === 'pbno32' || saltId === 'c13') && tube.reagents.includes('iodine')) {
    precipitate = 'Golden Yellow Precipitate (PbI₂)';
    precipitateColor = 'rgba(234, 179, 8, 0.95)';
    observations.push('Golden yellow glistening precipitate of Lead(II) Iodide: Pb²⁺ + 2I⁻ → PbI₂↓.');
  }

  // 5. Copper + NH4OH or NaOH
  if (saltId === 'cuso4' || saltId === 'c11') {
    if (tube.reagents.includes('nh4oh')) {
      liquidColor = 'rgba(30, 58, 138, 0.9)';
      observations.push('Deep royal azure blue solution formed: [Cu(NH₃)₄]²⁺ complex.');
    } else if (tube.reagents.includes('conc_naoh')) {
      precipitate = 'Light Blue Gelatinous Precipitate (Cu(OH)₂)';
      precipitateColor = 'rgba(56, 189, 248, 0.85)';
      observations.push('Pale blue gelatinous precipitate of Copper(II) hydroxide Cu(OH)₂.');
    }
  }

  // 6. Heating with Bunsen Burner
  if (tube.isHeating) {
    observations.push('Bunsen burner heating applied. Convective thermal currents and boiling active.');
    if (saltId === 'nh4cl') {
      gas = 'NH₃ + HCl Sublimation Vapor';
      observations.push('Ammonium chloride decomposes and sublimes into white smoke: NH₄Cl(s) ⇌ NH₃(g) + HCl(g).');
    }
    if (tube.reagents.includes('conc_h2so4')) {
      gas = 'Choking Acidic SO₂/SO₃ Fumes';
      observations.push('Dense pungent acid fumes evolved upon strong boiling with conc. H₂SO₄.');
    }
  }

  if (tube.customColor) {
    liquidColor = tube.customColor;
  }

  return { liquidColor, liquidVolumeMl, precipitate, precipitateColor, gas, observations };
}

export const CHEMISTRY_APPARATUS_PRESETS = [
  {
    id: 'copper_complex',
    name: '1. Copper Tetrammine Complexation',
    signature: 'workbench.testTubeStand.mountTube(1); workbench.addSalt("cuso4"); workbench.dispenseWater(8); workbench.addReagent("nh4oh");',
    desc: 'Forms pale blue Cu(OH)₂ precipitate which dissolves in excess NH₄OH into intense deep royal azure blue [Cu(NH₃)₄]²⁺ complex.',
    reaction: 'CuSO₄ + 4NH₄OH → [Cu(NH₃)₄]SO₄ + 4H₂O',
    payload: {
      apparatus: 'workbench.testTubeStand',
      action: 'mount_tube',
      slotId: 1,
      waterMl: 8,
      addSalt: 'cuso4',
      addReagents: ['nh4oh'],
      burner: { heating: false, flame: 'blue' },
    },
  },
  {
    id: 'golden_rain',
    name: '2. Lead Iodide Golden Rain Test',
    signature: 'workbench.takeEmptyTube(); workbench.addSalt("pbno32"); workbench.dispenseWater(8); workbench.addReagent("iodine"); workbench.bunsenBurner.setHeating(true);',
    desc: 'Reaction between Pb(NO₃)₂ and iodide forms glistening golden yellow PbI₂ crystals that dissolve on boiling and recrystallize.',
    reaction: 'Pb(NO₃)₂ + 2KI → PbI₂↓ (Golden Yellow) + 2KNO₃',
    payload: {
      apparatus: 'workbench',
      action: 'take_empty',
      waterMl: 8,
      addSalt: 'pbno32',
      addReagents: ['iodine'],
      burner: { heating: true, flame: 'blue' },
    },
  },
  {
    id: 'carbonate_effervescence',
    name: '3. Carbonate Radical & Effervescence',
    signature: 'workbench.takeEmptyTube(); workbench.addSalt("caco3"); workbench.dispenseWater(5); workbench.addReagent("dil_hcl");',
    desc: 'Calcium carbonate effervesces briskly releasing carbon dioxide gas which turns lime water milky.',
    reaction: 'CaCO₃ + 2HCl → CaCl₂ + H₂O + CO₂↑',
    payload: {
      apparatus: 'workbench',
      action: 'take_empty',
      waterMl: 5,
      addSalt: 'caco3',
      addReagents: ['dil_hcl'],
      burner: { heating: false, flame: 'blue' },
    },
  },
  {
    id: 'sulfate_test',
    name: '4. Sulfate Radical Insoluble Precipitate',
    signature: 'workbench.takeEmptyTube(); workbench.addSalt("cuso4"); workbench.dispenseWater(6); workbench.addReagent("bacl2");',
    desc: 'Barium chloride forms dense white barium sulfate precipitate insoluble in concentrated mineral acids.',
    reaction: 'CuSO₄ + BaCl₂ → BaSO₄↓ (White Dense) + CuCl₂',
    payload: {
      apparatus: 'workbench',
      action: 'take_empty',
      waterMl: 6,
      addSalt: 'cuso4',
      addReagents: ['bacl2'],
      burner: { heating: false, flame: 'blue' },
    },
  },
  {
    id: 'chloride_test',
    name: '5. Silver Chloride Curdy Precipitate',
    signature: 'workbench.takeEmptyTube(); workbench.addSalt("nacl"); workbench.dispenseWater(6); workbench.addReagent("agno3"); workbench.addReagent("nh4oh");',
    desc: 'Addition of AgNO₃ yields curdy white AgCl precipitate which dissolves in dilute ammonium hydroxide.',
    reaction: 'NaCl + AgNO₃ → AgCl↓ + NaNO₃; AgCl + 2NH₄OH → [Ag(NH₃)₂]Cl + 2H₂O',
    payload: {
      apparatus: 'workbench',
      action: 'take_empty',
      waterMl: 6,
      addSalt: 'nacl',
      addReagents: ['agno3', 'nh4oh'],
      burner: { heating: false, flame: 'blue' },
    },
  },
  {
    id: 'ammonium_sublimation',
    name: '6. Ammonium Salt Dry Heating Sublimation',
    signature: 'workbench.takeEmptyTube(); workbench.addSalt("nh4cl"); workbench.dispenseWater(0); workbench.bunsenBurner.setHeating(true);',
    desc: 'Dry heating of ammonium chloride causes reversible thermal decomposition and crystalline sublimation ring.',
    reaction: 'NH₄Cl(s) ⇌ NH₃(g) + HCl(g) (White Sublimation Ring)',
    payload: {
      apparatus: 'workbench',
      action: 'take_empty',
      waterMl: 0,
      addSalt: 'nh4cl',
      addReagents: [],
      burner: { heating: true, flame: 'blue' },
    },
  },
  {
    id: 'titration_run',
    name: '7. Acid-Base Neutralization Titration',
    signature: 'workbench.titrationApparatus.setBurette({ volumeMl: 18.5, stopcock: true }); workbench.addIndicator("phenolphthalein");',
    desc: 'Dispenses NaOH from burette into conical flask acid until persistent pink endpoint appears.',
    reaction: 'HCl + NaOH → NaCl + H₂O (Phenolphthalein colorless → magenta)',
    payload: {
      apparatus: 'workbench.titrationApparatus',
      action: 'titrate',
      titration: {
        buretteVolumeMl: 18.5,
        stopcockOpen: false,
        indicator: 'phenolphthalein',
      },
    },
  },
  {
    id: 'custom_contributor',
    name: '8. Contributor Custom Color & Reaction Override',
    signature: 'workbench.customReaction.override({ customColor: "#ec4899", precipitate: "Crystalline Rose Salt", pptColor: "#f43f5e" });',
    desc: 'Allows contributors to pick bespoke RGB/HEX solution tint, custom precipitate layer, and evolved gas type.',
    reaction: 'Custom Synthetic Formulation (Color Picker & Spectrophotometry)',
    payload: {
      apparatus: 'workbench.customReaction',
      action: 'custom_override',
      customAppearance: {
        customColor: '#ec4899',
        precipitate: 'Rose Crystalline Precipitate',
        pptColor: '#f43f5e',
        gas: 'Effervescent Vapor',
      },
    },
  },
];

export const ChemistryLabView: React.FC = () => {
  const { dbUser } = useAuth();
  const visualEffectsOn = dbUser?.eliteVisualEffects !== false;

  // Active workspace mode: 'bench' (clamped test tube), 'titration' (burette & conical flask), 'experiments' (predefined & contributor lab), 'codeblocks' (apparatus programmable block)
  const [activeTab, setActiveTab] = useState<'bench' | 'apparatus' | 'experiments' | 'codeblocks'>('bench');

  // Chemistry Code Blocks State
  const [chemistryCodeScript, setChemistryCodeScript] = useState<string>(() =>
    JSON.stringify(CHEMISTRY_APPARATUS_PRESETS[0].payload, null, 2)
  );
  const [chemistryCodeStatus, setChemistryCodeStatus] = useState<string | null>(null);

  // Stand holds 10 test tubes (Slots 1 to 10)
  const [standTubes, setStandTubes] = useState<TubeSlot[]>(() =>
    Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      salt: i === 0 ? KNOWN_SALTS[1] : i === 1 ? UNKNOWN_SALTS[0] : null,
      waterMl: i === 0 ? 6 : i === 1 ? 4 : 0,
      reagents: i === 0 ? ['nh4oh'] : [],
      indicator: null,
      isHeating: false,
      burnerFlameType: 'blue',
      notes: '',
    }))
  );

  // The active clamped test tube currently being held in the user's hand / clamp
  const [heldTube, setHeldTube] = useState<TubeSlot>({
    id: 1, // linked to slot 1 initially
    salt: KNOWN_SALTS[1],
    waterMl: 6,
    reagents: [],
    indicator: null,
    isHeating: false,
    burnerFlameType: 'blue',
    notes: '',
  });

  // Source slot in the rack from which the held tube was picked, or null if it's an unslotted fresh tube
  const [mountedSlotId, setMountedSlotId] = useState<number | null>(1);

  // Salt selector state
  const [saltMode, setSaltMode] = useState<'known' | 'unknown'>('known');

  // Titration simulation state
  const [buretteVolumeMl, setBuretteVolumeMl] = useState<number>(24.5);
  const [flaskAcidVolumeMl, setFlaskAcidVolumeMl] = useState<number>(20.0);
  const [titrationIndicator, setTitrationIndicator] = useState<string>('phenolphthalein');
  const [buretteStopcockOpen, setBuretteStopcockOpen] = useState<boolean>(false);

  // Contributor customizer state
  const [contributorCustomColor, setContributorCustomColor] = useState<string>('#38bdf8');
  const [contributorPptName, setContributorPptName] = useState<string>('Dense White Precipitate');
  const [contributorPptColor, setContributorPptColor] = useState<string>('#ffffff');
  const [contributorGasType, setContributorGasType] = useState<string>('Brisk Effervescence');

  const heldReaction = computeReaction(heldTube);

  // Actions on the held tube
  const updateHeldTube = (updater: (prev: TubeSlot) => TubeSlot) => {
    setHeldTube((prev) => {
      const next = updater(prev);
      // Sync back to stand if mounted to a slot
      if (mountedSlotId !== null) {
        setStandTubes((stand) => stand.map((slot) => (slot.id === mountedSlotId ? { ...next, id: slot.id } : slot)));
      }
      return next;
    });
  };

  const handlePickTubeFromStand = (slotId: number) => {
    const slot = standTubes.find((s) => s.id === slotId);
    if (!slot) return;
    setHeldTube({ ...slot });
    setMountedSlotId(slotId);
  };

  const handleTakeEmptyTube = () => {
    const fresh: TubeSlot = {
      id: Date.now(),
      salt: null,
      waterMl: 0,
      reagents: [],
      indicator: null,
      isHeating: false,
      burnerFlameType: 'blue',
      notes: '',
    };
    setHeldTube(fresh);
    setMountedSlotId(null);
  };

  const handleStoreHeldTubeToSlot = (targetSlotId: number) => {
    setStandTubes((prev) =>
      prev.map((slot) => (slot.id === targetSlotId ? { ...heldTube, id: targetSlotId } : slot))
    );
    setMountedSlotId(targetSlotId);
  };

  const handleAddSalt = (salt: SaltItem) => {
    updateHeldTube((t) => ({ ...t, salt }));
  };

  const handleAddWater = (ml: number) => {
    updateHeldTube((t) => ({ ...t, waterMl: Math.min(18, t.waterMl + ml) }));
  };

  const handleAddReagent = (reagentId: string) => {
    updateHeldTube((t) => {
      if (t.reagents.includes(reagentId)) return t;
      return { ...t, reagents: [...t.reagents, reagentId] };
    });
  };

  const handleSetIndicator = (indicatorId: string) => {
    updateHeldTube((t) => ({ ...t, indicator: t.indicator === indicatorId ? null : indicatorId }));
  };

  const handleToggleHeating = () => {
    updateHeldTube((t) => ({ ...t, isHeating: !t.isHeating }));
  };

  const handleToggleFlameType = () => {
    updateHeldTube((t) => ({
      ...t,
      burnerFlameType: t.burnerFlameType === 'blue' ? 'yellow' : 'blue',
    }));
  };

  const handleWashHeldTube = () => {
    updateHeldTube((t) => ({
      ...t,
      salt: null,
      waterMl: 0,
      reagents: [],
      indicator: null,
      isHeating: false,
      customColor: undefined,
      notes: '',
    }));
  };

  const handleLoadDefinedExperiment = (exp: DefinedExperiment) => {
    const saltObj = KNOWN_SALTS.find((s) => s.id === exp.suggestedSalt) || UNKNOWN_SALTS.find((s) => s.id === exp.suggestedSalt);
    const fresh: TubeSlot = {
      id: Date.now(),
      salt: saltObj || null,
      waterMl: 6,
      reagents: exp.suggestedReagent ? [exp.suggestedReagent] : [],
      indicator: null,
      isHeating: exp.id.includes('heat') || exp.id.includes('iodide'),
      burnerFlameType: 'blue',
      notes: exp.title,
    };
    setHeldTube(fresh);
    setMountedSlotId(null);
    setActiveTab('bench');
  };

  const handleApplyContributorSpec = () => {
    updateHeldTube((t) => ({
      ...t,
      customColor: contributorCustomColor,
      notes: `Contributor Spec: ${contributorPptName} | Gas: ${contributorGasType}`,
    }));
  };

  const handleRunChemistryCode = () => {
    try {
      const parsed = JSON.parse(chemistryCodeScript);

      // Handle mounting or creating tube
      if (parsed.action === 'take_empty') {
        const fresh: TubeSlot = {
          id: Date.now(),
          salt: null,
          waterMl: 0,
          reagents: [],
          indicator: null,
          isHeating: false,
          burnerFlameType: 'blue',
          notes: '',
        };
        setHeldTube(fresh);
        setMountedSlotId(null);
      } else if (parsed.action === 'mount_tube' && typeof parsed.slotId === 'number') {
        const slot = standTubes.find((s) => s.id === parsed.slotId);
        if (slot) {
          setHeldTube({ ...slot });
          setMountedSlotId(parsed.slotId);
        }
      }

      // Handle salt addition
      if (parsed.addSalt) {
        const saltObj =
          KNOWN_SALTS.find((s) => s.id === parsed.addSalt) ||
          UNKNOWN_SALTS.find((s) => s.id === parsed.addSalt);
        if (saltObj) {
          updateHeldTube((t) => ({ ...t, salt: saltObj }));
        }
      }

      // Handle water
      if (typeof parsed.waterMl === 'number') {
        updateHeldTube((t) => ({ ...t, waterMl: Math.max(0, Math.min(18, parsed.waterMl)) }));
      }

      // Handle reagents
      if (Array.isArray(parsed.addReagents)) {
        updateHeldTube((t) => ({
          ...t,
          reagents: Array.from(new Set([...t.reagents, ...parsed.addReagents])),
        }));
      }

      // Handle indicator
      if (parsed.addIndicator !== undefined) {
        updateHeldTube((t) => ({ ...t, indicator: parsed.addIndicator || null }));
      }

      // Handle burner
      if (parsed.burner) {
        if (typeof parsed.burner.heating === 'boolean') {
          updateHeldTube((t) => ({ ...t, isHeating: parsed.burner.heating }));
        }
        if (parsed.burner.flame === 'blue' || parsed.burner.flame === 'yellow') {
          updateHeldTube((t) => ({ ...t, burnerFlameType: parsed.burner.flame }));
        }
      }

      // Handle titration
      if (parsed.titration) {
        if (typeof parsed.titration.buretteVolumeMl === 'number') {
          setBuretteVolumeMl(parsed.titration.buretteVolumeMl);
        }
        if (typeof parsed.titration.stopcockOpen === 'boolean') {
          setBuretteStopcockOpen(parsed.titration.stopcockOpen);
        }
        if (parsed.titration.indicator) {
          setTitrationIndicator(parsed.titration.indicator);
        }
      }

      // Handle custom appearance
      if (parsed.customAppearance) {
        if (parsed.customAppearance.customColor) {
          updateHeldTube((t) => ({ ...t, customColor: parsed.customAppearance.customColor }));
          setContributorCustomColor(parsed.customAppearance.customColor);
        }
        if (parsed.customAppearance.precipitate) {
          setContributorPptName(parsed.customAppearance.precipitate);
        }
        if (parsed.customAppearance.pptColor) {
          setContributorPptColor(parsed.customAppearance.pptColor);
        }
        if (parsed.customAppearance.gas) {
          setContributorGasType(parsed.customAppearance.gas);
        }
      }

      setChemistryCodeStatus('Apparatus Function executed successfully! Test tube reaction live updated.');
      setTimeout(() => setChemistryCodeStatus(null), 4000);
    } catch (err) {
      setChemistryCodeStatus(`Script Execution Error: ${(err as Error).message}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div
        className={`rounded-2xl border p-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between bg-white dark:bg-slate-900 ${
          visualEffectsOn ? 'asan-elite-card border-blue-600 dark:border-cyan-400' : 'border-slate-200 dark:border-slate-800'
        }`}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="asan-elite-badge rounded px-2 py-0.5 text-[10px] font-bold">CHEMISTRY LABORATORY</span>
            <span className="text-xs text-blue-700 dark:text-cyan-400 font-semibold">10-Slot Rack · Clamped Test Tube · Reagents &amp; Experiments</span>
          </div>
          <h1 className="font-display text-2xl font-bold text-slate-900 dark:text-white">
            Virtual Chemistry Lab Workbench
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Work with 10 test tubes in the stand. Hold one empty tube in the clamp, add salt crystals (known or unknown sachets C-10... or acid/base beakers), dispense water, add reagents, indicators &amp; Bunsen burner heat.
          </p>
        </div>

        {/* View mode switcher */}
        <div className="flex rounded-xl border border-slate-200 dark:border-slate-800 p-1 bg-slate-50 dark:bg-slate-950 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('bench')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
              activeTab === 'bench' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            🧪 Test Tube Bench
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('apparatus')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
              activeTab === 'apparatus' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            🔬 Apparatus Locker
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('experiments')}
            className={`px-3 py-1.5 rounded-lg font-bold transition-colors ${
              activeTab === 'experiments' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
            }`}
          >
            📜 Experiments &amp; Specs
          </button>
        </div>
      </div>

      {activeTab === 'bench' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Reagent & Salt Shelves */}
          <div className="lg:col-span-4 space-y-4">
            {/* Salt Shelf */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
                  Salt &amp; Unknown Shelf
                </span>
                <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 bg-slate-50 dark:bg-slate-800 text-xs">
                  <button
                    type="button"
                    onClick={() => setSaltMode('known')}
                    className={`px-2 py-0.5 rounded font-semibold transition-colors ${
                      saltMode === 'known' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Known Salts
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaltMode('unknown')}
                    className={`px-2 py-0.5 rounded font-semibold transition-colors ${
                      saltMode === 'unknown' ? 'bg-amber-600 text-white' : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Unknown Sachets
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {(saltMode === 'known' ? KNOWN_SALTS : UNKNOWN_SALTS).map((salt) => {
                  const isCurrent = heldTube.salt?.id === salt.id;
                  return (
                    <div
                      key={salt.id}
                      className={`flex items-center justify-between rounded-xl border p-2 text-left transition-all ${
                        isCurrent
                          ? 'border-blue-600 bg-blue-50/80 dark:bg-blue-950/40 text-blue-950 dark:text-blue-100 font-bold'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-2">
                        {salt.type === 'salt_sachet' ? (
                          <span className="shrink-0 flex items-center justify-center h-7 w-7 rounded-md bg-amber-100 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-800 text-[10px] font-mono font-bold text-amber-900 dark:text-amber-200" title="Salt in Sachet">
                            📦
                          </span>
                        ) : salt.type === 'acid_beaker' || salt.type === 'base_beaker' ? (
                          <span className="shrink-0 flex items-center justify-center h-7 w-7 rounded-md bg-cyan-100 dark:bg-cyan-950/80 border border-cyan-300 dark:border-cyan-800 text-[10px] font-mono font-bold text-cyan-900 dark:text-cyan-200" title="Acid/Base in Beaker">
                            🧪
                          </span>
                        ) : (
                          <span className="shrink-0 flex items-center justify-center h-7 w-7 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">
                            🧂
                          </span>
                        )}
                        <div className="min-w-0">
                          <div className="text-xs truncate">{salt.name}</div>
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">{salt.formula}</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleAddSalt(salt)}
                        className="shrink-0 rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 text-xs font-semibold shadow-xs"
                      >
                        {isCurrent ? 'Added' : '+ Add'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Student Shelf Reagents */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 shadow-xs">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Pipette className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Student Reagents Shelf
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {STUDENT_REAGENTS.map((reg) => {
                  const added = heldTube.reagents.includes(reg.id);
                  return (
                    <button
                      key={reg.id}
                      type="button"
                      onClick={() => handleAddReagent(reg.id)}
                      className={`rounded-xl border p-2 text-left text-xs transition-all ${
                        added
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 font-bold'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="truncate font-semibold">{reg.name}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{reg.formula}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Strong Reagents Shelf */}
            <div className="rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-3 shadow-xs">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />
                Strong Reagents Shelf (Caution)
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {STRONG_REAGENTS.map((sr) => {
                  const added = heldTube.reagents.includes(sr.id);
                  return (
                    <button
                      key={sr.id}
                      type="button"
                      onClick={() => handleAddReagent(sr.id)}
                      className={`w-full flex items-center justify-between rounded-xl border p-2 text-left text-xs transition-all ${
                        added
                          ? 'border-amber-600 bg-amber-100 dark:bg-amber-900/40 text-amber-950 dark:text-amber-100 font-bold'
                          : 'border-amber-200 dark:border-amber-800/70 bg-white dark:bg-slate-900 hover:bg-amber-100/40 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <div className="min-w-0 pr-2">
                        <div className="truncate font-semibold">{sr.name}</div>
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">{sr.hazard}</div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-200 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200 shrink-0">
                        {added ? 'Added' : '+ Add'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Center & Right Column: Clamped Held Tube + 10-Slot Rack */}
          <div className="lg:col-span-8 space-y-5">
            {/* Clamped Test Tube Control Bar */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white font-mono font-bold flex items-center justify-center text-sm shadow-md">
                  {mountedSlotId !== null ? `#${mountedSlotId}` : '★'}
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    {mountedSlotId !== null ? `Clamped Tube (Mounted from Rack Slot #${mountedSlotId})` : 'Clamped Tube (Unslotted / In Hand)'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    {heldTube.salt ? `Salt: ${heldTube.salt.name}` : 'Empty Glass Tube'} · {heldTube.waterMl} mL Water
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTakeEmptyTube}
                  className="inline-flex items-center gap-1 rounded-lg border border-blue-600 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-bold text-blue-700 dark:text-cyan-300 hover:bg-blue-100 transition-colors"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Take Empty Tube
                </button>
                <button
                  type="button"
                  onClick={() => handleAddWater(3)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  title="Dispense distilled water from wash bottle"
                >
                  <Droplets className="h-3.5 w-3.5 text-blue-500" />
                  + Water (3 mL)
                </button>
                <button
                  type="button"
                  onClick={handleToggleHeating}
                  className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    heldTube.isHeating
                      ? 'border-orange-500 bg-orange-500 text-white animate-pulse'
                      : 'border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <Flame className={`h-3.5 w-3.5 ${heldTube.isHeating ? 'text-white' : 'text-orange-500'}`} />
                  {heldTube.isHeating ? 'Heating Active' : 'Heat with Burner'}
                </button>
                <button
                  type="button"
                  onClick={handleWashHeldTube}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/40 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                  Wash Clean
                </button>
              </div>
            </div>

            {/* Indicators Bar */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-xs">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <FlaskConical className="h-4 w-4 text-pink-500" />
                Chemical Indicators:
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {INDICATORS.map((ind) => {
                  const isSelected = heldTube.indicator === ind.id;
                  return (
                    <button
                      key={ind.id}
                      type="button"
                      onClick={() => handleSetIndicator(ind.id)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-all ${
                        isSelected
                          ? 'border-pink-600 bg-pink-50 dark:bg-pink-950/50 text-pink-700 dark:text-pink-300 shadow-xs ring-1 ring-pink-500'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ind.color }} />
                      <span>{ind.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Visual Laboratory Bench Stage */}
            <div className="rounded-2xl border border-slate-800 bg-[#09101f] p-6 relative overflow-hidden min-h-[400px] flex flex-col items-center justify-center shadow-2xl">
              {/* Bench Grid Matrix */}
              <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-40 pointer-events-none" />

              {/* Bunsen Burner & Test Tube Holder Clamp */}
              <div className="relative z-10 flex flex-col items-center">
                {/* Vapors / Gas effervescence rising */}
                {(heldReaction.gas || heldTube.isHeating) && (
                  <div className="flex flex-col items-center mb-1 animate-bounce">
                    <div className="text-[11px] font-mono font-bold text-cyan-300 bg-slate-900/90 border border-cyan-500/40 px-2.5 py-0.5 rounded-full shadow-lg">
                      💨 {heldReaction.gas || 'Steam & Thermal Vapors'}
                    </div>
                    <div className="h-6 w-12 bg-gradient-to-t from-cyan-400/20 to-transparent blur-xs rounded-full" />
                  </div>
                )}

                {/* Clamped Wooden / Metal Holder Arm & Glass Tube */}
                <div className="relative flex items-center">
                  {/* Wooden Tongs / Clamp Handle */}
                  <div className="absolute -left-32 top-14 w-36 h-4 bg-gradient-to-r from-amber-900 via-amber-800 to-amber-700 rounded-l-md shadow-lg flex items-center justify-end pr-2 border-r-2 border-amber-600">
                    <span className="text-[9px] font-mono text-amber-200 font-bold">CLAMP</span>
                  </div>

                  {/* Vertical Pyrex Glass Test Tube */}
                  <div className="relative w-14 h-60 rounded-b-full border-2 border-slate-200/90 bg-slate-900/40 backdrop-blur-xs overflow-hidden shadow-2xl flex flex-col justify-end">
                    {/* Glass reflections */}
                    <div className="absolute top-0 right-1.5 w-1 h-full bg-white/20 rounded-full pointer-events-none" />
                    <div className="absolute top-2 left-1.5 w-0.5 h-3/4 bg-white/25 rounded-full pointer-events-none" />

                    {/* Liquid Reaction Column */}
                    {heldReaction.liquidVolumeMl > 0 ? (
                      <div
                        className="w-full transition-all duration-700 relative overflow-hidden flex flex-col justify-end"
                        style={{
                          height: `${Math.min(92, Math.max(16, heldReaction.liquidVolumeMl * 4.6))}%`,
                          backgroundColor: heldReaction.liquidColor,
                        }}
                      >
                        {/* Meniscus arc */}
                        <div className="w-full h-1.5 bg-white/20 rounded-t-full" />

                        {/* Bubbles if gas or boiling */}
                        {(heldTube.isHeating || heldReaction.gas) && (
                          <div className="absolute inset-0 flex flex-wrap gap-1 items-end justify-center p-1 pointer-events-none">
                            <span className="h-2 w-2 rounded-full bg-white/70 animate-ping" />
                            <span className="h-1.5 w-1.5 rounded-full bg-white/80 animate-bounce" />
                            <span className="h-2.5 w-2.5 rounded-full bg-white/60 animate-pulse" />
                          </div>
                        )}

                        {/* Precipitate settling at bottom */}
                        {heldReaction.precipitate && (
                          <div
                            className="w-full h-6 rounded-b-full shadow-inner animate-pulse flex items-center justify-center text-[8px] font-bold text-slate-900"
                            style={{ backgroundColor: heldReaction.precipitateColor }}
                            title={heldReaction.precipitate}
                          >
                            Ppt
                          </div>
                        )}
                      </div>
                    ) : heldTube.salt ? (
                      /* Dry salt crystals in bottom of dry tube */
                      <div className="w-full h-8 rounded-b-full bg-amber-100/95 border-t border-amber-300 flex items-center justify-center text-[9px] font-bold text-amber-950 shadow-inner">
                        Dry Salt
                      </div>
                    ) : (
                      <div className="p-2 text-[10px] text-slate-500 text-center font-mono">
                        Clean Empty
                      </div>
                    )}
                  </div>
                </div>

                {/* Bunsen Burner underneath */}
                {heldTube.isHeating ? (
                  <div className="flex flex-col items-center mt-3 cursor-pointer" onClick={handleToggleFlameType} title="Click to toggle non-luminous blue vs luminous yellow flame">
                    {heldTube.burnerFlameType === 'blue' ? (
                      <div className="h-14 w-6 bg-gradient-to-t from-blue-700 via-cyan-400 to-amber-200 rounded-full blur-[1px] shadow-[0_0_15px_rgba(56,189,248,0.8)] animate-pulse" />
                    ) : (
                      <div className="h-14 w-7 bg-gradient-to-t from-orange-600 via-amber-400 to-yellow-200 rounded-full blur-[1px] shadow-[0_0_15px_rgba(245,158,11,0.8)] animate-pulse" />
                    )}
                    <div className="h-9 w-4 bg-slate-600 rounded-t-sm" />
                    <div className="h-3 w-16 bg-slate-700 rounded-full" />
                    <span className="text-[9px] font-mono text-cyan-300 mt-1 font-bold">
                      {heldTube.burnerFlameType === 'blue' ? 'Blue Roaring Flame' : 'Yellow Sooty Flame'}
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center mt-6 opacity-60">
                    <div className="h-9 w-4 bg-slate-700 rounded-t-sm" />
                    <div className="h-3 w-16 bg-slate-800 rounded-full" />
                  </div>
                )}
              </div>

              {/* Observation Dashboard Card */}
              <div className="w-full mt-6 rounded-xl border border-slate-800 bg-slate-900/95 p-4 text-xs space-y-2 z-10 shadow-lg">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="font-bold text-cyan-300 flex items-center gap-1.5">
                    <AlertCircle className="h-4 w-4 text-cyan-400" />
                    Clamped Test Tube Observations
                  </span>
                  <span className="text-[11px] font-mono text-slate-400">
                    Vol: {heldReaction.liquidVolumeMl.toFixed(1)} mL · Temp: {heldTube.isHeating ? '88°C (Boiling)' : '25°C (Ambient)'}
                  </span>
                </div>

                <div className="space-y-1">
                  {heldReaction.observations.length === 0 ? (
                    <p className="text-slate-400">Empty test tube. Select a salt sample or dispense water to start experimenting.</p>
                  ) : (
                    heldReaction.observations.map((obs, idx) => (
                      <div key={idx} className="text-slate-300 flex items-start gap-1.5">
                        <span className="text-cyan-400 font-bold">•</span>
                        <span>{obs}</span>
                      </div>
                    ))
                  )}
                  {heldReaction.precipitate && (
                    <div className="text-amber-300 font-semibold pt-1 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: heldReaction.precipitateColor }} />
                      <span>⚡ Precipitate: {heldReaction.precipitate}</span>
                    </div>
                  )}
                  {heldReaction.gas && (
                    <div className="text-emerald-300 font-semibold">
                      💨 Gas Evolved: {heldReaction.gas}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 10-SLOT TEST TUBE STAND (RACK) */}
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <TestTube className="h-4 w-4 text-blue-600 dark:text-cyan-400" />
                    10-Slot Laboratory Test Tube Stand (Rack)
                  </h3>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Click any slot to hold that test tube in the clamp, or store the currently held tube into an empty slot.
                  </p>
                </div>

                {mountedSlotId !== null ? (
                  <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-cyan-300 border border-blue-200 dark:border-blue-800 self-start">
                    Holding Slot #{mountedSlotId}
                  </span>
                ) : (
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-slate-500">Store into:</span>
                    <select
                      onChange={(e) => handleStoreHeldTubeToSlot(Number(e.target.value))}
                      defaultValue=""
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs font-bold"
                    >
                      <option value="" disabled>Select Slot (1-10)</option>
                      {standTubes.map((s) => (
                        <option key={s.id} value={s.id}>Slot #{s.id} {s.salt ? `(${s.salt.label})` : '(Empty)'}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Wooden 10-Hole Stand Visual Grid */}
              <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5 p-4 rounded-xl border border-amber-800/40 bg-gradient-to-b from-amber-100/60 via-amber-50/30 to-amber-200/50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 shadow-inner">
                {standTubes.map((slot) => {
                  const isMounted = mountedSlotId === slot.id;
                  const rx = computeReaction(slot);
                  const hasLiquid = rx.liquidVolumeMl > 0;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      onClick={() => handlePickTubeFromStand(slot.id)}
                      className={`flex flex-col items-center p-2 rounded-xl border transition-all ${
                        isMounted
                          ? 'border-blue-600 dark:border-cyan-400 bg-white dark:bg-slate-800 shadow-md scale-105 ring-2 ring-blue-500/40'
                          : 'border-slate-200 dark:border-slate-800 hover:border-slate-400 dark:hover:border-slate-700 bg-white/80 dark:bg-slate-900/80'
                      }`}
                      title={`Slot #${slot.id}: ${slot.salt ? slot.salt.name : 'Empty'}`}
                    >
                      <span className="text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400 mb-1">
                        #{slot.id}
                      </span>

                      {/* Mini Tube in Rack */}
                      <div className="w-5 h-20 rounded-b-full border border-slate-400 dark:border-slate-600 bg-slate-100 dark:bg-slate-950/70 overflow-hidden relative flex flex-col justify-end shadow-xs">
                        {hasLiquid ? (
                          <div
                            className="w-full transition-all duration-300"
                            style={{
                              height: `${Math.min(90, Math.max(20, rx.liquidVolumeMl * 4.4))}%`,
                              backgroundColor: rx.liquidColor,
                            }}
                          />
                        ) : slot.salt ? (
                          <div className="w-full h-3 rounded-b-full bg-amber-300" />
                        ) : null}
                      </div>

                      <span className="text-[9px] font-semibold text-slate-700 dark:text-slate-300 mt-1.5 truncate max-w-[50px]">
                        {slot.salt ? slot.salt.label : 'Empty'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* APPARATUS LOCKER TAB */}
      {activeTab === 'apparatus' && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-6 shadow-xs">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-slate-100">
              Laboratory Apparatus &amp; Glassware Locker
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Complete set of apparatus specified for volumetric and qualitative chemical analysis: Test tube stand, pipette, burette, conical flask, beaker, indicators, Bunsen burner, holder, and filter funnel.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* 1. Test Tube & Stand */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <TestTube className="h-4 w-4 text-blue-600" />
                10-Slot Test Tube Stand &amp; Holder
              </div>
              <p className="text-slate-500">Holds 10 standard 15x150 mm Pyrex test tubes. User can mount individual tubes into the clamp holder for testing.</p>
              <button
                type="button"
                onClick={() => setActiveTab('bench')}
                className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 font-semibold text-xs"
              >
                Go to Test Tube Bench
              </button>
            </div>

            {/* 2. Dropping Pipette */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <Pipette className="h-4 w-4 text-emerald-600" />
                Dropping Pipette (1 mL - 5 mL)
              </div>
              <p className="text-slate-500">Graduated glass pipette with rubber bulb for adding reagent drop-by-drop into test tubes and flasks.</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleAddWater(1);
                    setActiveTab('bench');
                  }}
                  className="rounded-lg border border-emerald-500 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 font-semibold"
                >
                  Dispense 1 mL Drop
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handleAddWater(5);
                    setActiveTab('bench');
                  }}
                  className="rounded-lg border border-emerald-500 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 font-semibold"
                >
                  Dispense 5 mL
                </button>
              </div>
            </div>

            {/* 3. Titration Burette & Stopcock */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <TestTube className="h-4 w-4 text-indigo-600" />
                Graduated Burette (0 - 50 mL)
              </div>
              <p className="text-slate-500">Vertical 50 mL burette with glass stopcock tap for acid-base titrations with least count 0.1 mL.</p>
              <div className="space-y-1">
                <div className="flex justify-between font-mono">
                  <span>Reading:</span>
                  <span className="font-bold text-indigo-600">{buretteVolumeMl.toFixed(1)} mL</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={0.1}
                  value={buretteVolumeMl}
                  onChange={(e) => setBuretteVolumeMl(Number(e.target.value))}
                  className="w-full accent-indigo-600"
                />
              </div>
            </div>

            {/* 4. Conical Flask (Erlenmeyer) */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <FlaskConical className="h-4 w-4 text-purple-600" />
                Conical Flask (250 mL)
              </div>
              <p className="text-slate-500">Narrow-mouth flask ideal for swirling solutions during titration without spillage.</p>
              <div className="text-[11px] text-purple-600 dark:text-purple-400 font-mono">
                Acid Volume: {flaskAcidVolumeMl} mL · Neutralization point: 25.0 mL
              </div>
            </div>

            {/* 5. Glass Beaker */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <Beaker className="h-4 w-4 text-cyan-600" />
                Borosil Beaker (100 mL &amp; 250 mL)
              </div>
              <p className="text-slate-500">Cylindrical container with pouring spout for holding unknown acid/base solutions (C-14, C-15).</p>
            </div>

            {/* 6. Funnel & Filter Paper */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <Wind className="h-4 w-4 text-amber-600" />
                Glass Funnel &amp; Filter Paper
              </div>
              <p className="text-slate-500">Cone-shaped apparatus for gravimetric filtration of precipitates (BaSO₄, PbI₂, AgCl) from supernatant liquid.</p>
            </div>

            {/* 7. Bunsen Burner */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <Flame className="h-4 w-4 text-orange-600" />
                Bunsen Burner with Air Collar
              </div>
              <p className="text-slate-500">Laboratory burner. Toggle collar to switch between non-luminous blue roaring flame (heating) and luminous yellow flame.</p>
              <button
                type="button"
                onClick={handleToggleHeating}
                className="rounded-lg bg-orange-600 hover:bg-orange-500 text-white px-3 py-1.5 font-semibold text-xs"
              >
                {heldTube.isHeating ? 'Turn Off Burner' : 'Turn On Burner'}
              </button>
            </div>

            {/* 8. Wash Bottle */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <Droplets className="h-4 w-4 text-blue-500" />
                Distilled Water Wash Bottle
              </div>
              <p className="text-slate-500">Squeeze bottle dispensing pure distilled H₂O for dissolving salts and washing test tubes.</p>
              <button
                type="button"
                onClick={() => {
                  handleAddWater(5);
                  setActiveTab('bench');
                }}
                className="rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 font-semibold text-xs"
              >
                Dispense 5 mL Water
              </button>
            </div>

            {/* 9. Indicators Collection */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-2 bg-slate-50/50 dark:bg-slate-950/50">
              <div className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-200">
                <Droplet className="h-4 w-4 text-pink-600" />
                Indicators: Phenolphthalein, Methyl Orange, Litmus
              </div>
              <p className="text-slate-500">pH sensitive organic dyes signaling acid-base transitions with distinct color changes.</p>
            </div>
          </div>
        </div>
      )}

      {/* DEFINED EXPERIMENTS & CONTRIBUTOR CUSTOMIZER TAB */}
      {activeTab === 'experiments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Predefined Experiments List */}
          <div className="lg:col-span-7 space-y-4">
            <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 shadow-xs">
              <div>
                <h2 className="font-display text-base font-bold text-slate-900 dark:text-slate-100">
                  Pre-Defined Laboratory Experiments
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Click &ldquo;Perform Experiment&rdquo; to automatically load required salt, reagents, and apparatus onto the bench.
                </p>
              </div>

              <div className="space-y-3">
                {PREDEFINED_EXPERIMENTS.map((exp) => (
                  <div
                    key={exp.id}
                    className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 space-y-2 hover:border-blue-500/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-xs text-slate-900 dark:text-slate-100">{exp.title}</div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{exp.aim}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadDefinedExperiment(exp)}
                        className="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 text-xs font-semibold shrink-0 shadow-xs"
                      >
                        <Play className="h-3 w-3" />
                        Perform
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1 border-t border-slate-100 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                      <div>
                        <span className="font-semibold text-slate-500">Ppt:</span> {exp.precipitateSpec}
                      </div>
                      <div>
                        <span className="font-semibold text-slate-500">Gas:</span> {exp.gasSpec}
                      </div>
                    </div>

                    <div className="text-[10px] font-mono text-cyan-600 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/40 p-1.5 rounded-lg">
                      {exp.principle}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Contributor Experiment Specification & Color Picker */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-2xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-5 space-y-4 shadow-xs">
              <div className="space-y-1">
                <span className="asan-elite-badge rounded px-2 py-0.5 text-[10px] font-bold">CONTRIBUTOR STUDIO</span>
                <h3 className="font-display text-sm font-bold text-slate-900 dark:text-slate-100">
                  Custom Reaction &amp; Color Specification
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Contributors can define custom color transitions, precipitate formation parameters, and effervescence behaviors for qualitative testing.
                </p>
              </div>

              <div className="space-y-3 text-xs">
                {/* Solution Color Picker */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    <span>Solution Final Color (Color Picker):</span>
                    <span className="font-mono text-[11px]">{contributorCustomColor}</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={contributorCustomColor}
                      onChange={(e) => setContributorCustomColor(e.target.value)}
                      className="h-10 w-16 rounded-lg cursor-pointer bg-transparent border border-slate-300 dark:border-slate-700 p-0.5"
                    />
                    <div
                      className="flex-1 h-10 rounded-lg border border-slate-300 dark:border-slate-700 flex items-center justify-center font-mono font-bold text-white shadow-inner"
                      style={{ backgroundColor: contributorCustomColor }}
                    >
                      Color Preview
                    </div>
                  </div>
                </div>

                {/* Precipitate Specification */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Precipitate Formation Specification:
                  </label>
                  <input
                    type="text"
                    value={contributorPptName}
                    onChange={(e) => setContributorPptName(e.target.value)}
                    placeholder="e.g. Curdy White AgCl / Golden PbI2"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                  />
                </div>

                {/* Precipitate Color Picker */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                    <span>Precipitate Color (Color Picker):</span>
                    <span className="font-mono text-[11px]">{contributorPptColor}</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={contributorPptColor}
                      onChange={(e) => setContributorPptColor(e.target.value)}
                      className="h-9 w-14 rounded-lg cursor-pointer bg-transparent border border-slate-300 dark:border-slate-700 p-0.5"
                    />
                    <div
                      className="flex-1 h-9 rounded-lg border border-slate-300 dark:border-slate-700 flex items-center justify-center font-mono text-xs font-bold text-slate-900 shadow-inner"
                      style={{ backgroundColor: contributorPptColor }}
                    >
                      Ppt Layer Preview
                    </div>
                  </div>
                </div>

                {/* Gas Evolved Specification */}
                <div className="space-y-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Gas Evolution Specification:
                  </label>
                  <input
                    type="text"
                    value={contributorGasType}
                    onChange={(e) => setContributorGasType(e.target.value)}
                    placeholder="e.g. Brisk CO2 Effervescence / NH3 Vapors"
                    className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleApplyContributorSpec}
                  className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 text-white p-2.5 font-bold text-xs shadow-md transition-colors"
                >
                  Apply Specification to Active Tube
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
