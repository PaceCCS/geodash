const std = @import("std");
const shapefile = @import("shapefile");
const crs = @import("crs");

pub fn main() void {
    run() catch |err| {
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "Error: {s}\n", .{@errorName(err)}) catch "Error: (unknown)\n";
        std.fs.File.stderr().writeAll(msg) catch {};
        std.process.exit(1);
    };
}

fn run() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer _ = gpa.deinit();
    const allocator = gpa.allocator();

    const args = try std.process.argsAlloc(allocator);
    defer std.process.argsFree(allocator, args);

    // Parse: crs-tool --to <crs> <input.shp> <output.shp>
    var target_crs: ?[]const u8 = null;
    var input_path: ?[]const u8 = null;
    var output_path: ?[]const u8 = null;

    var i: usize = 1;
    while (i < args.len) : (i += 1) {
        if (std.mem.eql(u8, args[i], "--to")) {
            i += 1;
            if (i >= args.len) {
                std.fs.File.stderr().writeAll("Error: --to requires an argument\n") catch {};
                std.process.exit(1);
            }
            target_crs = args[i];
        } else if (input_path == null) {
            input_path = args[i];
        } else if (output_path == null) {
            output_path = args[i];
        }
    }

    const target = target_crs orelse {
        std.fs.File.stderr().writeAll("Usage: crs-tool --to <crs> <input.shp> <output.shp>\n") catch {};
        std.process.exit(1);
    };
    const inp = input_path orelse {
        std.fs.File.stderr().writeAll("Usage: crs-tool --to <crs> <input.shp> <output.shp>\n") catch {};
        std.process.exit(1);
    };
    const out = output_path orelse {
        std.fs.File.stderr().writeAll("Usage: crs-tool --to <crs> <input.shp> <output.shp>\n") catch {};
        std.process.exit(1);
    };

    if (!std.mem.endsWith(u8, inp, ".shp")) {
        std.fs.File.stderr().writeAll("Error: input must have .shp extension\n") catch {};
        std.process.exit(1);
    }
    if (!std.mem.endsWith(u8, out, ".shp")) {
        std.fs.File.stderr().writeAll("Error: output must have .shp extension\n") catch {};
        std.process.exit(1);
    }

    // Derive .prj and output .shx paths
    const inp_stem = inp[0 .. inp.len - 4];
    const out_stem = out[0 .. out.len - 4];
    const prj_path = try std.fmt.allocPrint(allocator, "{s}.prj", .{inp_stem});
    defer allocator.free(prj_path);
    const shx_path = try std.fmt.allocPrint(allocator, "{s}.shx", .{out_stem});
    defer allocator.free(shx_path);

    // Read WKT from .prj and create transform
    const wkt = try shapefile.readPrj(allocator, prj_path);
    defer allocator.free(wkt);

    const target_z = try allocator.dupeZ(u8, target);
    defer allocator.free(target_z);

    const transform = try crs.createFromWkt(allocator, wkt, target_z);
    defer transform.deinit();

    // Read shapefile records
    const records = try shapefile.readShp(allocator, inp);
    defer {
        for (records) |rec| {
            if (rec.geometry == .poly_line_z) rec.geometry.poly_line_z.deinit(allocator);
        }
        allocator.free(records);
    }

    // Transform coordinates in place
    for (records) |*rec| {
        switch (rec.geometry) {
            .point_z => |*p| {
                const r = try transform.forward(p.x, p.y, p.z);
                p.x = r[0];
                p.y = r[1];
                p.z = r[2];
            },
            .poly_line_z => |*pl| {
                const mutable_points: [][2]f64 = @constCast(pl.points);
                var bbox = shapefile.BoundingBox{
                    .min_x = std.math.inf(f64),
                    .min_y = std.math.inf(f64),
                    .max_x = -std.math.inf(f64),
                    .max_y = -std.math.inf(f64),
                };
                for (mutable_points) |*pt| {
                    const r = try transform.forward(pt[0], pt[1], 0);
                    pt[0] = r[0];
                    pt[1] = r[1];
                    bbox.min_x = @min(bbox.min_x, pt[0]);
                    bbox.min_y = @min(bbox.min_y, pt[1]);
                    bbox.max_x = @max(bbox.max_x, pt[0]);
                    bbox.max_y = @max(bbox.max_y, pt[1]);
                }
                pl.bbox = bbox;
            },
        }
    }

    // Write reprojected shapefile
    try shapefile.shp.write(out, shx_path, allocator, records);

    var msg_buf: [512]u8 = undefined;
    const msg = try std.fmt.bufPrint(&msg_buf, "Wrote {d} records to {s}\n", .{ records.len, out });
    try std.fs.File.stdout().writeAll(msg);
}
