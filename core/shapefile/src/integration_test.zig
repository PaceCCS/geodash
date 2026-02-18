const std = @import("std");
const shp = @import("shp.zig");
const shx = @import("shx.zig");
const dbf = @import("dbf.zig");
const kp = @import("kp.zig");
const types = @import("types.zig");

const spirit_shp = "test-data/spirit/KP_Points_1m.shp";
const spirit_shx = "test-data/spirit/KP_Points_1m.shx";
const spirit_dbf = "test-data/spirit/KP_Points_1m.dbf";
const spirit_prj = "test-data/spirit/KP_Points_1m.prj";

test "spirit: record count = 65883" {
    const allocator = std.testing.allocator;

    const records = try shp.read(allocator, spirit_shp);
    defer {
        for (records) |rec| {
            if (rec.geometry == .poly_line_z) rec.geometry.poly_line_z.deinit(allocator);
        }
        allocator.free(records);
    }

    try std.testing.expectEqual(@as(usize, 65_883), records.len);
}

test "spirit: first point coordinates" {
    const allocator = std.testing.allocator;

    const records = try shp.read(allocator, spirit_shp);
    defer {
        for (records) |rec| {
            if (rec.geometry == .poly_line_z) rec.geometry.poly_line_z.deinit(allocator);
        }
        allocator.free(records);
    }

    try std.testing.expect(records.len > 0);
    const first = records[0].geometry.point_z;
    try std.testing.expectApproxEqAbs(@as(f64, 491542.058), first.x, 0.01);
    try std.testing.expectApproxEqAbs(@as(f64, 5918507.093), first.y, 0.01);
}

test "spirit: final KP ≈ 65.88 km" {
    const allocator = std.testing.allocator;

    const records = try shp.read(allocator, spirit_shp);
    defer {
        for (records) |rec| {
            if (rec.geometry == .poly_line_z) rec.geometry.poly_line_z.deinit(allocator);
        }
        allocator.free(records);
    }

    // Extract PointZ slice for KP computation
    const pts = try allocator.alloc(types.PointZ, records.len);
    defer allocator.free(pts);
    for (records, pts) |rec, *pt| {
        pt.* = rec.geometry.point_z;
    }

    const kp_points = try kp.computeKp(allocator, pts);
    defer allocator.free(kp_points);

    const final_kp = kp_points[kp_points.len - 1].kp_km;
    try std.testing.expectApproxEqAbs(@as(f64, 65.88), final_kp, 0.01);
}

test "spirit: shx record count matches shp" {
    const allocator = std.testing.allocator;

    const index = try shx.read(allocator, spirit_shx);
    defer index.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 65_883), index.records.len);
}

test "spirit: PRJ contains ED_1950_UTM_Zone_30N" {
    const allocator = std.testing.allocator;

    const wkt = try shp.readPrj(allocator, spirit_prj);
    defer allocator.free(wkt);

    const found = std.mem.indexOf(u8, wkt, "ED_1950_UTM_Zone_30N") != null;
    if (!found) {
        std.debug.print("PRJ content: {s}\n", .{wkt});
    }
    try std.testing.expect(found);
}

test "spirit: dbf record count = 65883" {
    const allocator = std.testing.allocator;

    const table = try dbf.read(allocator, spirit_dbf);
    defer table.deinit(allocator);

    try std.testing.expectEqual(@as(u32, 65_883), table.header.record_count);
    try std.testing.expectEqual(@as(usize, 65_883), table.records.len);
}
