const std = @import("std");
const types = @import("types.zig");
const ShapefileError = types.ShapefileError;

pub const ShxRecord = struct {
    /// Byte offset in .shp file divided by 2 (16-bit words from file start).
    offset: u32,
    /// Content length in 16-bit words (same as .shp record header field).
    length: u32,
};

pub const ShxHeader = struct {
    shape_type: i32,
    bbox_x_min: f64,
    bbox_y_min: f64,
    bbox_x_max: f64,
    bbox_y_max: f64,
    z_min: f64,
    z_max: f64,
    m_min: f64,
    m_max: f64,
};

pub const ShxFile = struct {
    header: ShxHeader,
    records: []ShxRecord,

    pub fn deinit(self: ShxFile, allocator: std.mem.Allocator) void {
        allocator.free(self.records);
    }
};

// ---------------------------------------------------------------------------
// Endian-aware read helpers (operate on a fixedBufferStream reader)
// ---------------------------------------------------------------------------

fn readI32Be(reader: anytype) !i32 {
    var buf: [4]u8 = undefined;
    try reader.readNoEof(&buf);
    return std.mem.readInt(i32, &buf, .big);
}

fn readI32Le(reader: anytype) !i32 {
    var buf: [4]u8 = undefined;
    try reader.readNoEof(&buf);
    return std.mem.readInt(i32, &buf, .little);
}

fn readF64Le(reader: anytype) !f64 {
    var buf: [8]u8 = undefined;
    try reader.readNoEof(&buf);
    return @bitCast(std.mem.readInt(u64, &buf, .little));
}

// ---------------------------------------------------------------------------
// Endian-aware write helpers (write into an ArrayListUnmanaged(u8))
// ---------------------------------------------------------------------------

fn appendI32Be(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: i32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(i32, &b, v, .big);
    try buf.appendSlice(allocator, &b);
}

fn appendI32Le(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: i32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(i32, &b, v, .little);
    try buf.appendSlice(allocator, &b);
}

fn appendF64Le(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: f64) !void {
    var b: [8]u8 = undefined;
    std.mem.writeInt(u64, &b, @bitCast(v), .little);
    try buf.appendSlice(allocator, &b);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Read a .shx file. Caller owns result; call result.deinit(allocator).
pub fn read(allocator: std.mem.Allocator, path: []const u8) !ShxFile {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();

    // Read entire file into memory; max 64 MiB.
    const data = try file.readToEndAlloc(allocator, 64 * 1024 * 1024);
    defer allocator.free(data);

    var stream = std.io.fixedBufferStream(data);
    const reader = stream.reader();

    // --- header (100 bytes) ---
    const file_code = try readI32Be(reader);
    if (file_code != 9994) return ShapefileError.InvalidFileCode;

    // skip unused[5] (5 × i32 big = 20 bytes)
    var skip: [20]u8 = undefined;
    try reader.readNoEof(&skip);

    const file_length_words = try readI32Be(reader); // total file length in 16-bit words
    const file_length_bytes: u64 = @as(u64, @intCast(file_length_words)) * 2;

    const version = try readI32Le(reader);
    if (version != 1000) return ShapefileError.InvalidVersion;

    const shape_type = try readI32Le(reader);

    const header = ShxHeader{
        .shape_type = shape_type,
        .bbox_x_min = try readF64Le(reader),
        .bbox_y_min = try readF64Le(reader),
        .bbox_x_max = try readF64Le(reader),
        .bbox_y_max = try readF64Le(reader),
        .z_min = try readF64Le(reader),
        .z_max = try readF64Le(reader),
        .m_min = try readF64Le(reader),
        .m_max = try readF64Le(reader),
    };

    // Each record is 8 bytes; data section starts at byte 100.
    const data_bytes = file_length_bytes -| 100;
    const record_count = data_bytes / 8;

    const records = try allocator.alloc(ShxRecord, record_count);
    errdefer allocator.free(records);

    for (records) |*rec| {
        const offset_words = try readI32Be(reader);
        const length_words = try readI32Be(reader);
        rec.* = .{
            .offset = @intCast(offset_words),
            .length = @intCast(length_words),
        };
    }

    return ShxFile{ .header = header, .records = records };
}

/// Write a .shx file from a header and index records.
pub fn write(
    path: []const u8,
    header: ShxHeader,
    records: []const ShxRecord,
) !void {
    var buf: std.ArrayListUnmanaged(u8) = .{};
    defer buf.deinit(std.heap.page_allocator);
    const alloc = std.heap.page_allocator;

    // file length in 16-bit words: 100-byte header + 8 bytes per record
    const file_length_words: i32 = @intCast((100 + records.len * 8) / 2);

    // File code
    try appendI32Be(&buf, alloc, 9994);
    // unused[5] (20 bytes)
    try buf.appendNTimes(alloc, 0, 20);
    // file length
    try appendI32Be(&buf, alloc, file_length_words);
    // version
    try appendI32Le(&buf, alloc, 1000);
    // shape type
    try appendI32Le(&buf, alloc, header.shape_type);
    // bbox
    try appendF64Le(&buf, alloc, header.bbox_x_min);
    try appendF64Le(&buf, alloc, header.bbox_y_min);
    try appendF64Le(&buf, alloc, header.bbox_x_max);
    try appendF64Le(&buf, alloc, header.bbox_y_max);
    try appendF64Le(&buf, alloc, header.z_min);
    try appendF64Le(&buf, alloc, header.z_max);
    try appendF64Le(&buf, alloc, header.m_min);
    try appendF64Le(&buf, alloc, header.m_max);

    // Records
    for (records) |rec| {
        try appendI32Be(&buf, alloc, @intCast(rec.offset));
        try appendI32Be(&buf, alloc, @intCast(rec.length));
    }

    const out = try std.fs.cwd().createFile(path, .{});
    defer out.close();
    try out.writeAll(buf.items);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test "shx round-trip" {
    const allocator = std.testing.allocator;

    // Build a minimal in-memory .shx
    var buf: std.ArrayListUnmanaged(u8) = .{};
    defer buf.deinit(allocator);

    // header
    try appendI32Be(&buf, allocator, 9994);
    try buf.appendNTimes(allocator, 0, 20);
    // file length: 100 header + 2 records × 8 = 116 bytes → 58 words
    try appendI32Be(&buf, allocator, 58);
    try appendI32Le(&buf, allocator, 1000);
    try appendI32Le(&buf, allocator, 11); // PointZ
    // 8 bbox f64 (all zeros)
    try buf.appendNTimes(allocator, 0, 64);

    // 2 records
    try appendI32Be(&buf, allocator, 50); // offset words
    try appendI32Be(&buf, allocator, 18); // length words
    try appendI32Be(&buf, allocator, 69);
    try appendI32Be(&buf, allocator, 18);

    // Parse from in-memory buffer
    var stream = std.io.fixedBufferStream(buf.items);
    const reader = stream.reader();

    const file_code = try readI32Be(reader);
    try std.testing.expectEqual(@as(i32, 9994), file_code);

    var skip: [20]u8 = undefined;
    try reader.readNoEof(&skip);

    const file_length_words = try readI32Be(reader);
    try std.testing.expectEqual(@as(i32, 58), file_length_words);

    const version = try readI32Le(reader);
    try std.testing.expectEqual(@as(i32, 1000), version);

    _ = try readI32Le(reader); // shape type
    var skip2: [64]u8 = undefined;
    try reader.readNoEof(&skip2);

    const off0 = try readI32Be(reader);
    const len0 = try readI32Be(reader);
    const off1 = try readI32Be(reader);
    const len1 = try readI32Be(reader);

    try std.testing.expectEqual(@as(i32, 50), off0);
    try std.testing.expectEqual(@as(i32, 18), len0);
    try std.testing.expectEqual(@as(i32, 69), off1);
    try std.testing.expectEqual(@as(i32, 18), len1);
}
