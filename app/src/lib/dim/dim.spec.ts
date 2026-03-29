import { beforeAll, describe, expect, it, test } from "bun:test";
import dim, {
  batchConvertExprs,
  batchConvertValues,
  checkUnitCompatibility,
  checkDimensionalCompatibility,
  evalStructured,
  getBaseUnit,
} from "./dim";

beforeAll(async () => {
  await dim.init();
});

describe("dim wasm", () => {
  it("evaluates operations with units", () => {
    expect(dim.eval("2 m * 3 m")).toBe("6 m²");
    expect(dim.eval("(9 m^2)^0.5")).toBe("3 m");
    expect(dim.eval("18 m / 3 s")).toBe("6 m/s");
    expect(dim.eval("18 kJ / 3 kg as J/kg")).toBe("6000 J/kg");
    expect(dim.eval("18 kJ / 3 kg as kJ/kg")).toBe("6 kJ/kg");
    expect(dim.eval("0.5 kW * 36 s / 3 kg as kJ/kg")).toBe("6 kJ/kg");
  });

  it("evaluates identity", () => {
    expect(dim.eval("1 m")).toBe("1 m");
    expect(dim.eval("0.1234567 m")).toBe("0.1234567 m");
    expect(dim.eval("0.1234567 m as m:auto")).toBe("0.123 m");
  });

  it("defines constant and evaluates cast", () => {
    dim.defineConst("c", "299792458 m/s");
    expect(dim.eval("1 c as m/s")).toBe("299792458 m/s");
    expect(dim.eval("10 m/s as c:scientific")).toBe("3.336e-8 c");
  });
});

describe("space-separated number sequences", () => {
  it("rejects bare space-separated numbers", () => {
    expect(() => dim.eval("3 2 5 8 9")).toThrow();
    expect(() => dim.eval("1 2 3 4 5")).toThrow();
    expect(() => dim.eval("1 2")).toThrow();
  });

  it("treats them as incompatible with any unit", () => {
    expect(checkUnitCompatibility("1 2 3 4 5", "kg/m^3")).toBe(false);
    expect(checkUnitCompatibility("3 2 5 8 9", "m/s")).toBe(false);
  });
});

describe("unit compatibility (one expression, one unit)", () => {
  test("m -> other", () => {
    expect(checkUnitCompatibility("1 m", "m")).toBe(true);
    expect(checkUnitCompatibility("1 mm", "mi")).toBe(true);
    expect(checkUnitCompatibility("1 m", "C")).toBe(false);
    expect(checkUnitCompatibility("1 m", "m/s")).toBe(false);
  });

  test("supports mtpa mass flow", () => {
    expect(checkUnitCompatibility("1 MTPA", "MTPA")).toBe(true);
  });

  test("supports scientific notation with units", () => {
    expect(checkUnitCompatibility("1.43567576391605e-5 Pa·s", "Pa·s")).toBe(
      true,
    );
  });
});

describe("dimensional compatibility (two expressions)", () => {
  test("m -> other", () => {
    expect(checkDimensionalCompatibility("1 m", "1 m")).toBe(true);
    expect(checkDimensionalCompatibility("1 km", "1 ft")).toBe(true);
    expect(checkDimensionalCompatibility("1 m", "1 C")).toBe(false);
    expect(checkDimensionalCompatibility("1 m", "1 m/s")).toBe(false);
  });
});

describe("get base unit", () => {
  test("m", () => {
    expect(getBaseUnit("1 m")).toBe("m");
    expect(getBaseUnit("1 yd")).toBe("m");
    expect(getBaseUnit("1 km")).toBe("m");
  });

  test("compound and rational dimensions", () => {
    expect(getBaseUnit("18 m / 3 s")).toBe("m/s");
    expect(getBaseUnit("1 Pa^0.5")).toBe("kg^(1/2)*m^(-1/2)*s^(-1)");
  });
});

describe("convert expression to unit", () => {
  test("m -> km", () => {
    expect(dim.convert("1 m", "km")).toBe("0.001 km");
    expect(dim.convert("1 C", "F")).toBe("33.7999999999999 F");
  });

  test("scientific notation viscosity", () => {
    expect(dim.convert("1.43567576391605e-5 Pa·s", "Pa·s")).toBe(
      "0.0000143567576391605 Pa*s",
    );
  });
});

describe("convert value to unit", () => {
  test("m -> km", () => {
    expect(dim.convertValue(1, "m", "km")).toBe(0.001);
    expect(dim.convertValue(1, "C", "F")).toBe(33.7999999999999);
  });
});

describe("structured and batched APIs", () => {
  test("evalStructured returns quantity metadata", () => {
    const result = evalStructured("18 kJ / 3 kg as kJ/kg");
    expect(result.kind).toBe("quantity");
    if (result.kind !== "quantity") return;
    expect(result.value).toBe(6);
    expect(result.unit).toBe("kJ/kg");
    expect(result.dim.L).toEqual({ num: 2, den: 1 });
    expect(result.dim.T).toEqual({ num: -2, den: 1 });
  });

  test("evalStructured preserves rational dimensions", () => {
    const result = evalStructured("(9 m)^0.5");
    expect(result.kind).toBe("quantity");
    if (result.kind !== "quantity") return;
    expect(result.value).toBe(3);
    expect(result.unit).toBe("m^(1/2)");
    expect(result.dim.L).toEqual({ num: 1, den: 2 });
    expect(result.dim.M).toEqual({ num: 0, den: 1 });
  });

  test("batch conversions return numeric results", () => {
    expect(
      batchConvertExprs([
        { expr: "18 kJ / 3 kg", unit: "kJ/kg" },
        { expr: "1 m", unit: "km" },
      ]),
    ).toEqual([6, 0.001]);

    expect(
      batchConvertValues([
        { value: 1, fromUnit: "m", toUnit: "km" },
        { value: 1000, fromUnit: "Pa", toUnit: "bar" },
      ]),
    ).toEqual([0.001, 0.01]);
  });
});
