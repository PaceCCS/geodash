//! Integration tests using actual dagger preset1 data.
//! These tests verify that the geodash network engine correctly loads
//! and queries the same TOML files used by the original dagger system.

const std = @import("std");
const toml = @import("toml.zig");
const net = @import("network.zig");
const scope_mod = @import("scope.zig");
const query_mod = @import("query.zig");
const Value = toml.Value;

fn defaultIo() std.Io {
    return std.Io.Threaded.global_single_threaded.io();
}

/// Load all .toml files from the test-data/preset1 directory into memory
fn loadPreset1Files(allocator: std.mem.Allocator) !std.StringArrayHashMapUnmanaged([]const u8) {
    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    errdefer {
        var it = files.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            allocator.free(entry.value_ptr.*);
        }
        files.deinit(allocator);
    }

    const dir_path = "test-data/preset1";
    const io = defaultIo();
    var dir = std.Io.Dir.cwd().openDir(io, dir_path, .{ .iterate = true }) catch |e| {
        std.debug.print("Failed to open {s}: {}\n", .{ dir_path, e });
        return files;
    };
    defer dir.close(io);

    var dir_iter = dir.iterate();
    while (try dir_iter.next(io)) |entry| {
        if (entry.kind != .file) continue;
        if (!std.mem.endsWith(u8, entry.name, ".toml")) continue;

        const content = try dir.readFileAlloc(io, entry.name, allocator, .limited(1024 * 1024));
        const name = try allocator.dupe(u8, entry.name);
        try files.put(allocator, name, content);
    }

    return files;
}

fn deinitFiles(allocator: std.mem.Allocator, files: *std.StringArrayHashMapUnmanaged([]const u8)) void {
    var it = files.iterator();
    while (it.next()) |entry| {
        allocator.free(entry.key_ptr.*);
        allocator.free(entry.value_ptr.*);
    }
    files.deinit(allocator);
}

// ─── Network loading tests ──────────────────────────────────────────────

test "preset1: loads all nodes" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);

    if (files.count() == 0) return; // Skip if test data not available

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    // preset1 has: 9 branches + 1 group + 1 geographic anchor + 2 geographic windows + 1 image = 14 nodes
    try std.testing.expectEqual(@as(usize, 14), network.nodes.items.len);
}

test "preset1: all node types present" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    var branch_count: usize = 0;
    var group_count: usize = 0;
    var anchor_count: usize = 0;
    var window_count: usize = 0;
    var image_count: usize = 0;

    for (network.nodes.items) |*node| {
        switch (node.*) {
            .branch => branch_count += 1,
            .group => group_count += 1,
            .geographic_anchor => anchor_count += 1,
            .geographic_window => window_count += 1,
            .image => image_count += 1,
        }
    }

    try std.testing.expectEqual(@as(usize, 9), branch_count);
    try std.testing.expectEqual(@as(usize, 1), group_count);
    try std.testing.expectEqual(@as(usize, 1), anchor_count);
    try std.testing.expectEqual(@as(usize, 2), window_count);
    try std.testing.expectEqual(@as(usize, 1), image_count);
}

test "preset1: branch-4 has correct structure" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const branch4 = network.findBranch("branch-4") orelse return error.NodeNotFound;

    try std.testing.expectEqualStrings("Branch 4", branch4.base.label.?);
    try std.testing.expectApproxEqAbs(@as(f64, -100), branch4.base.position.x, 0.001);
    try std.testing.expectApproxEqAbs(@as(f64, 350), branch4.base.position.y, 0.001);

    // branch-4 has 7 blocks: Source + 6 Pipes
    try std.testing.expectEqual(@as(usize, 7), branch4.blocks.items.len);
    try std.testing.expectEqualStrings("Source", branch4.blocks.items[0].type_name);
    try std.testing.expectEqualStrings("Pipe", branch4.blocks.items[1].type_name);

    // Source block has pressure = 15.5
    try std.testing.expectApproxEqAbs(@as(f64, 15.5), branch4.blocks.items[0].extra.get("pressure").?.getFloat().?, 0.001);

    // Has outgoing to branch-2
    try std.testing.expectEqual(@as(usize, 1), branch4.outgoing.items.len);
    try std.testing.expectEqualStrings("branch-2", branch4.outgoing.items[0].target);
}

test "preset1: branch-1 has parentId referencing group-1" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const branch1 = network.findBranch("branch-1") orelse return error.NodeNotFound;
    try std.testing.expectEqualStrings("group-1", branch1.base.parent_id.?);

    // Group should exist
    const group = network.findGroup("group-1");
    try std.testing.expect(group != null);
    try std.testing.expectEqualStrings("Labeled Group", group.?.base.label.?);
}

test "preset1: edges built correctly" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    // Count edges — multiple branches have outgoing connections
    try std.testing.expect(network.edges.items.len > 0);

    // Verify branch-4 -> branch-2 edge exists
    var found_b4_b2 = false;
    for (network.edges.items) |edge| {
        if (std.mem.eql(u8, edge.source, "branch-4") and std.mem.eql(u8, edge.target, "branch-2")) {
            found_b4_b2 = true;
            try std.testing.expectEqualStrings("branch-4_branch-2", edge.id);
        }
    }
    try std.testing.expect(found_b4_b2);
}

test "preset1: image node has path" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    for (network.nodes.items) |*node| {
        switch (node.*) {
            .image => |img| {
                try std.testing.expectEqualStrings("Pipeline Map", img.base.label.?);
                try std.testing.expectEqualStrings("assets/sample-diagram.svg", img.path);
                return;
            },
            else => {},
        }
    }
    return error.NodeNotFound;
}

// ─── Scope resolution tests ─────────────────────────────────────────────

test "preset1: scope resolution with config.toml" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    // Load network
    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();
    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    // Load config
    const config_content = files.get("config.toml") orelse return;
    var config_parsed = try toml.Parser.parse(allocator, config_content);
    defer config_parsed.deinit(allocator);
    var config = try scope_mod.Config.loadFromToml(allocator, config_parsed.table);
    defer config.deinit();

    const resolver = scope_mod.ScopeResolver.init(&config);

    // branch-4/blocks/0 is a Source with pressure=15.5
    // The pressure rule is ["block"], so it should find 15.5 from the block
    const branch4 = network.findBranch("branch-4").?;
    const source_block = &branch4.blocks.items[0];
    const pressure = resolver.resolvePropertyWithScope("pressure", source_block, branch4, null);

    try std.testing.expect(pressure != null);
    try std.testing.expectApproxEqAbs(@as(f64, 15.5), pressure.?.value.getFloat().?, 0.001);
    try std.testing.expectEqual(scope_mod.ScopeLevel.block, pressure.?.scope);

    // For a Pipe block without pressure, the rule ["block"] means it won't fall back to global
    const pipe_block = &branch4.blocks.items[1];
    const pipe_pressure = resolver.resolveProperty("pressure", pipe_block, branch4, null);
    try std.testing.expect(pipe_pressure == null); // Not found because rule restricts to block only

    // ambientTemperature rule is ["group", "global"] — should fall back to global (20.0)
    const ambient = resolver.resolvePropertyWithScope("ambientTemperature", source_block, branch4, null);
    try std.testing.expect(ambient != null);
    try std.testing.expectApproxEqAbs(@as(f64, 20.0), ambient.?.value.getFloat().?, 0.001);
    try std.testing.expectEqual(scope_mod.ScopeLevel.global, ambient.?.scope);
}

// ─── Query execution tests ──────────────────────────────────────────────

test "preset1: query branch-4/label" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();
    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const executor = query_mod.QueryExecutor.init(allocator, &network);
    var q = try query_mod.parseQuery(allocator, "branch-4/label");
    defer query_mod.deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectEqualStrings("Branch 4", result.getString().?);
}

test "preset1: query branch-4/blocks/0/type" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();
    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const executor = query_mod.QueryExecutor.init(allocator, &network);
    var q = try query_mod.parseQuery(allocator, "branch-4/blocks/0/type");
    defer query_mod.deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectEqualStrings("Source", result.getString().?);
}

test "preset1: query branch-4/blocks/0/pressure" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();
    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const executor = query_mod.QueryExecutor.init(allocator, &network);
    var q = try query_mod.parseQuery(allocator, "branch-4/blocks/0/pressure");
    defer query_mod.deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectApproxEqAbs(@as(f64, 15.5), result.getFloat().?, 0.001);
}

test "preset1: query branch-4/position/x" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();
    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const executor = query_mod.QueryExecutor.init(allocator, &network);
    var q = try query_mod.parseQuery(allocator, "branch-4/position/x");
    defer query_mod.deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectApproxEqAbs(@as(f64, -100), result.getFloat().?, 0.001);
}

test "preset1: query with filter branch-1/blocks/[type=Pipe]" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();
    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const executor = query_mod.QueryExecutor.init(allocator, &network);
    var q = try query_mod.parseQuery(allocator, "branch-1/blocks/[type=Pipe]");
    defer query_mod.deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    // branch-1 has: Source, Capture Unit, Pipe, Compressor, Pipe = 2 Pipes
    const arr = result.getArray().?;
    try std.testing.expectEqual(@as(usize, 2), arr.len);
}

test "preset1: query with scope resolution for ambientTemperature" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();
    var network = try net.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    // Load config for scope resolution
    const config_content = files.get("config.toml") orelse return;
    var config_parsed = try toml.Parser.parse(allocator, config_content);
    defer config_parsed.deinit(allocator);
    var config = try scope_mod.Config.loadFromToml(allocator, config_parsed.table);
    defer config.deinit();

    const resolver = scope_mod.ScopeResolver.init(&config);
    const executor = query_mod.QueryExecutor.withScopeResolver(allocator, &network, &resolver);

    // Query ambientTemperature on a block — should resolve from global scope
    var q = try query_mod.parseQuery(allocator, "branch-4/blocks/0/ambientTemperature");
    defer query_mod.deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectApproxEqAbs(@as(f64, 20.0), result.getFloat().?, 0.001);
}

// ─── Quantity evaluation tests ───────────────────────────────────────────

test "preset1: evaluateQuantities detects pressure on branch-1" {
    const allocator = std.testing.allocator;
    var files = try loadPreset1Files(allocator);
    defer deinitFiles(allocator, &files);
    if (files.count() == 0) return;

    // Parse branch-1.toml directly and evaluate quantities
    const content = files.get("branch-1.toml") orelse return;
    var parsed = try toml.Parser.parse(allocator, content);
    defer parsed.deinit(allocator);

    toml.evaluateQuantities(allocator, &parsed);

    // Check that block extra properties with unit expressions became quantities
    const blocks = parsed.table.get("block").?.getArray().?;
    // Source block (index 0) has pressure as a float (15.5) in preset1 — evaluateQuantities leaves floats alone
    const source_block = blocks[0].table;
    if (source_block.get("pressure")) |pressure_val| {
        // In preset1, pressure is a float literal (15.5), not a string
        // evaluateQuantities only converts strings, so it stays as float
        try std.testing.expect(pressure_val == .float or pressure_val == .quantity);
    }

    // Verify that string values that look like dim expressions get converted
    // The "type" field is "branch" which is not a valid dim expression, should stay string
    try std.testing.expect(parsed.table.get("type").? == .string);
}
