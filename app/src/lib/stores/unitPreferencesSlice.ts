/**
 * Unit preference types and dimension configurations.
 * Provides dimension-based unit options for quantities.
 */

export type DimensionKey =
  | "pressure"
  | "pressureDelta"
  | "temperature"
  | "massFlow"
  | "volumeFlow"
  | "power"
  | "energy"
  | "length"
  | "diameter"
  | "roughness"
  | "area"
  | "volume"
  | "mass"
  | "density"
  | "time"
  | "velocity"
  | "scalar"
  | "dimensionless";

export interface DimensionConfig {
  label: string;
  baseUnit: string;
  options: string[];
  defaultUnit: string;
  tooltipOptions?: Array<{
    unit: string;
    label?: string;
    decimalPlaces?: number;
  }>;
}

const DIMENSION_ALIASES = {
  flowrate: "massFlow",
  massFlowrate: "massFlow",
  scalar: "dimensionless",
  speed: "velocity",
} as const satisfies Partial<Record<string, DimensionKey>>;

function isDimensionAlias(
  dimension: string,
): dimension is keyof typeof DIMENSION_ALIASES {
  return Object.hasOwn(DIMENSION_ALIASES, dimension);
}

const DIMENSION_CONFIGS: Record<DimensionKey, DimensionConfig> = {
  pressure: {
    label: "Pressure",
    baseUnit: "Pa",
    options: ["Pa", "kPa", "MPa", "bar", "psi"],
    defaultUnit: "bar",
    tooltipOptions: [
      { unit: "bar", label: "bara", decimalPlaces: 2 },
      { unit: "kPa", decimalPlaces: 0 },
      { unit: "bar", label: "barg", decimalPlaces: 2 },
    ],
  },
  pressureDelta: {
    label: "Pressure Drop",
    baseUnit: "Pa",
    options: ["Pa", "kPa", "bar"],
    defaultUnit: "bar",
    tooltipOptions: [{ unit: "bar" }, { unit: "kPa" }],
  },
  temperature: {
    label: "Temperature",
    baseUnit: "K",
    options: ["K", "degC", "degF"],
    defaultUnit: "degC",
    tooltipOptions: [{ unit: "degC", label: "C" }, { unit: "K" }],
  },
  massFlow: {
    label: "Mass Flow",
    baseUnit: "kg/s",
    options: ["mtpa", "kg/s", "kg/h", "t/h", "lb/s", "lb/h"],
    defaultUnit: "kg/s",
    tooltipOptions: [
      { unit: "mtpa", label: "MTPA", decimalPlaces: 3 },
      { unit: "kg/h", label: "kg/hr", decimalPlaces: 0 },
      { unit: "kg/s", decimalPlaces: 1 },
    ],
  },
  volumeFlow: {
    label: "Volume Flow",
    baseUnit: "m^3/s",
    options: ["m^3/s", "m^3/h", "L/s"],
    defaultUnit: "m^3/h",
  },
  power: {
    label: "Power",
    baseUnit: "W",
    options: ["W", "kW", "MW", "GW"],
    defaultUnit: "kW",
    tooltipOptions: [{ unit: "MW" }, { unit: "kW" }, { unit: "W" }],
  },
  energy: {
    label: "Energy",
    baseUnit: "J",
    options: ["J", "kJ", "MJ", "GJ", "kWh", "MWh"],
    defaultUnit: "kWh",
  },
  length: {
    label: "Length",
    baseUnit: "m",
    options: ["m", "km", "cm", "mm", "ft", "in", "mi"],
    defaultUnit: "m",
    tooltipOptions: [{ unit: "km" }, { unit: "m" }],
  },
  diameter: {
    label: "Diameter",
    baseUnit: "m",
    options: ["m", "mm", "cm", "in"],
    defaultUnit: "m",
    tooltipOptions: [
      { unit: "in" },
      { unit: "m" },
      { unit: "cm" },
      { unit: "mm" },
    ],
  },
  roughness: {
    label: "Roughness",
    baseUnit: "m",
    options: ["mm"],
    defaultUnit: "mm",
    tooltipOptions: [{ unit: "mm" }],
  },
  area: {
    label: "Area",
    baseUnit: "m^2",
    options: ["m^2", "km^2", "cm^2", "mm^2", "ft^2", "in^2"],
    defaultUnit: "m^2",
  },
  volume: {
    label: "Volume",
    baseUnit: "m^3",
    options: ["m^3", "L", "mL", "gal", "ft^3"],
    defaultUnit: "m^3",
  },
  mass: {
    label: "Mass",
    baseUnit: "kg",
    options: ["kg", "t"],
    defaultUnit: "kg",
  },
  density: {
    label: "Density",
    baseUnit: "kg/m^3",
    options: ["kg/m^3", "g/cm^3", "g/L", "lb/ft^3"],
    defaultUnit: "kg/m^3",
  },
  time: {
    label: "Time",
    baseUnit: "s",
    options: ["s", "min", "h"],
    defaultUnit: "h",
  },
  velocity: {
    label: "Velocity",
    baseUnit: "m/s",
    options: ["m/s", "km/h", "ft/s"],
    defaultUnit: "m/s",
  },
  scalar: {
    label: "Scalar",
    baseUnit: "",
    options: [""],
    defaultUnit: "",
  },
  dimensionless: {
    label: "Dimensionless",
    baseUnit: "",
    options: [""],
    defaultUnit: "",
  },
};

export function resolveDimensionKey(
  dimension?: string,
): DimensionKey | undefined {
  if (!dimension) {
    return undefined;
  }

  if (dimension in DIMENSION_CONFIGS) {
    return dimension as DimensionKey;
  }

  if (isDimensionAlias(dimension)) {
    return DIMENSION_ALIASES[dimension];
  }

  return undefined;
}

export function getDimensionConfig(dimension: DimensionKey): DimensionConfig {
  return DIMENSION_CONFIGS[dimension] ?? DIMENSION_CONFIGS.dimensionless;
}

export function getDimensionKeys(): DimensionKey[] {
  return Object.keys(DIMENSION_CONFIGS) as DimensionKey[];
}

const STORAGE_KEY = "unit-preferences";

type UnitPreferences = Partial<Record<DimensionKey, string>>;

export function getStoredPreferences(): UnitPreferences {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as UnitPreferences) : {};
  } catch {
    return {};
  }
}

export function savePreferences(prefs: UnitPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // Ignore storage errors.
  }
}

export function getPreferredUnit(dimension: DimensionKey): string {
  const prefs = getStoredPreferences();
  return prefs[dimension] ?? getDimensionConfig(dimension).defaultUnit;
}

export function setPreferredUnit(dimension: DimensionKey, unit: string): void {
  const prefs = getStoredPreferences();
  prefs[dimension] = unit;
  savePreferences(prefs);
}
