const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const shapefile_dep = b.dependency("shapefile", .{
        .target = target,
        .optimize = optimize,
    });
    const shapefile_mod = shapefile_dep.module("shapefile");

    const transform_mod = b.addModule("crs", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
    });

    const exe = b.addExecutable(.{
        .name = "crs-tool",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "crs", .module = transform_mod },
                .{ .name = "shapefile", .module = shapefile_mod },
            },
        }),
    });
    b.installArtifact(exe);

    // Module tests (transform.zig tests run via root.zig)
    const mod_tests = b.addTest(.{ .root_module = transform_mod });

    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&b.addRunArtifact(mod_tests).step);
}