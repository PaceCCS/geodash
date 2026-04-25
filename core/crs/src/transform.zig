const std = @import("std");
const c = @import("proj_c");

pub const CrsError = error{
    ContextCreationFailed,
    TransformCreationFailed,
    NormalizationFailed,
    TransformFailed,
};

pub const Transform = struct {
    ctx: *c.PJ_CONTEXT,
    pj: *c.PJ,

    /// source_crs / target_crs: any PROJ-understood null-terminated string
    /// (EPSG code, PROJ string, or WKT). Axis order is always easting/northing
    /// (proj_normalize_for_visualization is called internally).
    pub fn create(source_crs: [*:0]const u8, target_crs: [*:0]const u8) CrsError!Transform {
        const ctx = c.proj_context_create() orelse return CrsError.ContextCreationFailed;
        errdefer _ = c.proj_context_destroy(ctx);

        const raw = c.proj_create_crs_to_crs(ctx, source_crs, target_crs, null) orelse
            return CrsError.TransformCreationFailed;
        defer _ = c.proj_destroy(raw);

        const pj = c.proj_normalize_for_visualization(ctx, raw) orelse
            return CrsError.NormalizationFailed;

        return Transform{ .ctx = ctx, .pj = pj };
    }

    /// Forward: source CRS → target CRS. Returns [x, y, z].
    /// Returns CrsError.TransformFailed if PROJ signals an error.
    pub fn forward(self: Transform, x: f64, y: f64, z: f64) CrsError![3]f64 {
        return trans(self.pj, c.PJ_FWD, x, y, z);
    }

    /// Inverse: target CRS → source CRS. Returns [x, y, z].
    /// Returns CrsError.TransformFailed if PROJ signals an error.
    pub fn inverse(self: Transform, x: f64, y: f64, z: f64) CrsError![3]f64 {
        return trans(self.pj, c.PJ_INV, x, y, z);
    }

    pub fn deinit(self: Transform) void {
        _ = c.proj_destroy(self.pj);
        _ = c.proj_context_destroy(self.ctx);
    }
};

// proj_trans (pass-by-value PJ_COORD) has an ABI bug on ARM64/Apple Silicon:
// the 32-byte struct is not correctly passed/returned. Use proj_trans_generic
// with separate x/y/z arrays instead — it operates on pointers and is reliable.
fn trans(pj: *c.PJ, direction: c.PJ_DIRECTION, x: f64, y: f64, z: f64) CrsError![3]f64 {
    var ox = [1]f64{x};
    var oy = [1]f64{y};
    var oz = [1]f64{z};
    const n = c.proj_trans_generic(
        pj, direction,
        &ox, @sizeOf(f64), 1,
        &oy, @sizeOf(f64), 1,
        &oz, @sizeOf(f64), 1,
        null, 0, 0,
    );
    if (n != 1 or !std.math.isFinite(ox[0])) return CrsError.TransformFailed;
    return .{ ox[0], oy[0], oz[0] };
}

/// Accepts a Zig slice (e.g. from readPrj), null-terminates it,
/// then calls Transform.create.
pub fn createFromWkt(
    allocator: std.mem.Allocator,
    source_wkt: []const u8,
    target_crs: [*:0]const u8,
) !Transform {
    const source_z = try allocator.dupeZ(u8, source_wkt);
    defer allocator.free(source_z);
    return Transform.create(source_z, target_crs);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// WKT for the Spirit pipeline (ED50 UTM Zone 30N), same CRS as EPSG:23030.
const spirit_wkt =
    \\PROJCS["ED_1950_UTM_Zone_30N",GEOGCS["GCS_European_1950",DATUM["D_European_1950",SPHEROID["International_1924",6378388.0,297.0]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-3.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]
;

test "forward: ED50 UTM 30N -> WGS84 is in expected range" {
    const t = try Transform.create("EPSG:23030", "EPSG:4326");
    defer t.deinit();

    const result = try t.forward(491542.058, 5918507.093, 0);
    const lon = result[0];
    const lat = result[1];

    try std.testing.expect(lon >= -5 and lon <= 5);
    try std.testing.expect(lat >= 50 and lat <= 60);
}

test "round-trip: forward then inverse within 1mm" {
    const t = try Transform.create("EPSG:23030", "EPSG:4326");
    defer t.deinit();

    const fwd = try t.forward(491542.058, 5918507.093, 0);
    const inv = try t.inverse(fwd[0], fwd[1], fwd[2]);

    try std.testing.expectApproxEqAbs(@as(f64, 491542.058), inv[0], 1e-3);
    try std.testing.expectApproxEqAbs(@as(f64, 5918507.093), inv[1], 1e-3);
}

test "createFromWkt: Spirit WKT matches EPSG code path" {
    const allocator = std.testing.allocator;

    const t_epsg = try Transform.create("EPSG:23030", "EPSG:4326");
    defer t_epsg.deinit();

    const t_wkt = try createFromWkt(allocator, spirit_wkt, "EPSG:4326");
    defer t_wkt.deinit();

    const r_epsg = try t_epsg.forward(491542.058, 5918507.093, 0);
    const r_wkt = try t_wkt.forward(491542.058, 5918507.093, 0);

    try std.testing.expectApproxEqAbs(r_epsg[0], r_wkt[0], 1e-6);
    try std.testing.expectApproxEqAbs(r_epsg[1], r_wkt[1], 1e-6);
}
