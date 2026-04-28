import { batchConvertExprs, convertExpr } from "@/lib/dim/dim";
import {
  getDimensionConfig,
  resolveDimensionKey,
  type DimensionKey,
} from "@/lib/stores/unitPreferencesSlice";

const STANDARD_ATMOSPHERE_BAR = 1.01325;

type TooltipConversion = {
  label: string;
  text: string;
};

type TooltipContext = {
  expression?: string;
  unit?: string;
  dimension?: string;
  property?: string;
};

function formatNumber(value: number, decimalPlaces?: number): string {
  return new Intl.NumberFormat("en-GB", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces ?? 6,
    useGrouping: false,
  }).format(value);
}

export function resolveTooltipDimension(
  dimension?: string,
  property?: string,
): DimensionKey | undefined {
  if (property === "diameter") return "diameter";
  if (property === "roughness") return "roughness";
  if (property?.toLowerCase().includes("pressuredelta")) return "pressureDelta";
  if (dimension === "scalar") return "dimensionless";
  return resolveDimensionKey(dimension);
}

function buildConfiguredConversions(
  expression: string,
  dimension: DimensionKey,
): TooltipConversion[] {
  const config = getDimensionConfig(dimension);
  const tooltipOptions = config.tooltipOptions?.length
    ? config.tooltipOptions
    : [{ unit: config.defaultUnit }];

  if (dimension === "pressure") {
    const pressureBar = convertExpr(expression, "bar").value;
    const directOptions = tooltipOptions.filter(
      ({ label, unit }) =>
        label !== "bara" && label !== "barg" && (label ?? unit) !== "atm",
    );
    const directValues =
      directOptions.length > 0
        ? batchConvertExprs(
            directOptions.map(({ unit }) => ({ expr: expression, unit })),
          )
        : [];
    let directIndex = 0;

    return tooltipOptions.flatMap(({ unit, label, decimalPlaces }) => {
      if (label === "bara") {
        return [
          { label, text: `${formatNumber(pressureBar, decimalPlaces)} bara` },
        ];
      }
      if (label === "barg") {
        return [
          {
            label,
            text: `${formatNumber(pressureBar - STANDARD_ATMOSPHERE_BAR, decimalPlaces)} barg`,
          },
        ];
      }
      if ((label ?? unit) === "atm") {
        return [
          {
            label: "atm",
            text: `${formatNumber(pressureBar / STANDARD_ATMOSPHERE_BAR, decimalPlaces)} atm`,
          },
        ];
      }

      const value = directValues[directIndex];
      directIndex += 1;
      if (value == null) return [];
      return [
        {
          label: label ?? unit,
          text: `${formatNumber(value, decimalPlaces)} ${label ?? unit}`,
        },
      ];
    });
  }

  const values = batchConvertExprs(
    tooltipOptions.map(({ unit }) => ({ expr: expression, unit })),
  );
  return tooltipOptions.flatMap(({ unit, label, decimalPlaces }, index) => {
    const value = values[index];
    if (value == null) return [];
    return [
      {
        label: label ?? unit,
        text: `${formatNumber(value, decimalPlaces)} ${label ?? unit}`,
      },
    ];
  });
}

export function getCompatibilityTooltipLines({
  expression,
  unit,
  dimension,
  property,
}: TooltipContext): string[] {
  if (!expression) {
    return unit ? [`Compatible with ${unit}`] : ["Compatible"];
  }

  try {
    const tooltipDimension = resolveTooltipDimension(dimension, property);
    if (tooltipDimension) {
      const conversions = buildConfiguredConversions(
        expression,
        tooltipDimension,
      );
      if (conversions.length > 0) {
        return conversions.map((conversion) => conversion.text);
      }
    }

    if (unit) {
      const converted = convertExpr(expression, unit);
      return [`${formatNumber(converted.value)} ${converted.unit}`];
    }
  } catch {
    // Fall back to the simple compatibility message below.
  }

  return unit ? [`Compatible with ${unit}`] : ["Compatible"];
}
