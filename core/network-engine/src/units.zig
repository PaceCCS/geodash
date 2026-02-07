const std = @import("std");
const dim = @import("dim");

/// A parsed physical quantity with its canonical SI value and dimension.
pub const ParsedQuantity = struct {
    /// Value in canonical SI units (e.g. Pa for pressure, K for temperature)
    si_value: f64,
    /// Physical dimension (length, mass, time, etc.)
    dimension: dim.Dimension,
    /// The original unit symbol (e.g. "bar", "kg/s")
    display_unit: []const u8,
    /// The original numeric value before conversion
    raw_value: f64,
};

/// Try to parse a string as a "number unit" quantity (e.g. "120 bar", "-3.5 C", "1.23e4 Pa").
/// Returns null if the string doesn't match the expected pattern or the unit is not recognized.
pub fn tryParseQuantity(str: []const u8) ?ParsedQuantity {
    const trimmed = std.mem.trim(u8, str, " \t\r\n");
    if (trimmed.len == 0) return null;

    // Find where the number ends and the unit begins.
    // The number can contain digits, '.', '-', '+', 'e', 'E'.
    const split = splitNumberUnit(trimmed) orelse return null;

    const number = std.fmt.parseFloat(f64, split.number) catch return null;
    const unit_str = std.mem.trim(u8, split.unit, " \t");
    if (unit_str.len == 0) return null;

    const unit = dim.findUnitAll(unit_str) orelse return null;

    return .{
        .si_value = unit.toCanonical(number),
        .dimension = unit.dim,
        .display_unit = unit_str,
        .raw_value = number,
    };
}

const NumberUnit = struct {
    number: []const u8,
    unit: []const u8,
};

/// Split "120 bar" into { "120", "bar" }.
/// Handles: integers, decimals, negative, scientific notation.
fn splitNumberUnit(str: []const u8) ?NumberUnit {
    var i: usize = 0;

    // Optional leading sign
    if (i < str.len and (str[i] == '-' or str[i] == '+')) i += 1;

    // Must have at least one digit
    const digit_start = i;
    while (i < str.len and std.ascii.isDigit(str[i])) i += 1;
    if (i == digit_start) return null; // no digits found

    // Optional decimal part
    if (i < str.len and str[i] == '.') {
        i += 1;
        while (i < str.len and std.ascii.isDigit(str[i])) i += 1;
    }

    // Optional exponent
    if (i < str.len and (str[i] == 'e' or str[i] == 'E')) {
        i += 1;
        if (i < str.len and (str[i] == '-' or str[i] == '+')) i += 1;
        while (i < str.len and std.ascii.isDigit(str[i])) i += 1;
    }

    if (i >= str.len) return null; // number only, no unit

    return .{
        .number = str[0..i],
        .unit = str[i..],
    };
}

// --- Tests ---

const testing = std.testing;

test "parse simple pressure" {
    const result = tryParseQuantity("120 bar") orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(@as(f64, 12_000_000.0), result.si_value, 1.0);
    try testing.expect(result.dimension.eql(dim.DIM.Pressure));
    try testing.expectEqualStrings("bar", result.display_unit);
    try testing.expectApproxEqAbs(@as(f64, 120.0), result.raw_value, 1e-9);
}

test "parse with decimal" {
    const result = tryParseQuantity("1.5 km") orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(@as(f64, 1500.0), result.si_value, 1e-9);
    try testing.expect(result.dimension.eql(dim.DIM.Length));
    try testing.expectEqualStrings("km", result.display_unit);
}

test "parse negative value" {
    const result = tryParseQuantity("-10 m") orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(@as(f64, -10.0), result.si_value, 1e-9);
    try testing.expect(result.dimension.eql(dim.DIM.Length));
}

test "parse scientific notation" {
    const result = tryParseQuantity("1.5e3 Pa") orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(@as(f64, 1500.0), result.si_value, 1e-9);
    try testing.expect(result.dimension.eql(dim.DIM.Pressure));
}

test "parse no space between number and unit" {
    const result = tryParseQuantity("100kg") orelse return error.TestUnexpectedResult;
    try testing.expectApproxEqAbs(@as(f64, 100.0), result.si_value, 1e-9);
    try testing.expect(result.dimension.eql(dim.DIM.Mass));
}

test "returns null for plain string" {
    try testing.expect(tryParseQuantity("Source") == null);
    try testing.expect(tryParseQuantity("hello world") == null);
    try testing.expect(tryParseQuantity("") == null);
}

test "returns null for unknown unit" {
    try testing.expect(tryParseQuantity("120 frobnicators") == null);
}

test "returns null for number only" {
    try testing.expect(tryParseQuantity("120") == null);
    try testing.expect(tryParseQuantity("3.14") == null);
}
