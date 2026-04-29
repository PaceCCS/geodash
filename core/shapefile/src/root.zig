const std = @import("std");

pub const types = @import("types.zig");
pub const shp = @import("shp.zig");
pub const shx = @import("shx.zig");
pub const dbf = @import("dbf.zig");
pub const kp = @import("kp.zig");
pub const kml = @import("kml.zig");

pub const BoundingBox = types.BoundingBox;
pub const ZRange = types.ZRange;
pub const PointZ = types.PointZ;
pub const PolyLineZ = types.PolyLineZ;

fn defaultIo() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}
pub const Geometry = types.Geometry;
pub const ShpRecord = types.ShpRecord;
pub const DbfField = types.DbfField;
pub const DbfValue = types.DbfValue;
pub const Attributes = types.Attributes;
pub const ShapefileError = types.ShapefileError;

pub const KpPoint = kp.KpPoint;
pub const computeKp = kp.computeKp;

// Readers
pub const readShp = shp.read;
pub const readShx = shx.read;
pub const readDbf = dbf.read;
pub const readPrj = shp.readPrj;
pub const readKml = kml.read;
pub const readKmlFromBytes = kml.readFromBytes;

// Writers
pub const writeShp = shp.write;
pub const writeDbf = dbf.write;
pub const writePrj = shp.writePrj;

// In-memory I/O (for WASM — no file paths)
pub const readShpFromBytes = shp.readFromBytes;
pub const readDbfFromBytes = dbf.readFromBytes;
pub const buildSHPBytes = shp.buildSHPBytes;
pub const buildSHXBytes = shp.buildSHXBytes;
pub const buildDBFBytes = dbf.buildBytes;

/// Write a complete shapefile set from a path stem.
///
/// Given stem="/path/to/output", writes:
///   output.shp + output.shx  (geometry + spatial index)
///   output.dbf               (attribute table)
///   output.prj               (CRS WKT, only if wkt != null)
///
/// `records`  — geometry records (all same shape type)
/// `fields`   — DBF field descriptors
/// `rows`     — one row per record; each row must have fields.len values
/// `wkt`      — WKT CRS string, or null to skip writing .prj
pub fn writeShapefile(
    stem: []const u8,
    allocator: std.mem.Allocator,
    records: []const ShpRecord,
    fields: []const DbfField,
    rows: []const []const DbfValue,
    wkt: ?[]const u8,
) !void {
    const shp_path = try std.fmt.allocPrint(allocator, "{s}.shp", .{stem});
    defer allocator.free(shp_path);
    const shx_path = try std.fmt.allocPrint(allocator, "{s}.shx", .{stem});
    defer allocator.free(shx_path);
    const dbf_path = try std.fmt.allocPrint(allocator, "{s}.dbf", .{stem});
    defer allocator.free(dbf_path);

    try shp.write(shp_path, shx_path, allocator, records);
    try dbf.write(dbf_path, allocator, fields, rows);

    if (wkt) |w| {
        const prj_path = try std.fmt.allocPrint(allocator, "{s}.prj", .{stem});
        defer allocator.free(prj_path);
        try shp.writePrj(prj_path, w);
    }
}

test {
    _ = @import("types.zig");
    _ = @import("shx.zig");
    _ = @import("shp.zig");
    _ = @import("dbf.zig");
    _ = @import("kp.zig");
    _ = @import("kml.zig");
    _ = @import("integration_test.zig");
}

test "writeShapefile round-trip" {
    const allocator = std.testing.allocator;

    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();
    const tmp_path = try tmp_dir.dir.realPathFileAlloc(defaultIo(), ".", allocator);
    defer allocator.free(tmp_path);

    const stem = try std.fmt.allocPrint(allocator, "{s}/route", .{tmp_path});
    defer allocator.free(stem);

    // Two PointZ records
    const records = [_]ShpRecord{
        .{ .number = 1, .geometry = .{ .point_z = .{ .x = 100.0, .y = 200.0, .z = 10.0, .m = 0.0 } } },
        .{ .number = 2, .geometry = .{ .point_z = .{ .x = 101.0, .y = 201.0, .z = 11.0, .m = 0.0 } } },
    };

    // One string field: "LABEL" (length 8)
    var fname: [11]u8 = .{0} ** 11;
    @memcpy(fname[0..5], "LABEL");
    const fields = [_]DbfField{.{ .name = fname, .field_type = 'C', .length = 8, .decimal_count = 0 }};

    const row0 = [_]DbfValue{.{ .string = "A" }};
    const row1 = [_]DbfValue{.{ .string = "B" }};
    const rows = [_][]const DbfValue{ &row0, &row1 };

    const wkt = "GEOGCS[\"WGS 84\"]";

    try writeShapefile(stem, allocator, &records, &fields, &rows, wkt);

    // Verify .shp
    const shp_path = try std.fmt.allocPrint(allocator, "{s}.shp", .{stem});
    defer allocator.free(shp_path);
    const read_records = try readShp(allocator, shp_path);
    defer allocator.free(read_records);
    try std.testing.expectEqual(@as(usize, 2), read_records.len);
    try std.testing.expectApproxEqAbs(@as(f64, 100.0), read_records[0].geometry.point_z.x, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 11.0), read_records[1].geometry.point_z.z, 1e-9);

    // Verify .dbf
    const dbf_path = try std.fmt.allocPrint(allocator, "{s}.dbf", .{stem});
    defer allocator.free(dbf_path);
    const dbf_file = try readDbf(allocator, dbf_path);
    defer dbf_file.deinit(allocator);
    try std.testing.expectEqual(@as(u32, 2), dbf_file.header.record_count);
    try std.testing.expectEqualStrings("A", dbf_file.records[0][0].string);
    try std.testing.expectEqualStrings("B", dbf_file.records[1][0].string);

    // Verify .prj
    const prj_path = try std.fmt.allocPrint(allocator, "{s}.prj", .{stem});
    defer allocator.free(prj_path);
    const read_wkt = try readPrj(allocator, prj_path);
    defer allocator.free(read_wkt);
    try std.testing.expectEqualStrings(wkt, read_wkt);
}
