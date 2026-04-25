const std = @import("std");
const types = @import("types.zig");
const ShapefileError = types.ShapefileError;
const DbfField = types.DbfField;
const DbfValue = types.DbfValue;

fn defaultIo() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}

fn readFileAlloc(allocator: std.mem.Allocator, path: []const u8, limit: usize) ![]u8 {
    const io = defaultIo();
    const file = try std.Io.Dir.cwd().openFile(io, path, .{});
    defer file.close(io);

    var reader_buf: [4096]u8 = undefined;
    var file_reader = file.reader(io, &reader_buf);
    return file_reader.interface.allocRemaining(allocator, .limited(limit));
}

fn writeFile(path: []const u8, data: []const u8) !void {
    const io = defaultIo();
    try std.Io.Dir.cwd().writeFile(io, .{ .sub_path = path, .data = data });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DBF_HEADER_SIZE: u16 = 32;
const DBF_FIELD_DESCRIPTOR_SIZE: u16 = 32;
const DBF_FIELD_TERMINATOR: u8 = 0x0D;
const DBF_RECORD_ACTIVE: u8 = 0x20;
const DBF_RECORD_DELETED: u8 = 0x2A;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

pub const DbfHeader = struct {
    record_count: u32,
    header_size: u16,
    record_size: u16,
    fields: []DbfField,

    pub fn deinit(self: DbfHeader, allocator: std.mem.Allocator) void {
        allocator.free(self.fields);
    }
};

pub const DbfFile = struct {
    header: DbfHeader,
    /// One row per record; each row has header.fields.len values.
    records: [][]DbfValue,

    pub fn deinit(self: DbfFile, allocator: std.mem.Allocator) void {
        for (self.records) |row| {
            for (row, self.header.fields) |val, field| {
                if (field.field_type == 'C') {
                    if (val == .string) allocator.free(val.string);
                }
            }
            allocator.free(row);
        }
        allocator.free(self.records);
        self.header.deinit(allocator);
    }
};

// ---------------------------------------------------------------------------
// Read helpers (operate on a fixedBufferStream reader)
// ---------------------------------------------------------------------------

fn readU8(reader: *std.Io.Reader) !u8 {
    return (try reader.takeArray(1))[0];
}

fn readU16Le(reader: *std.Io.Reader) !u16 {
    var buf: [2]u8 = undefined;
    try reader.readSliceAll(&buf);
    return std.mem.readInt(u16, &buf, .little);
}

fn readU32Le(reader: *std.Io.Reader) !u32 {
    var buf: [4]u8 = undefined;
    try reader.readSliceAll(&buf);
    return std.mem.readInt(u32, &buf, .little);
}

// ---------------------------------------------------------------------------
// Write helpers (append into ArrayListUnmanaged(u8))
// ---------------------------------------------------------------------------

fn appendU8(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: u8) !void {
    try buf.append(allocator, v);
}

fn appendU16Le(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: u16) !void {
    var b: [2]u8 = undefined;
    std.mem.writeInt(u16, &b, v, .little);
    try buf.appendSlice(allocator, &b);
}

fn appendU32Le(buf: *std.ArrayListUnmanaged(u8), allocator: std.mem.Allocator, v: u32) !void {
    var b: [4]u8 = undefined;
    std.mem.writeInt(u32, &b, v, .little);
    try buf.appendSlice(allocator, &b);
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

fn readFromData(allocator: std.mem.Allocator, data: []const u8) !DbfFile {
    var reader: std.Io.Reader = .fixed(data);

    // --- Main header (32 bytes) ---
    const version = try readU8(&reader);
    // Accept dBASE III (0x03) and dBASE III with memo (0x83); also tolerate
    // other variants whose low 3 bits equal 3.
    if (version & 0x07 != 3) return ShapefileError.InvalidDbfHeader;

    // last update: YY MM DD (3 bytes)
    var _update: [3]u8 = undefined;
    try reader.readSliceAll(&_update);

    const record_count = try readU32Le(&reader);
    const header_size = try readU16Le(&reader);
    const record_size = try readU16Le(&reader);

    // reserved (20 bytes)
    var _reserved: [20]u8 = undefined;
    try reader.readSliceAll(&_reserved);

    // --- Field descriptors (32 bytes each, terminated by 0x0D) ---
    const max_fields = (header_size -| DBF_HEADER_SIZE) / DBF_FIELD_DESCRIPTOR_SIZE;
    var fields: std.ArrayListUnmanaged(DbfField) = .empty;
    errdefer fields.deinit(allocator);

    for (0..max_fields) |_| {
        const first = try readU8(&reader);
        if (first == DBF_FIELD_TERMINATOR) break;

        var name: [11]u8 = undefined;
        name[0] = first;
        try reader.readSliceAll(name[1..]);

        const field_type = try readU8(&reader);
        // 4 bytes reserved
        var _res: [4]u8 = undefined;
        try reader.readSliceAll(&_res);
        const field_length = try readU8(&reader);
        const decimal_count = try readU8(&reader);
        // 14 bytes remaining in descriptor
        var _rest: [14]u8 = undefined;
        try reader.readSliceAll(&_rest);

        try fields.append(allocator, DbfField{
            .name = name,
            .field_type = field_type,
            .length = field_length,
            .decimal_count = decimal_count,
        });
    }

    const fields_slice = try fields.toOwnedSlice(allocator);
    errdefer allocator.free(fields_slice);

    const header = DbfHeader{
        .record_count = record_count,
        .header_size = header_size,
        .record_size = record_size,
        .fields = fields_slice,
    };

    // Seek past the header to the start of records.
    reader.seek = header_size;

    // --- Records ---
    const records = try allocator.alloc([]DbfValue, record_count);
    errdefer allocator.free(records);
    var num_read: usize = 0;
    errdefer {
        for (records[0..num_read]) |row| {
            for (row, fields_slice) |val, field| {
                if (field.field_type == 'C') {
                    if (val == .string) allocator.free(val.string);
                }
            }
            allocator.free(row);
        }
    }

    for (records) |*row| {
        const deletion_flag = try readU8(&reader);

        const row_values = try allocator.alloc(DbfValue, fields_slice.len);
        errdefer allocator.free(row_values);

        for (fields_slice, row_values) |field, *val| {
            const raw = try allocator.alloc(u8, field.length);
            defer allocator.free(raw);
            try reader.readSliceAll(raw);

            if (deletion_flag == DBF_RECORD_DELETED) {
                val.* = .{ .null = {} };
                continue;
            }

            val.* = switch (field.field_type) {
                'C' => blk: {
                    const trimmed = std.mem.trimEnd(u8, raw, " ");
                    const s = try allocator.dupe(u8, trimmed);
                    break :blk .{ .string = s };
                },
                'N', 'F' => blk: {
                    const trimmed = std.mem.trim(u8, raw, " ");
                    if (trimmed.len == 0) break :blk .{ .null = {} };
                    const n = std.fmt.parseFloat(f64, trimmed) catch break :blk .{ .null = {} };
                    break :blk .{ .number = n };
                },
                'L' => blk: {
                    break :blk switch (raw[0]) {
                        'T', 't', 'Y', 'y' => .{ .boolean = true },
                        'F', 'f', 'N', 'n' => .{ .boolean = false },
                        else => .{ .null = {} },
                    };
                },
                'D' => blk: {
                    var d: [8]u8 = undefined;
                    @memcpy(&d, raw[0..8]);
                    break :blk .{ .date = d };
                },
                else => .{ .null = {} },
            };
        }

        row.* = row_values;
        num_read += 1;
    }

    return DbfFile{
        .header = header,
        .records = records,
    };
}

/// Parse a .dbf file. Caller owns the result; call result.deinit(allocator).
pub fn read(allocator: std.mem.Allocator, path: []const u8) !DbfFile {
    // Read whole file into memory (max 256 MiB).
    const data = try readFileAlloc(allocator, path, 256 * 1024 * 1024);
    defer allocator.free(data);

    return readFromData(allocator, data);
}

/// Parse a .dbf from in-memory bytes (no file I/O — for WASM).
pub fn readFromBytes(allocator: std.mem.Allocator, data: []const u8) !DbfFile {
    return readFromData(allocator, data);
}

// ---------------------------------------------------------------------------
// Public write API
// ---------------------------------------------------------------------------

/// Write a .dbf file from fields + rows.
/// Each row must have exactly fields.len values.
pub fn write(
    path: []const u8,
    allocator: std.mem.Allocator,
    fields: []const DbfField,
    rows: []const []const DbfValue,
) !void {
    var buf: std.ArrayListUnmanaged(u8) = .empty;
    defer buf.deinit(allocator);

    // Compute sizes
    var record_size: u16 = 1; // deletion flag byte
    for (fields) |f| record_size += f.length;

    const num_fields: u16 = @intCast(fields.len);
    const header_size: u16 = DBF_HEADER_SIZE + num_fields * DBF_FIELD_DESCRIPTOR_SIZE + 1;

    // --- Header ---
    try appendU8(&buf, allocator, 0x03); // version
    try buf.appendNTimes(allocator, 0, 3); // last update YY MM DD
    try appendU32Le(&buf, allocator, @intCast(rows.len));
    try appendU16Le(&buf, allocator, header_size);
    try appendU16Le(&buf, allocator, record_size);
    try buf.appendNTimes(allocator, 0, 20); // reserved

    // --- Field descriptors ---
    for (fields) |f| {
        try buf.appendSlice(allocator, &f.name);
        try appendU8(&buf, allocator, f.field_type);
        try buf.appendNTimes(allocator, 0, 4); // reserved
        try appendU8(&buf, allocator, f.length);
        try appendU8(&buf, allocator, f.decimal_count);
        try buf.appendNTimes(allocator, 0, 14); // rest of descriptor
    }
    try appendU8(&buf, allocator, DBF_FIELD_TERMINATOR);

    // --- Records ---
    for (rows) |row| {
        try appendU8(&buf, allocator, DBF_RECORD_ACTIVE);
        for (row, fields) |val, field| {
            const field_buf = try allocator.alloc(u8, field.length);
            defer allocator.free(field_buf);
            @memset(field_buf, ' ');

            switch (val) {
                .string => |s| {
                    const n = @min(s.len, field.length);
                    @memcpy(field_buf[0..n], s[0..n]);
                },
                .number => |n| {
                    const s = try std.fmt.allocPrint(allocator, "{d}", .{n});
                    defer allocator.free(s);
                    const l = @min(s.len, field.length);
                    @memcpy(field_buf[0..l], s[0..l]);
                },
                .boolean => |b| {
                    field_buf[0] = if (b) 'T' else 'F';
                },
                .date => |d| {
                    const l = @min(d.len, field.length);
                    @memcpy(field_buf[0..l], d[0..l]);
                },
                .null => {},
            }

            try buf.appendSlice(allocator, field_buf);
        }
    }

    try writeFile(path, buf.items);
}

/// Build .dbf bytes in memory (no file I/O — for WASM). Caller must free.
pub fn buildBytes(
    allocator: std.mem.Allocator,
    fields: []const DbfField,
    rows: []const []const DbfValue,
) ![]u8 {
    var buf: std.ArrayListUnmanaged(u8) = .empty;
    errdefer buf.deinit(allocator);

    var record_size: u16 = 1;
    for (fields) |f| record_size += f.length;

    const num_fields: u16 = @intCast(fields.len);
    const header_size: u16 = DBF_HEADER_SIZE + num_fields * DBF_FIELD_DESCRIPTOR_SIZE + 1;

    try appendU8(&buf, allocator, 0x03);
    try buf.appendNTimes(allocator, 0, 3);
    try appendU32Le(&buf, allocator, @intCast(rows.len));
    try appendU16Le(&buf, allocator, header_size);
    try appendU16Le(&buf, allocator, record_size);
    try buf.appendNTimes(allocator, 0, 20);

    for (fields) |f| {
        try buf.appendSlice(allocator, &f.name);
        try appendU8(&buf, allocator, f.field_type);
        try buf.appendNTimes(allocator, 0, 4);
        try appendU8(&buf, allocator, f.length);
        try appendU8(&buf, allocator, f.decimal_count);
        try buf.appendNTimes(allocator, 0, 14);
    }
    try appendU8(&buf, allocator, DBF_FIELD_TERMINATOR);

    for (rows) |row| {
        try appendU8(&buf, allocator, DBF_RECORD_ACTIVE);
        for (row, fields) |val, field| {
            const field_buf = try allocator.alloc(u8, field.length);
            defer allocator.free(field_buf);
            @memset(field_buf, ' ');

            switch (val) {
                .string => |s| {
                    const n = @min(s.len, field.length);
                    @memcpy(field_buf[0..n], s[0..n]);
                },
                .number => |n| {
                    const s = try std.fmt.allocPrint(allocator, "{d}", .{n});
                    defer allocator.free(s);
                    const l = @min(s.len, field.length);
                    @memcpy(field_buf[0..l], s[0..l]);
                },
                .boolean => |b| {
                    field_buf[0] = if (b) 'T' else 'F';
                },
                .date => |d| {
                    const l = @min(d.len, field.length);
                    @memcpy(field_buf[0..l], d[0..l]);
                },
                .null => {},
            }

            try buf.appendSlice(allocator, field_buf);
        }
    }

    return buf.toOwnedSlice(allocator);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test "dbf read synthetic" {
    const allocator = std.testing.allocator;

    // Build a minimal in-memory DBF with 1 field (C, len 5) and 2 records.
    var buf: std.ArrayListUnmanaged(u8) = .empty;
    defer buf.deinit(allocator);

    // Header (32 bytes)
    try appendU8(&buf, allocator, 0x03); // version
    try buf.appendNTimes(allocator, 0, 3); // last update
    try appendU32Le(&buf, allocator, 2); // record count
    // header size = 32 + 32 + 1 = 65
    try appendU16Le(&buf, allocator, 65);
    // record size = 1 + 5 = 6
    try appendU16Le(&buf, allocator, 6);
    try buf.appendNTimes(allocator, 0, 20); // reserved

    // Field descriptor: NAME (11 bytes), type C, len 5
    var fname: [11]u8 = .{0} ** 11;
    @memcpy(fname[0..4], "NAME");
    try buf.appendSlice(allocator, &fname);
    try appendU8(&buf, allocator, 'C');
    try buf.appendNTimes(allocator, 0, 4); // reserved
    try appendU8(&buf, allocator, 5); // length
    try appendU8(&buf, allocator, 0); // decimal
    try buf.appendNTimes(allocator, 0, 14); // rest

    // Terminator
    try appendU8(&buf, allocator, 0x0D);

    // Record 1: active, "Alice"
    try appendU8(&buf, allocator, 0x20);
    try buf.appendSlice(allocator, "Alice");

    // Record 2: active, "Bob  "
    try appendU8(&buf, allocator, 0x20);
    try buf.appendSlice(allocator, "Bob  ");

    // Write to temp file and read back
    var tmp_dir = std.testing.tmpDir(.{});
    defer tmp_dir.cleanup();

    const tmp_path = try tmp_dir.dir.realPathFileAlloc(defaultIo(), ".", allocator);
    defer allocator.free(tmp_path);

    const dbf_path = try std.fmt.allocPrint(allocator, "{s}/test.dbf", .{tmp_path});
    defer allocator.free(dbf_path);

    try writeFile(dbf_path, buf.items);

    const result = try read(allocator, dbf_path);
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(u32, 2), result.header.record_count);
    try std.testing.expectEqual(@as(usize, 2), result.records.len);
    try std.testing.expectEqualStrings("Alice", result.records[0][0].string);
    try std.testing.expectEqualStrings("Bob", result.records[1][0].string);
}
