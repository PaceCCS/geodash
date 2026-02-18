const std = @import("std");
const types = @import("types.zig");
const ShapefileError = types.ShapefileError;
const BoundingBox = types.BoundingBox;
const ZRange = types.ZRange;
const PointZ = types.PointZ;
const PolyLineZ = types.PolyLineZ;
const Geometry = types.Geometry;
const ShpRecord = types.ShpRecord;

// ---------------------------------------------------------------------------
// Endian-aware read helpers (operate on a fixedBufferStream reader)
// ---------------------------------------------------------------------------

pub fn readI32Be(reader: anytype) !i32 {
    var buf: [4]u8 = undefined;
    try reader.readNoEof(&buf);
    return std.mem.readInt(i32, &buf, .big);
}

pub fn readI32Le(reader: anytype) !i32 {
    var buf: [4]u8 = undefined;
    try reader.readNoEof(&buf);
    return std.mem.readInt(i32, &buf, .little);
}

pub fn readF64Le(reader: anytype) !f64 {
    var buf: [8]u8 = undefined;
    try reader.readNoEof(&buf);
    return @bitCast(std.mem.readInt(u64, &buf, .little));
}

// ---------------------------------------------------------------------------
// Endian-aware write helpers (append into an ArrayListUnmanaged(u8))
// ---------------------------------------------------------------------------

pub fn appendI32Be(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: i32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(i32, &b, v, .big);
    try buf.appendSlice(allocator, &b);
}

pub fn appendI32Le(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: i32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(i32, &b, v, .little);
    try buf.appendSlice(allocator, &b);
}

pub fn appendF64Le(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: f64) !void {
    var b: [8]u8 = undefined;
    std.mem.writeInt(u64, &b, @bitCast(v), .little);
    try buf.appendSlice(allocator, &b);
}

// ---------------------------------------------------------------------------
// .shp header (100 bytes)
// ---------------------------------------------------------------------------

pub const ShpHeader = struct {
    file_length_words: i32,
    shape_type: i32,
    bbox: BoundingBox,
    z_range: ZRange,
    m_range: ZRange,
};

fn readHeader(reader: anytype) !ShpHeader {
    const file_code = try readI32Be(reader);
    if (file_code != 9994) return ShapefileError.InvalidFileCode;

    var skip: [20]u8 = undefined;
    try reader.readNoEof(&skip);

    const file_length_words = try readI32Be(reader);
    const version = try readI32Le(reader);
    if (version != 1000) return ShapefileError.InvalidVersion;

    const shape_type = try readI32Le(reader);

    return ShpHeader{
        .file_length_words = file_length_words,
        .shape_type = shape_type,
        .bbox = BoundingBox{
            .min_x = try readF64Le(reader),
            .min_y = try readF64Le(reader),
            .max_x = try readF64Le(reader),
            .max_y = try readF64Le(reader),
        },
        .z_range = ZRange{
            .min = try readF64Le(reader),
            .max = try readF64Le(reader),
        },
        .m_range = ZRange{
            .min = try readF64Le(reader),
            .max = try readF64Le(reader),
        },
    };
}

fn appendHeader(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, header: ShpHeader) !void {
    try appendI32Be(buf, allocator, 9994);
    try buf.appendNTimes(allocator, 0, 20);
    try appendI32Be(buf, allocator, header.file_length_words);
    try appendI32Le(buf, allocator, 1000);
    try appendI32Le(buf, allocator, header.shape_type);
    try appendF64Le(buf, allocator, header.bbox.min_x);
    try appendF64Le(buf, allocator, header.bbox.min_y);
    try appendF64Le(buf, allocator, header.bbox.max_x);
    try appendF64Le(buf, allocator, header.bbox.max_y);
    try appendF64Le(buf, allocator, header.z_range.min);
    try appendF64Le(buf, allocator, header.z_range.max);
    try appendF64Le(buf, allocator, header.m_range.min);
    try appendF64Le(buf, allocator, header.m_range.max);
}

// ---------------------------------------------------------------------------
// PointZ (shape type 11)  — content: 4 (type) + 32 (xyzm) = 36 bytes = 18 words
// ---------------------------------------------------------------------------

fn readPointZ(reader: anytype) !PointZ {
    return PointZ{
        .x = try readF64Le(reader),
        .y = try readF64Le(reader),
        .z = try readF64Le(reader),
        .m = try readF64Le(reader),
    };
}

fn appendPointZContent(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, p: PointZ) !void {
    try appendI32Le(buf, allocator, 11);
    try appendF64Le(buf, allocator, p.x);
    try appendF64Le(buf, allocator, p.y);
    try appendF64Le(buf, allocator, p.z);
    try appendF64Le(buf, allocator, p.m);
}

// ---------------------------------------------------------------------------
// PolyLineZ (shape type 13)
// ---------------------------------------------------------------------------

fn readPolyLineZ(allocator: std.mem.Allocator, reader: anytype) !PolyLineZ {
    const bbox = BoundingBox{
        .min_x = try readF64Le(reader),
        .min_y = try readF64Le(reader),
        .max_x = try readF64Le(reader),
        .max_y = try readF64Le(reader),
    };

    const num_parts: u32 = @intCast(try readI32Le(reader));
    const num_points: u32 = @intCast(try readI32Le(reader));

    const parts = try allocator.alloc(u32, num_parts);
    errdefer allocator.free(parts);
    for (parts) |*p| p.* = @intCast(try readI32Le(reader));

    const points = try allocator.alloc([2]f64, num_points);
    errdefer allocator.free(points);
    for (points) |*pt| {
        pt[0] = try readF64Le(reader);
        pt[1] = try readF64Le(reader);
    }

    const z_range = ZRange{ .min = try readF64Le(reader), .max = try readF64Le(reader) };

    const z = try allocator.alloc(f64, num_points);
    errdefer allocator.free(z);
    for (z) |*v| v.* = try readF64Le(reader);

    const m_range = ZRange{ .min = try readF64Le(reader), .max = try readF64Le(reader) };

    const m = try allocator.alloc(f64, num_points);
    errdefer allocator.free(m);
    for (m) |*v| v.* = try readF64Le(reader);

    return PolyLineZ{
        .bbox = bbox,
        .parts = parts,
        .points = points,
        .z_range = z_range,
        .z = z,
        .m_range = m_range,
        .m = m,
    };
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

/// Read all records from a .shp file.
/// Caller owns the returned slice. Free PolyLineZ sub-slices with
/// geometry.poly_line_z.deinit(allocator) before freeing the slice.
pub fn read(allocator: std.mem.Allocator, path: []const u8) ![]ShpRecord {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    // Read whole file into memory (max 512 MiB).
    const data = try file.readToEndAlloc(allocator, 512 * 1024 * 1024);
    defer allocator.free(data);

    var stream = std.io.fixedBufferStream(data);
    const reader = stream.reader();

    _ = try readHeader(reader);

    var records: std.ArrayListUnmanaged(ShpRecord) = .{};
    errdefer {
        for (records.items) |rec| {
            if (rec.geometry == .poly_line_z) rec.geometry.poly_line_z.deinit(allocator);
        }
        records.deinit(allocator);
    }

    while (true) {
        // Record header: 8 bytes, big-endian
        var rec_num_buf: [4]u8 = undefined;
        const n = reader.readAll(&rec_num_buf) catch break;
        if (n < 4) break;
        const record_number: u32 = @intCast(std.mem.readInt(i32, &rec_num_buf, .big));

        // content length in 16-bit words (not used directly here)
        var content_len_buf: [4]u8 = undefined;
        try reader.readNoEof(&content_len_buf);

        // Shape type (little-endian, first 4 bytes of content)
        const shape_type = try readI32Le(reader);

        const geometry: Geometry = switch (shape_type) {
            11 => .{ .point_z = try readPointZ(reader) },
            13 => .{ .poly_line_z = try readPolyLineZ(allocator, reader) },
            else => return ShapefileError.UnsupportedShapeType,
        };

        try records.append(allocator, ShpRecord{
            .number = record_number,
            .geometry = geometry,
        });
    }

    return records.toOwnedSlice(allocator);
}

/// Read and return the raw WKT string from a .prj file. Caller owns the slice.
pub fn readPrj(allocator: std.mem.Allocator, path: []const u8) ![]u8 {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();
    return file.readToEndAlloc(allocator, 64 * 1024);
}

// ---------------------------------------------------------------------------
// Public write API
// ---------------------------------------------------------------------------

/// Write records to a .shp file. Optionally also writes the .shx index.
/// All records must have the same geometry type (MixedShapeTypes is returned otherwise).
pub fn write(
    shp_path: []const u8,
    shx_path: ?[]const u8,
    allocator: std.mem.Allocator,
    records: []const ShpRecord,
) !void {
    // Determine uniform shape type
    var global_shape_type: i32 = 0;
    for (records) |rec| {
        const st: i32 = switch (rec.geometry) {
            .point_z => 11,
            .poly_line_z => 13,
        };
        if (global_shape_type == 0) {
            global_shape_type = st;
        } else if (global_shape_type != st) {
            return ShapefileError.MixedShapeTypes;
        }
    }

    // shx index entries collected during writing
    var shx_offsets: std.ArrayListUnmanaged(i32) = .{};
    defer shx_offsets.deinit(allocator);
    var shx_lengths: std.ArrayListUnmanaged(i32) = .{};
    defer shx_lengths.deinit(allocator);

    // Build .shp in memory
    var shp_buf: std.ArrayListUnmanaged(u8) = .{};
    defer shp_buf.deinit(allocator);

    // Reserve 100 bytes for header (will be patched later)
    try shp_buf.appendNTimes(allocator, 0, 100);

    var bbox = BoundingBox{
        .min_x = std.math.inf(f64),
        .min_y = std.math.inf(f64),
        .max_x = -std.math.inf(f64),
        .max_y = -std.math.inf(f64),
    };
    var z_min: f64 = std.math.inf(f64);
    var z_max: f64 = -std.math.inf(f64);

    for (records) |rec| {
        const content_start: i32 = @intCast(shp_buf.items.len);
        const offset_words: i32 = @intCast(content_start / 2);

        switch (rec.geometry) {
            .point_z => |p| {
                // Record header: number (4) + content_length=18 (4)
                try appendI32Be(&shp_buf, allocator, @intCast(rec.number));
                try appendI32Be(&shp_buf, allocator, 18);
                try appendPointZContent(&shp_buf, allocator, p);

                bbox.min_x = @min(bbox.min_x, p.x);
                bbox.min_y = @min(bbox.min_y, p.y);
                bbox.max_x = @max(bbox.max_x, p.x);
                bbox.max_y = @max(bbox.max_y, p.y);
                z_min = @min(z_min, p.z);
                z_max = @max(z_max, p.z);

                try shx_offsets.append(allocator, offset_words);
                try shx_lengths.append(allocator, 18);
            },
            .poly_line_z => |pl| {
                const np: i32 = @intCast(pl.parts.len);
                const npt: i32 = @intCast(pl.points.len);
                const content_bytes: i32 = 4 + 32 + 4 + 4 + np * 4 + npt * 16 + 16 + npt * 8 + 16 + npt * 8;
                const content_words: i32 = content_bytes / 2;

                try appendI32Be(&shp_buf, allocator, @intCast(rec.number));
                try appendI32Be(&shp_buf, allocator, content_words);
                try appendI32Le(&shp_buf, allocator, 13);
                try appendF64Le(&shp_buf, allocator, pl.bbox.min_x);
                try appendF64Le(&shp_buf, allocator, pl.bbox.min_y);
                try appendF64Le(&shp_buf, allocator, pl.bbox.max_x);
                try appendF64Le(&shp_buf, allocator, pl.bbox.max_y);
                try appendI32Le(&shp_buf, allocator, np);
                try appendI32Le(&shp_buf, allocator, npt);
                for (pl.parts) |p| try appendI32Le(&shp_buf, allocator, @intCast(p));
                for (pl.points) |pt| {
                    try appendF64Le(&shp_buf, allocator, pt[0]);
                    try appendF64Le(&shp_buf, allocator, pt[1]);
                }
                try appendF64Le(&shp_buf, allocator, pl.z_range.min);
                try appendF64Le(&shp_buf, allocator, pl.z_range.max);
                for (pl.z) |v| try appendF64Le(&shp_buf, allocator, v);
                try appendF64Le(&shp_buf, allocator, pl.m_range.min);
                try appendF64Le(&shp_buf, allocator, pl.m_range.max);
                for (pl.m) |v| try appendF64Le(&shp_buf, allocator, v);

                bbox.min_x = @min(bbox.min_x, pl.bbox.min_x);
                bbox.min_y = @min(bbox.min_y, pl.bbox.min_y);
                bbox.max_x = @max(bbox.max_x, pl.bbox.max_x);
                bbox.max_y = @max(bbox.max_y, pl.bbox.max_y);
                z_min = @min(z_min, pl.z_range.min);
                z_max = @max(z_max, pl.z_range.max);

                try shx_offsets.append(allocator, offset_words);
                try shx_lengths.append(allocator, content_words);
            },
        }
    }

    // Patch header in-place at offset 0
    const total_words: i32 = @intCast(shp_buf.items.len / 2);
    const effective_bbox = if (records.len > 0) bbox else BoundingBox{ .min_x = 0, .min_y = 0, .max_x = 0, .max_y = 0 };
    const hdr = ShpHeader{
        .file_length_words = total_words,
        .shape_type = global_shape_type,
        .bbox = effective_bbox,
        .z_range = ZRange{ .min = z_min, .max = z_max },
        .m_range = ZRange{ .min = 0, .max = 0 },
    };
    // Write header into a temp buffer and copy to start of shp_buf
    var hdr_buf: std.ArrayListUnmanaged(u8) = .{};
    defer hdr_buf.deinit(allocator);
    try appendHeader(&hdr_buf, allocator, hdr);
    @memcpy(shp_buf.items[0..100], hdr_buf.items[0..100]);

    // Write .shp
    const shp_file = try std.fs.cwd().createFile(shp_path, .{});
    defer shp_file.close();
    try shp_file.writeAll(shp_buf.items);

    // Write .shx if requested
    if (shx_path) |sx| {
        var shx_buf: std.ArrayListUnmanaged(u8) = .{};
        defer shx_buf.deinit(allocator);

        const shx_words: i32 = @intCast((100 + records.len * 8) / 2);
        const shx_hdr = ShpHeader{
            .file_length_words = shx_words,
            .shape_type = global_shape_type,
            .bbox = effective_bbox,
            .z_range = hdr.z_range,
            .m_range = hdr.m_range,
        };
        try appendHeader(&shx_buf, allocator, shx_hdr);

        for (shx_offsets.items, shx_lengths.items) |off, len| {
            try appendI32Be(&shx_buf, allocator, off);
            try appendI32Be(&shx_buf, allocator, len);
        }

        const shx_file = try std.fs.cwd().createFile(sx, .{});
        defer shx_file.close();
        try shx_file.writeAll(shx_buf.items);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test "shp round-trip PointZ" {
    const allocator = std.testing.allocator;

    // Build a minimal in-memory .shp with two PointZ records.
    var buf: std.ArrayListUnmanaged(u8) = .{};
    defer buf.deinit(allocator);

    // Header
    try appendI32Be(&buf, allocator, 9994);
    try buf.appendNTimes(allocator, 0, 20);
    // file length: 100 header + 2×44 = 188 bytes → 94 words
    try appendI32Be(&buf, allocator, 94);
    try appendI32Le(&buf, allocator, 1000);
    try appendI32Le(&buf, allocator, 11);
    // bbox (8 × f64 = 64 bytes)
    try buf.appendNTimes(allocator, 0, 64);

    // Record 1
    try appendI32Be(&buf, allocator, 1);
    try appendI32Be(&buf, allocator, 18);
    try appendPointZContent(&buf, allocator, PointZ{ .x = 491542.058, .y = 5918507.093, .z = 10.5, .m = 0.0 });

    // Record 2
    try appendI32Be(&buf, allocator, 2);
    try appendI32Be(&buf, allocator, 18);
    try appendPointZContent(&buf, allocator, PointZ{ .x = 491600.0, .y = 5918600.0, .z = 11.0, .m = 0.0 });

    // Parse
    var stream = std.io.fixedBufferStream(buf.items);
    const r = stream.reader();

    const hdr = try readHeader(r);
    try std.testing.expectEqual(@as(i32, 11), hdr.shape_type);

    // Record 1
    var rec_num_buf: [4]u8 = undefined;
    _ = try r.readAll(&rec_num_buf);
    const rn1 = std.mem.readInt(i32, &rec_num_buf, .big);
    var content_len_buf: [4]u8 = undefined;
    try r.readNoEof(&content_len_buf);
    const st1 = try readI32Le(r);
    const p1 = try readPointZ(r);

    try std.testing.expectEqual(@as(i32, 1), rn1);
    try std.testing.expectEqual(@as(i32, 11), st1);
    try std.testing.expectApproxEqAbs(@as(f64, 491542.058), p1.x, 1e-6);
    try std.testing.expectApproxEqAbs(@as(f64, 5918507.093), p1.y, 1e-6);
}
