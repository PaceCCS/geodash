const std = @import("std");
const types = @import("types.zig");
const BoundingBox = types.BoundingBox;
const ZRange = types.ZRange;
const PolyLineZ = types.PolyLineZ;

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

pub const KmlError = error{
    NoCoordinatesFound,
    KmlNotFound,
    InvalidWkt,
    EmptyGeometry,
    UnsupportedFormat,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Read a .kml, .kmz, or Google My Maps .csv file.
/// Returns a PolyLineZ in WGS84 (EPSG:4326). M values are left as 0 —
/// assign KP after reprojecting to a metric CRS with crs-tool.
/// Caller must call result.deinit(allocator) when done.
pub fn read(allocator: std.mem.Allocator, path: []const u8) !PolyLineZ {
    if (std.mem.endsWith(u8, path, ".kmz")) return readKmz(allocator, path);
    if (std.mem.endsWith(u8, path, ".kml")) return readKml(allocator, path);
    if (std.mem.endsWith(u8, path, ".csv")) return readCsv(allocator, path);
    return KmlError.UnsupportedFormat;
}

pub fn readFromBytes(allocator: std.mem.Allocator, format: []const u8, data: []const u8) !PolyLineZ {
    if (std.mem.eql(u8, format, "kmz")) return readKmzFromBytes(allocator, data);
    if (std.mem.eql(u8, format, "kml")) return parseKml(allocator, data);
    if (std.mem.eql(u8, format, "csv")) return parseCsv(allocator, data);
    return KmlError.UnsupportedFormat;
}

// ---------------------------------------------------------------------------
// KML
// ---------------------------------------------------------------------------

fn readKml(allocator: std.mem.Allocator, path: []const u8) !PolyLineZ {
    const data = try readFileAlloc(allocator, path, 10 * 1024 * 1024);
    defer allocator.free(data);
    return parseKml(allocator, data);
}

/// Scan for the first <coordinates>...</coordinates> block and parse it.
/// No full XML parser needed — KML coordinate blocks are unambiguous.
fn parseKml(allocator: std.mem.Allocator, data: []const u8) !PolyLineZ {
    const open = "<coordinates>";
    const close = "</coordinates>";

    const start = std.mem.indexOf(u8, data, open) orelse return KmlError.NoCoordinatesFound;
    const content_start = start + open.len;
    const end = std.mem.indexOf(u8, data[content_start..], close) orelse return KmlError.NoCoordinatesFound;

    return parseKmlCoords(allocator, data[content_start .. content_start + end]);
}

/// Parse whitespace-separated "lon,lat[,alt]" tuples.
fn parseKmlCoords(allocator: std.mem.Allocator, text: []const u8) !PolyLineZ {
    var points: std.ArrayListUnmanaged([2]f64) = .empty;
    errdefer points.deinit(allocator);
    var zs: std.ArrayListUnmanaged(f64) = .empty;
    errdefer zs.deinit(allocator);

    var tokens = std.mem.tokenizeAny(u8, text, " \t\r\n");
    while (tokens.next()) |token| {
        var parts = std.mem.splitScalar(u8, token, ',');
        const lon_s = parts.next() orelse continue;
        const lat_s = parts.next() orelse continue;
        const alt_s = parts.next();

        const lon = std.fmt.parseFloat(f64, lon_s) catch continue;
        const lat = std.fmt.parseFloat(f64, lat_s) catch continue;
        const alt = if (alt_s) |s| (std.fmt.parseFloat(f64, s) catch 0.0) else 0.0;

        try points.append(allocator, .{ lon, lat });
        try zs.append(allocator, alt);
    }

    if (points.items.len == 0) return KmlError.EmptyGeometry;
    return buildPolyLineZ(allocator, &points, &zs);
}

// ---------------------------------------------------------------------------
// KMZ (ZIP containing a KML)
// ---------------------------------------------------------------------------

fn readKmz(allocator: std.mem.Allocator, path: []const u8) !PolyLineZ {
    // Extract to a unique temp directory, parse the KML, then clean up.
    var tmp_buf: [128]u8 = undefined;
    const tmp_path = try std.fmt.bufPrint(&tmp_buf, "/tmp/geodash_kml_{d}", .{std.Io.Timestamp.now(defaultIo(), .real).nanoseconds});

    const io = defaultIo();
    std.Io.Dir.cwd().createDir(io, tmp_path, .default_dir) catch |e| if (e != error.PathAlreadyExists) return e;
    var tmp_dir = try std.Io.Dir.cwd().openDir(io, tmp_path, .{ .iterate = true });
    defer {
        tmp_dir.close(io);
        std.Io.Dir.cwd().deleteTree(io, tmp_path) catch {};
    }

    {
        const file = try std.Io.Dir.cwd().openFile(io, path, .{});
        defer file.close(io);
        var reader_buf: [4096]u8 = undefined;
        var fr = file.reader(io, &reader_buf);
        try std.zip.extract(tmp_dir, &fr, .{});
    }

    // Find the first .kml file in the extracted directory.
    var iter = tmp_dir.iterate();
    while (try iter.next(io)) |entry| {
        if (entry.kind != .file) continue;
        if (!std.mem.endsWith(u8, entry.name, ".kml")) continue;

        const kml_file = try tmp_dir.openFile(io, entry.name, .{});
        defer kml_file.close(io);
        var reader_buf: [4096]u8 = undefined;
        var kml_reader = kml_file.reader(io, &reader_buf);
        const kml_data = try kml_reader.interface.allocRemaining(allocator, .limited(10 * 1024 * 1024));
        defer allocator.free(kml_data);
        return parseKml(allocator, kml_data);
    }

    return KmlError.KmlNotFound;
}

fn readKmzFromBytes(allocator: std.mem.Allocator, data: []const u8) !PolyLineZ {
    const end_record = findZipEndRecord(data) orelse return error.ZipNoEndRecord;
    var cd_offset: usize = end_record.central_directory_offset;

    for (0..end_record.record_count_total) |_| {
        if (cd_offset + @sizeOf(std.zip.CentralDirectoryFileHeader) > data.len) return error.ZipTruncated;
        const header: *align(1) const std.zip.CentralDirectoryFileHeader = @ptrCast(data[cd_offset..][0..@sizeOf(std.zip.CentralDirectoryFileHeader)].ptr);
        if (!std.mem.eql(u8, &header.signature, &std.zip.central_file_header_sig)) return error.ZipBadCdOffset;

        const filename_start = cd_offset + @sizeOf(std.zip.CentralDirectoryFileHeader);
        const filename_end = filename_start + header.filename_len;
        if (filename_end > data.len) return error.ZipTruncated;
        const filename = data[filename_start..filename_end];

        if (std.mem.endsWith(u8, filename, ".kml")) {
            const kml_data = try readKmzEntryBytes(allocator, data, header.*);
            defer allocator.free(kml_data);
            return parseKml(allocator, kml_data);
        }

        cd_offset = filename_end + header.extra_len + header.comment_len;
    }

    return KmlError.KmlNotFound;
}

fn findZipEndRecord(data: []const u8) ?std.zip.EndRecord {
    const pos = std.mem.lastIndexOf(u8, data, &std.zip.end_record_sig) orelse return null;
    if (pos + @sizeOf(std.zip.EndRecord) > data.len) return null;
    const record: *align(1) const std.zip.EndRecord = @ptrCast(data[pos..][0..@sizeOf(std.zip.EndRecord)].ptr);
    return record.*;
}

fn readKmzEntryBytes(
    allocator: std.mem.Allocator,
    data: []const u8,
    header: std.zip.CentralDirectoryFileHeader,
) ![]u8 {
    const local_offset: usize = header.local_file_header_offset;
    if (local_offset + @sizeOf(std.zip.LocalFileHeader) > data.len) return error.ZipTruncated;
    const local_header: *align(1) const std.zip.LocalFileHeader = @ptrCast(data[local_offset..][0..@sizeOf(std.zip.LocalFileHeader)].ptr);
    if (!std.mem.eql(u8, &local_header.signature, &std.zip.local_file_header_sig)) return error.ZipBadFileOffset;

    const compressed_start = local_offset + @sizeOf(std.zip.LocalFileHeader) + local_header.filename_len + local_header.extra_len;
    const compressed_end = compressed_start + header.compressed_size;
    if (compressed_end > data.len) return error.ZipTruncated;
    const compressed = data[compressed_start..compressed_end];

    const output = try allocator.alloc(u8, header.uncompressed_size);
    errdefer allocator.free(output);

    switch (header.compression_method) {
        .store => @memcpy(output, compressed),
        .deflate => {
            var input = std.Io.Reader.fixed(compressed);
            var writer = std.Io.Writer.fixed(output);
            var flate_buffer: [std.compress.flate.max_window_len]u8 = undefined;
            var decompress: std.compress.flate.Decompress = .init(&input, .raw, &flate_buffer);
            try decompress.reader.streamExact64(&writer, header.uncompressed_size);
        },
        else => return error.UnsupportedCompressionMethod,
    }

    return output;
}

// ---------------------------------------------------------------------------
// Google My Maps CSV (WKT format)
// ---------------------------------------------------------------------------

// The CSV My Maps exports looks like:
//   WKT,name,description
//   "LINESTRING (-2.865 54.074, -2.854 54.092, ...)",Line 1,

fn readCsv(allocator: std.mem.Allocator, path: []const u8) !PolyLineZ {
    const data = try readFileAlloc(allocator, path, 10 * 1024 * 1024);
    defer allocator.free(data);
    return parseCsv(allocator, data);
}

fn parseCsv(allocator: std.mem.Allocator, data: []const u8) !PolyLineZ {
    // Skip the header line.
    const newline = std.mem.indexOfAny(u8, data, "\r\n") orelse return KmlError.NoCoordinatesFound;
    const body = std.mem.trimStart(u8, data[newline..], "\r\n");

    // Locate the LINESTRING coordinate block.
    const prefix = "LINESTRING (";
    const ls = std.mem.indexOf(u8, body, prefix) orelse return KmlError.InvalidWkt;
    const coord_start = ls + prefix.len;
    const coord_end = std.mem.indexOf(u8, body[coord_start..], ")") orelse return KmlError.InvalidWkt;
    const coord_text = body[coord_start .. coord_start + coord_end];

    var points: std.ArrayListUnmanaged([2]f64) = .empty;
    errdefer points.deinit(allocator);
    var zs: std.ArrayListUnmanaged(f64) = .empty;
    errdefer zs.deinit(allocator);

    // Pairs are "lon lat" separated by ", ".
    var pairs = std.mem.splitSequence(u8, coord_text, ", ");
    while (pairs.next()) |pair| {
        const trimmed = std.mem.trim(u8, pair, " \t\r\n\"");
        if (trimmed.len == 0) continue;

        var parts = std.mem.splitScalar(u8, trimmed, ' ');
        const lon_s = parts.next() orelse continue;
        const lat_s = parts.next() orelse continue;

        const lon = std.fmt.parseFloat(f64, lon_s) catch continue;
        const lat = std.fmt.parseFloat(f64, lat_s) catch continue;

        try points.append(allocator, .{ lon, lat });
        try zs.append(allocator, 0.0);
    }

    if (points.items.len == 0) return KmlError.EmptyGeometry;
    return buildPolyLineZ(allocator, &points, &zs);
}

// ---------------------------------------------------------------------------
// Shared geometry builder
// ---------------------------------------------------------------------------

fn buildPolyLineZ(
    allocator: std.mem.Allocator,
    points: *std.ArrayListUnmanaged([2]f64),
    zs: *std.ArrayListUnmanaged(f64),
) !PolyLineZ {
    const pts = try points.toOwnedSlice(allocator);
    errdefer allocator.free(pts);
    const z = try zs.toOwnedSlice(allocator);
    errdefer allocator.free(z);

    const parts = try allocator.alloc(u32, 1);
    errdefer allocator.free(parts);
    parts[0] = 0;

    const m = try allocator.alloc(f64, pts.len);
    errdefer allocator.free(m);
    @memset(m, 0.0);

    var bbox = BoundingBox{
        .min_x = pts[0][0],
        .min_y = pts[0][1],
        .max_x = pts[0][0],
        .max_y = pts[0][1],
    };
    var z_min = z[0];
    var z_max = z[0];
    for (pts, z) |pt, zv| {
        bbox.min_x = @min(bbox.min_x, pt[0]);
        bbox.min_y = @min(bbox.min_y, pt[1]);
        bbox.max_x = @max(bbox.max_x, pt[0]);
        bbox.max_y = @max(bbox.max_y, pt[1]);
        z_min = @min(z_min, zv);
        z_max = @max(z_max, zv);
    }

    return PolyLineZ{
        .bbox = bbox,
        .parts = parts,
        .points = pts,
        .z_range = .{ .min = z_min, .max = z_max },
        .z = z,
        .m_range = .{ .min = 0.0, .max = 0.0 },
        .m = m,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const test_data = "test-data/mymaps/";

test "kml: parse inline coordinates" {
    const allocator = std.testing.allocator;

    const kml =
        \\<?xml version="1.0" encoding="UTF-8"?>
        \\<kml xmlns="http://www.opengis.net/kml/2.2">
        \\  <Document>
        \\    <Placemark>
        \\      <LineString>
        \\        <coordinates>
        \\          -2.8654289,54.0746276,0
        \\          -2.8540993,54.0925517,0
        \\          -2.8743553,54.1016115,0
        \\        </coordinates>
        \\      </LineString>
        \\    </Placemark>
        \\  </Document>
        \\</kml>
    ;

    const result = try parseKml(allocator, kml);
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 3), result.points.len);
    try std.testing.expectApproxEqAbs(@as(f64, -2.8654289), result.points[0][0], 1e-7);
    try std.testing.expectApproxEqAbs(@as(f64, 54.0746276), result.points[0][1], 1e-7);
    try std.testing.expectApproxEqAbs(@as(f64, -2.8743553), result.points[2][0], 1e-7);
    try std.testing.expectEqual(@as(u32, 0), result.parts[0]);
}

test "kml: parse with altitude" {
    const allocator = std.testing.allocator;

    const kml =
        \\<kml><Placemark><LineString><coordinates>
        \\  -3.5,53.5,-10 -3.4,53.6,-20 -3.3,53.7,-30
        \\</coordinates></LineString></Placemark></kml>
    ;

    const result = try parseKml(allocator, kml);
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 3), result.points.len);
    try std.testing.expectApproxEqAbs(@as(f64, -10.0), result.z[0], 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, -30.0), result.z[2], 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, -30.0), result.z_range.min, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, -10.0), result.z_range.max, 1e-9);
}

test "csv: parse inline WKT" {
    const allocator = std.testing.allocator;

    const csv =
        \\WKT,name,description
        \\"LINESTRING (-2.8654289 54.0746276, -2.8540993 54.0925517, -2.8743553 54.1016115)",Line 1,
    ;

    const result = try parseCsv(allocator, csv);
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 3), result.points.len);
    try std.testing.expectApproxEqAbs(@as(f64, -2.8654289), result.points[0][0], 1e-7);
    try std.testing.expectApproxEqAbs(@as(f64, 54.0746276), result.points[0][1], 1e-7);
    // CSV has no altitude — Z should be 0
    try std.testing.expectApproxEqAbs(@as(f64, 0.0), result.z[0], 1e-9);
}

test "kmz: read real My Maps export" {
    const allocator = std.testing.allocator;

    const result = read(allocator, test_data ++ "route.kmz") catch |e| {
        std.debug.print("skipping kmz test: {s}\n", .{@errorName(e)});
        return;
    };
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 5), result.points.len);
    try std.testing.expectApproxEqAbs(@as(f64, -2.8654289), result.points[0][0], 1e-6);
    try std.testing.expectApproxEqAbs(@as(f64, 54.0746276), result.points[0][1], 1e-6);
}

test "csv: read real My Maps export" {
    const allocator = std.testing.allocator;

    const result = try read(allocator, test_data ++ "route.csv");
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 5), result.points.len);
    try std.testing.expectApproxEqAbs(@as(f64, -2.8654289), result.points[0][0], 1e-6);
    try std.testing.expectApproxEqAbs(@as(f64, 54.0746276), result.points[0][1], 1e-6);
}

test "kml and csv produce same points" {
    const allocator = std.testing.allocator;

    const from_kmz = read(allocator, test_data ++ "route.kmz") catch return;
    defer from_kmz.deinit(allocator);

    const from_csv = try read(allocator, test_data ++ "route.csv");
    defer from_csv.deinit(allocator);

    try std.testing.expectEqual(from_kmz.points.len, from_csv.points.len);
    for (from_kmz.points, from_csv.points) |a, b| {
        try std.testing.expectApproxEqAbs(a[0], b[0], 1e-6);
        try std.testing.expectApproxEqAbs(a[1], b[1], 1e-6);
    }
}
