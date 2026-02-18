pub const types = @import("types.zig");
pub const shp = @import("shp.zig");
pub const shx = @import("shx.zig");
pub const dbf = @import("dbf.zig");
pub const kp = @import("kp.zig");

pub const BoundingBox = types.BoundingBox;
pub const ZRange = types.ZRange;
pub const PointZ = types.PointZ;
pub const PolyLineZ = types.PolyLineZ;
pub const Geometry = types.Geometry;
pub const ShpRecord = types.ShpRecord;
pub const DbfField = types.DbfField;
pub const DbfValue = types.DbfValue;
pub const Attributes = types.Attributes;
pub const ShapefileError = types.ShapefileError;

pub const KpPoint = kp.KpPoint;
pub const computeKp = kp.computeKp;

pub const readShp = shp.read;
pub const readShx = shx.read;
pub const readDbf = dbf.read;
pub const readPrj = shp.readPrj;

test {
    _ = @import("types.zig");
    _ = @import("shx.zig");
    _ = @import("shp.zig");
    _ = @import("dbf.zig");
    _ = @import("kp.zig");
    _ = @import("integration_test.zig");
}
