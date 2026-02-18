const std = @import("std");

pub const ShapefileError = error{
    InvalidFileCode,
    InvalidVersion,
    UnsupportedShapeType,
    MixedShapeTypes,
    UnexpectedShapeType,
    TruncatedFile,
    InvalidDbfHeader,
    InvalidFieldDescriptor,
    OutOfMemory,
};

pub const BoundingBox = struct {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
};

pub const ZRange = struct {
    min: f64,
    max: f64,
};

pub const PointZ = struct {
    x: f64,
    y: f64,
    z: f64,
    m: f64,
};

pub const PolyLineZ = struct {
    bbox: BoundingBox,
    parts: []const u32,
    points: []const [2]f64,
    z_range: ZRange,
    z: []const f64,
    m_range: ZRange,
    m: []const f64,

    pub fn deinit(self: PolyLineZ, allocator: std.mem.Allocator) void {
        allocator.free(self.parts);
        allocator.free(self.points);
        allocator.free(self.z);
        allocator.free(self.m);
    }
};

pub const Geometry = union(enum) {
    point_z: PointZ,
    poly_line_z: PolyLineZ,
};

pub const ShpRecord = struct {
    number: u32,
    geometry: Geometry,
};

pub const DbfField = struct {
    name: [11]u8,
    field_type: u8, // 'C', 'N', 'F', 'L', 'D'
    length: u8,
    decimal_count: u8,
};

pub const DbfValue = union(enum) {
    string: []const u8,
    number: f64,
    boolean: bool,
    date: [8]u8,
    null: void,
};

pub const Attributes = struct {
    fields: []const DbfField,
    values: []const DbfValue,
};

test "types compile" {
    const p = PointZ{ .x = 1.0, .y = 2.0, .z = 3.0, .m = 0.0 };
    try std.testing.expectApproxEqAbs(p.x, 1.0, 1e-9);
}
