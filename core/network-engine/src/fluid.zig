const std = @import("std");
const network_mod = @import("network.zig");
const toml = @import("toml.zig");
const Network = network_mod.Network;
const ValidationResult = network_mod.ValidationResult;
const Value = toml.Value;
const Allocator = std.mem.Allocator;

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/// Mole fractions for each component in the fluid mixture.
/// Keys are component names (e.g. "CO2", "N2", "Ar"). Values should sum to 1.0.
pub const Composition = struct {
    components: std.StringArrayHashMapUnmanaged(f64) = .{},

    pub fn deinit(self: *Composition, allocator: Allocator) void {
        var it = self.components.iterator();
        while (it.next()) |entry| allocator.free(entry.key_ptr.*);
        self.components.deinit(allocator);
    }

    pub fn clone(self: *const Composition, allocator: Allocator) !Composition {
        var out = Composition{};
        errdefer out.deinit(allocator);
        var it = self.components.iterator();
        while (it.next()) |entry| {
            const key = try allocator.dupe(u8, entry.key_ptr.*);
            errdefer allocator.free(key);
            try out.components.put(allocator, key, entry.value_ptr.*);
        }
        return out;
    }
};

// ---------------------------------------------------------------------------
// BranchFluid / FluidMap
// ---------------------------------------------------------------------------

pub const BranchFluid = struct {
    composition: Composition,
    /// Total mass flow rate into this branch, in the units the source specifies.
    flow_rate: f64,
};

/// Maps branch IDs to their derived fluid (composition + flow rate).
pub const FluidMap = struct {
    entries: std.StringArrayHashMapUnmanaged(BranchFluid) = .{},

    pub fn deinit(self: *FluidMap, allocator: Allocator) void {
        var it = self.entries.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            entry.value_ptr.composition.deinit(allocator);
        }
        self.entries.deinit(allocator);
    }

    pub fn get(self: *const FluidMap, branch_id: []const u8) ?BranchFluid {
        return self.entries.get(branch_id);
    }
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Read a Composition from the "composition" sub-table of a block's extra properties.
/// Returns null if the key is absent or the value is not a table.
fn compositionFromExtra(allocator: Allocator, extra: Value.Table) !?Composition {
    const val = extra.get("composition") orelse return null;
    const tbl = val.getTable() orelse return null;

    var comp = Composition{};
    errdefer comp.deinit(allocator);

    var it = tbl.iterator();
    while (it.next()) |entry| {
        const frac = entry.value_ptr.getFloat() orelse continue;
        const key = try allocator.dupe(u8, entry.key_ptr.*);
        errdefer allocator.free(key);
        try comp.components.put(allocator, key, frac);
    }

    if (comp.components.count() == 0) {
        comp.deinit(allocator);
        return null;
    }

    return comp;
}

/// Read a flow rate from a block's extra properties ("flow_rate" key).
fn flowRateFromExtra(extra: Value.Table) ?f64 {
    return if (extra.get("flow_rate")) |v| v.getFloat() else null;
}

/// Blend (new_comp, new_flow) into an accumulator (acc_comp, acc_flow) in place.
/// Uses flow-rate-weighted averaging of mol fractions.
fn blendInto(
    allocator: Allocator,
    acc_comp: *Composition,
    acc_flow: *f64,
    new_comp: *const Composition,
    new_flow: f64,
) !void {
    const total = acc_flow.* + new_flow;
    if (total == 0.0) return;

    // Scale existing components by their weight in the blend.
    var it = acc_comp.components.iterator();
    while (it.next()) |entry| {
        const w_acc = entry.value_ptr.* * acc_flow.*;
        const w_new = if (new_comp.components.get(entry.key_ptr.*)) |f| f * new_flow else 0.0;
        entry.value_ptr.* = (w_acc + w_new) / total;
    }

    // Add any components present in new_comp but not yet in acc_comp.
    var it2 = new_comp.components.iterator();
    while (it2.next()) |entry| {
        if (acc_comp.components.contains(entry.key_ptr.*)) continue;
        const w_new = entry.value_ptr.* * new_flow / total;
        const key = try allocator.dupe(u8, entry.key_ptr.*);
        errdefer allocator.free(key);
        try acc_comp.components.put(allocator, key, w_new);
    }

    acc_flow.* = total;
}

// ---------------------------------------------------------------------------
// Propagation
// ---------------------------------------------------------------------------

/// Propagate fluid and inject results into branch `extra` tables in one step.
///
/// After this call, each resolved branch has two additional properties accessible
/// through the query engine:
///   - `flow_rate`   — total mass flow rate (f64)
///   - `composition` — subtable mapping component names to mol fractions
///
/// This is the primary entry point for callers; `propagate` is the lower-level
/// primitive if you need the `FluidMap` itself.
pub fn propagateAndInject(
    allocator: Allocator,
    net: *Network,
    validation: *ValidationResult,
) !void {
    var fluid_map = try propagate(allocator, net, validation);
    defer fluid_map.deinit(allocator);

    for (net.nodes.items) |*node| {
        switch (node.*) {
            .branch => |*b| {
                const bf = fluid_map.get(b.base.id) orelse continue;
                try b.base.extra.put(allocator, try allocator.dupe(u8, "flow_rate"), Value{ .float = bf.flow_rate });
                var comp_table = Value.Table{};
                var comp_it = bf.composition.components.iterator();
                while (comp_it.next()) |entry| {
                    try comp_table.put(allocator, try allocator.dupe(u8, entry.key_ptr.*), Value{ .float = entry.value_ptr.* });
                }
                try b.base.extra.put(allocator, try allocator.dupe(u8, "composition"), Value{ .table = comp_table });
            },
            else => {},
        }
    }
}

/// Propagate fluid compositions forward through the network DAG from source blocks.
///
/// Source blocks (type = "Source") define inlet conditions:
///
///   [[block]]
///   type = "Source"
///   flow_rate = 10.0        -- mass flow rate (any consistent unit)
///   composition.CO2 = 0.95  -- mol fractions; components sum to 1.0
///   composition.N2  = 0.03
///   composition.Ar  = 0.02
///
/// Each branch receives the flow-rate-weighted blend of all incoming compositions.
/// Branches with no resolvable fluid are skipped with a warning.
///
/// Returns a FluidMap mapping branch IDs to their derived BranchFluid.
/// Caller owns the result and must call FluidMap.deinit().
pub fn propagate(
    allocator: Allocator,
    net: *const Network,
    validation: *ValidationResult,
) !FluidMap {
    var result = FluidMap{};
    errdefer result.deinit(allocator);

    // Build in-degree counts for branch nodes, keyed by their IDs.
    // We borrow the IDs from the network (they outlive this call).
    var in_degree = std.StringArrayHashMapUnmanaged(u32){};
    defer in_degree.deinit(allocator);

    for (net.nodes.items) |*node| {
        switch (node.*) {
            .branch => |*b| {
                if (!in_degree.contains(b.base.id)) {
                    try in_degree.put(allocator, b.base.id, 0);
                }
            },
            else => {},
        }
    }

    for (net.edges.items) |*edge| {
        if (in_degree.getPtr(edge.target)) |deg| deg.* += 1;
    }

    // Kahn's queue: branch IDs with in_degree 0.
    // We use a simple slice-of-index approach: append to the list,
    // advance head to process in order.
    var queue = std.ArrayListUnmanaged([]const u8){};
    defer queue.deinit(allocator);

    // Working copy of in_degree so we can decrement without touching the original.
    var remaining = std.StringArrayHashMapUnmanaged(u32){};
    defer remaining.deinit(allocator);

    // Cache the total outgoing weight for each branch so downstream propagation
    // can split a branch's resolved flow across its outgoing edges.
    var outgoing_weight_totals = std.StringArrayHashMapUnmanaged(u32){};
    defer outgoing_weight_totals.deinit(allocator);

    {
        var it = in_degree.iterator();
        while (it.next()) |entry| {
            try remaining.put(allocator, entry.key_ptr.*, entry.value_ptr.*);
            if (entry.value_ptr.* == 0) {
                try queue.append(allocator, entry.key_ptr.*);
            }
        }
    }

    for (net.nodes.items) |*node| {
        switch (node.*) {
            .branch => |*b| {
                var total_weight: u32 = 0;
                for (b.outgoing.items) |out| {
                    total_weight += out.weight;
                }
                try outgoing_weight_totals.put(allocator, b.base.id, total_weight);
            },
            else => {},
        }
    }

    var head: usize = 0;
    while (head < queue.items.len) {
        const branch_id = queue.items[head];
        head += 1;

        const branch = net.findBranch(branch_id) orelse continue;

        // Check for a Source block defining composition and flow rate.
        var source_comp: ?Composition = null;
        var source_flow: f64 = 0.0;
        for (branch.blocks.items) |*block| {
            if (!std.mem.eql(u8, block.type_name, "Source")) continue;
            if (try compositionFromExtra(allocator, block.extra)) |comp| {
                source_comp = comp;
                source_flow = flowRateFromExtra(block.extra) orelse 0.0;
                break;
            }
        }
        errdefer if (source_comp) |*c| c.deinit(allocator);

        // Gather incoming fluid from already-resolved upstream branches.
        var acc_comp: ?Composition = null;
        var acc_flow: f64 = 0.0;
        errdefer if (acc_comp) |*c| c.deinit(allocator);

        for (net.edges.items) |*edge| {
            if (!std.mem.eql(u8, edge.target, branch_id)) continue;
            const upstream = result.entries.getPtr(edge.source) orelse continue;
            const total_outgoing_weight = outgoing_weight_totals.get(edge.source) orelse 0;
            if (total_outgoing_weight == 0) {
                try validation.addWarningFmt(
                    "Branch '{s}' has zero total outgoing weight; downstream propagation to '{s}' skipped",
                    .{ edge.source, edge.target },
                );
                continue;
            }

            const contributed_flow = upstream.flow_rate
                * @as(f64, @floatFromInt(edge.weight))
                / @as(f64, @floatFromInt(total_outgoing_weight));
            if (contributed_flow == 0.0) continue;

            if (acc_comp == null) {
                acc_comp = try upstream.composition.clone(allocator);
                acc_flow = contributed_flow;
            } else {
                try blendInto(allocator, &acc_comp.?, &acc_flow, &upstream.composition, contributed_flow);
            }
        }

        // Combine source injection (if any) with incoming stream (if any).
        var final_comp: Composition = undefined;
        var final_flow: f64 = undefined;

        if (source_comp != null and acc_comp != null) {
            var sc = source_comp.?;
            defer sc.deinit(allocator);
            try blendInto(allocator, &acc_comp.?, &acc_flow, &sc, source_flow);
            final_comp = acc_comp.?;
            final_flow = acc_flow;
        } else if (source_comp) |sc| {
            final_comp = sc;
            final_flow = source_flow;
        } else if (acc_comp) |ac| {
            final_comp = ac;
            final_flow = acc_flow;
        } else {
            try validation.addWarningFmt(
                "Branch '{s}' has no source composition and no upstream fluid — skipped",
                .{branch_id},
            );
            continue;
        }

        const key = try allocator.dupe(u8, branch_id);
        errdefer allocator.free(key);
        try result.entries.put(allocator, key, .{
            .composition = final_comp,
            .flow_rate = final_flow,
        });

        // Decrement downstream in-degrees; enqueue branches that become ready.
        for (net.edges.items) |*edge| {
            if (!std.mem.eql(u8, edge.source, branch_id)) continue;
            if (remaining.getPtr(edge.target)) |deg| {
                deg.* -= 1;
                if (deg.* == 0) try queue.append(allocator, edge.target);
            }
        }
    }

    return result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test "single source branch gets its own composition" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);
    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\[[block]]
        \\type = "Source"
        \\flow_rate = 10.0
        \\composition = {CO2 = 0.95, N2 = 0.05}
    );

    var validation = network_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var net = try network_mod.loadNetworkFromFiles(allocator, &files, &validation);
    defer net.deinit(allocator);

    var fluid_map = try propagate(allocator, &net, &validation);
    defer fluid_map.deinit(allocator);

    const bf = fluid_map.get("branch-1").?;
    try std.testing.expectApproxEqAbs(@as(f64, 10.0), bf.flow_rate, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.95), bf.composition.components.get("CO2").?, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.05), bf.composition.components.get("N2").?, 1e-9);
}

test "downstream branch inherits upstream composition" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);
    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\[[outgoing]]
        \\target = "branch-2"
        \\[[block]]
        \\type = "Source"
        \\flow_rate = 10.0
        \\composition = {CO2 = 1.0}
    );
    try files.put(allocator, "branch-2.toml",
        \\type = "branch"
        \\[[block]]
        \\type = "Pipe"
    );

    var validation = network_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var net = try network_mod.loadNetworkFromFiles(allocator, &files, &validation);
    defer net.deinit(allocator);

    var fluid_map = try propagate(allocator, &net, &validation);
    defer fluid_map.deinit(allocator);

    const bf = fluid_map.get("branch-2").?;
    try std.testing.expectApproxEqAbs(@as(f64, 10.0), bf.flow_rate, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 1.0), bf.composition.components.get("CO2").?, 1e-9);
}

test "junction blends two upstream compositions by flow rate" {
    const allocator = std.testing.allocator;

    // branch-1: 10 kg/s, pure CO2
    // branch-2:  5 kg/s, pure N2
    // branch-3: downstream of both — expect 2:1 blend → CO2=0.667, N2=0.333
    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);
    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\[[outgoing]]
        \\target = "branch-3"
        \\[[block]]
        \\type = "Source"
        \\flow_rate = 10.0
        \\composition = {CO2 = 1.0}
    );
    try files.put(allocator, "branch-2.toml",
        \\type = "branch"
        \\[[outgoing]]
        \\target = "branch-3"
        \\[[block]]
        \\type = "Source"
        \\flow_rate = 5.0
        \\composition = {N2 = 1.0}
    );
    try files.put(allocator, "branch-3.toml",
        \\type = "branch"
        \\[[block]]
        \\type = "Pipe"
    );

    var validation = network_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var net = try network_mod.loadNetworkFromFiles(allocator, &files, &validation);
    defer net.deinit(allocator);

    var fluid_map = try propagate(allocator, &net, &validation);
    defer fluid_map.deinit(allocator);

    const bf = fluid_map.get("branch-3").?;
    try std.testing.expectApproxEqAbs(@as(f64, 15.0), bf.flow_rate, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 10.0 / 15.0), bf.composition.components.get("CO2").?, 1e-6);
    try std.testing.expectApproxEqAbs(@as(f64, 5.0 / 15.0), bf.composition.components.get("N2").?, 1e-6);
}

test "weighted downstream split affects merged flow rate and composition" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\[[outgoing]]
        \\target = "branch-2"
        \\weight = 1
        \\[[block]]
        \\type = "Source"
        \\flow_rate = 1.0
        \\composition = {carbonDioxideFraction = 0.96, hydrogenFraction = 0.0075, nitrogenFraction = 0.0325}
    );
    try files.put(allocator, "branch-4.toml",
        \\type = "branch"
        \\[[outgoing]]
        \\target = "branch-2"
        \\weight = 1
        \\[[block]]
        \\type = "Source"
        \\flow_rate = 3.0
        \\composition = {carbonDioxideFraction = 0.96, hydrogenFraction = 0.0075, nitrogenFraction = 0.0325}
    );
    try files.put(allocator, "branch-2.toml",
        \\type = "branch"
        \\[[outgoing]]
        \\target = "branch-3"
        \\weight = 1
        \\[[outgoing]]
        \\target = "branch-5"
        \\weight = 3
        \\[[block]]
        \\type = "Pipe"
    );
    try files.put(allocator, "branch-3.toml",
        \\type = "branch"
        \\[[block]]
        \\type = "Pipe"
    );
    try files.put(allocator, "branch-8.toml",
        \\type = "branch"
        \\[[outgoing]]
        \\target = "branch-5"
        \\weight = 1
        \\[[block]]
        \\type = "Source"
        \\flow_rate = 2.0
        \\composition = {carbonDioxideFraction = 0.9, hydrogenFraction = 0.0675, nitrogenFraction = 0.0325}
    );
    try files.put(allocator, "branch-5.toml",
        \\type = "branch"
        \\[[block]]
        \\type = "Pipe"
    );

    var validation = network_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var net = try network_mod.loadNetworkFromFiles(allocator, &files, &validation);
    defer net.deinit(allocator);

    var fluid_map = try propagate(allocator, &net, &validation);
    defer fluid_map.deinit(allocator);

    const branch_3 = fluid_map.get("branch-3").?;
    try std.testing.expectApproxEqAbs(@as(f64, 1.0), branch_3.flow_rate, 1e-9);

    const branch_5 = fluid_map.get("branch-5").?;
    try std.testing.expectApproxEqAbs(@as(f64, 5.0), branch_5.flow_rate, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.936), branch_5.composition.components.get("carbonDioxideFraction").?, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0315), branch_5.composition.components.get("hydrogenFraction").?, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0325), branch_5.composition.components.get("nitrogenFraction").?, 1e-9);
}

test "branch with no source or upstream gets a warning" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);
    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\[[block]]
        \\type = "Pipe"
    );

    var validation = network_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var net = try network_mod.loadNetworkFromFiles(allocator, &files, &validation);
    defer net.deinit(allocator);

    var fluid_map = try propagate(allocator, &net, &validation);
    defer fluid_map.deinit(allocator);

    try std.testing.expect(fluid_map.get("branch-1") == null);
    try std.testing.expectEqual(@as(usize, 1), validation.warnings.items.len);
}
