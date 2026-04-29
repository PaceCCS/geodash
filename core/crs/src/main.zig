const std = @import("std");
const shapefile = @import("shapefile");
const crs = @import("crs");

pub fn main(init: std.process.Init) void {
    run(init) catch |err| {
        std.debug.print("Error: {s}\n", .{@errorName(err)});
        std.process.exit(1);
    };
}

fn run(init: std.process.Init) !void {
    const allocator = init.gpa;
    var args = try std.process.Args.Iterator.initAllocator(init.minimal.args, allocator);
    defer args.deinit();

    // Parse: crs-tool --to <crs> <input.shp> <output.shp>
    var target_crs: ?[]const u8 = null;
    var input_path: ?[]const u8 = null;
    var output_path: ?[]const u8 = null;

    _ = args.skip();
    while (args.next()) |arg| {
        if (std.mem.eql(u8, arg, "--to")) {
            const next = args.next() orelse {
                std.debug.print("Error: --to requires an argument\n", .{});
                std.process.exit(1);
            };
            target_crs = next;
        } else if (input_path == null) {
            input_path = arg;
        } else if (output_path == null) {
            output_path = arg;
        }
    }

    const target = target_crs orelse {
        std.debug.print("Usage: crs-tool --to <crs> <input.shp> <output.shp>\n", .{});
        std.process.exit(1);
    };
    const inp = input_path orelse {
        std.debug.print("Usage: crs-tool --to <crs> <input.shp> <output.shp>\n", .{});
        std.process.exit(1);
    };
    const out = output_path orelse {
        std.debug.print("Usage: crs-tool --to <crs> <input.shp> <output.shp>\n", .{});
        std.process.exit(1);
    };

    if (!std.mem.endsWith(u8, inp, ".shp")) {
        std.debug.print("Error: input must have .shp extension\n", .{});
        std.process.exit(1);
    }
    if (!std.mem.endsWith(u8, out, ".shp")) {
        std.debug.print("Error: output must have .shp extension\n", .{});
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

    std.debug.print("Wrote {d} records to {s}\n", .{ records.len, out });
}
