const std = @import("std");
const types = @import("types.zig");
const PointZ = types.PointZ;

pub const KpPoint = struct {
    x: f64,
    y: f64,
    z: f64,
    /// Cumulative 2D Euclidean distance from the first point, in kilometres.
    kp_km: f64,
};

/// Compute kilometre post (KP) values for a sequence of PointZ records.
///
/// Distance is 2D only (XY plane), matching bathymetry-tool behaviour.
/// The input CRS must use metres as the linear unit for KP to be meaningful.
///
/// Returns a slice owned by the caller; free with allocator.free().
pub fn computeKp(allocator: std.mem.Allocator, points: []const PointZ) ![]KpPoint {
    const result = try allocator.alloc(KpPoint, points.len);
    errdefer allocator.free(result);

    var cumulative_m: f64 = 0.0;
    for (points, result, 0..) |pt, *kp_pt, idx| {
        if (idx > 0) {
            const prev = points[idx - 1];
            const dx = pt.x - prev.x;
            const dy = pt.y - prev.y;
            cumulative_m += @sqrt(dx * dx + dy * dy);
        }
        kp_pt.* = KpPoint{
            .x = pt.x,
            .y = pt.y,
            .z = pt.z,
            .kp_km = cumulative_m / 1000.0,
        };
    }

    return result;
}

test "kp empty" {
    const allocator = std.testing.allocator;
    const result = try computeKp(allocator, &.{});
    defer allocator.free(result);
    try std.testing.expectEqual(@as(usize, 0), result.len);
}

test "kp single point" {
    const allocator = std.testing.allocator;
    const pts = [_]PointZ{.{ .x = 100.0, .y = 200.0, .z = 5.0, .m = 0.0 }};
    const result = try computeKp(allocator, &pts);
    defer allocator.free(result);
    try std.testing.expectEqual(@as(usize, 1), result.len);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), result[0].kp_km, 1e-9);
}

test "kp two points 1000m apart" {
    const allocator = std.testing.allocator;
    const pts = [_]PointZ{
        .{ .x = 0.0, .y = 0.0, .z = 0.0, .m = 0.0 },
        .{ .x = 1000.0, .y = 0.0, .z = 0.0, .m = 0.0 },
    };
    const result = try computeKp(allocator, &pts);
    defer allocator.free(result);
    try std.testing.expectEqual(@as(usize, 2), result.len);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), result[0].kp_km, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 1.0), result[1].kp_km, 1e-9);
}

test "kp ignores z for distance" {
    const allocator = std.testing.allocator;
    // Two points 3-4-5 triangle in XY, big z difference — still 5m
    const pts = [_]PointZ{
        .{ .x = 0.0, .y = 0.0, .z = 0.0, .m = 0.0 },
        .{ .x = 3.0, .y = 4.0, .z = 1000.0, .m = 0.0 },
    };
    const result = try computeKp(allocator, &pts);
    defer allocator.free(result);
    try std.testing.expectApproxEqAbs(@as(f64, 0.005), result[1].kp_km, 1e-9);
}
