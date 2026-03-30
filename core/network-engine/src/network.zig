const std = @import("std");
const toml = @import("toml.zig");
const Allocator = std.mem.Allocator;
const Value = toml.Value;

// ─── Core types ──────────────────────────────────────────────────────────

pub const Position = struct {
    x: f64 = 0,
    y: f64 = 0,
};

pub const Outgoing = struct {
    target: []const u8,
    weight: u32 = 1,
};

pub const Block = struct {
    type_name: []const u8,
    quantity: ?u32 = null,
    extra: Value.Table = .{},
};

pub const NodeBase = struct {
    id: []const u8,
    type_name: []const u8,
    label: ?[]const u8 = null,
    parent_id: ?[]const u8 = null,
    position: Position = .{},
    width: ?f64 = null,
    height: ?f64 = null,
    extra: Value.Table = .{},
};

pub const BranchNode = struct {
    base: NodeBase,
    blocks: std.ArrayListUnmanaged(Block) = .{},
    outgoing: std.ArrayListUnmanaged(Outgoing) = .{},
};

pub const GroupNode = struct {
    base: NodeBase,
};

pub const GeographicAnchorNode = struct {
    base: NodeBase,
};

pub const GeographicWindowNode = struct {
    base: NodeBase,
};

pub const ImageNode = struct {
    base: NodeBase,
    path: []const u8 = "",
};

pub const NodeData = union(enum) {
    branch: BranchNode,
    group: GroupNode,
    geographic_anchor: GeographicAnchorNode,
    geographic_window: GeographicWindowNode,
    image: ImageNode,

    pub fn base(self: *const NodeData) *const NodeBase {
        return switch (self.*) {
            .branch => |*n| &n.base,
            .group => |*n| &n.base,
            .geographic_anchor => |*n| &n.base,
            .geographic_window => |*n| &n.base,
            .image => |*n| &n.base,
        };
    }

    pub fn id(self: *const NodeData) []const u8 {
        return self.base().id;
    }
};

pub const Edge = struct {
    id: []const u8,
    source: []const u8,
    target: []const u8,
    weight: u32 = 1,
};

pub const Network = struct {
    id: []const u8 = "",
    label: []const u8 = "",
    nodes: std.ArrayListUnmanaged(NodeData) = .{},
    edges: std.ArrayListUnmanaged(Edge) = .{},

    pub fn findNode(self: *const Network, node_id: []const u8) ?*const NodeData {
        for (self.nodes.items) |*node| {
            if (std.mem.eql(u8, node.id(), node_id)) {
                return node;
            }
        }
        return null;
    }

    pub fn findBranch(self: *const Network, node_id: []const u8) ?*const BranchNode {
        for (self.nodes.items) |*node| {
            switch (node.*) {
                .branch => |*b| {
                    if (std.mem.eql(u8, b.base.id, node_id)) return b;
                },
                else => {},
            }
        }
        return null;
    }

    pub fn findGroup(self: *const Network, node_id: []const u8) ?*const GroupNode {
        for (self.nodes.items) |*node| {
            switch (node.*) {
                .group => |*g| {
                    if (std.mem.eql(u8, g.base.id, node_id)) return g;
                },
                else => {},
            }
        }
        return null;
    }

    pub fn deinit(self: *Network, allocator: Allocator) void {
        for (self.nodes.items) |*node| {
            deinitNode(node, allocator);
        }
        self.nodes.deinit(allocator);

        for (self.edges.items) |*edge| {
            allocator.free(edge.id);
            allocator.free(edge.source);
            allocator.free(edge.target);
        }
        self.edges.deinit(allocator);

        if (self.id.len > 0) allocator.free(self.id);
        if (self.label.len > 0) allocator.free(self.label);
    }
};

fn deinitNode(node: *NodeData, allocator: Allocator) void {
    switch (node.*) {
        .branch => |*b| {
            deinitBase(&b.base, allocator);
            for (b.blocks.items) |*block| {
                allocator.free(block.type_name);
                var extra = block.extra;
                var it = extra.iterator();
                while (it.next()) |entry| {
                    allocator.free(entry.key_ptr.*);
                    entry.value_ptr.deinit(allocator);
                }
                extra.deinit(allocator);
            }
            b.blocks.deinit(allocator);
            for (b.outgoing.items) |*o| {
                allocator.free(o.target);
            }
            b.outgoing.deinit(allocator);
        },
        .group => |*n| deinitBase(&n.base, allocator),
        .geographic_anchor => |*n| deinitBase(&n.base, allocator),
        .geographic_window => |*n| deinitBase(&n.base, allocator),
        .image => |*n| {
            if (n.path.len > 0) allocator.free(n.path);
            deinitBase(&n.base, allocator);
        },
    }
}

fn deinitBase(b: *NodeBase, allocator: Allocator) void {
    allocator.free(b.id);
    allocator.free(b.type_name);
    if (b.label) |l| allocator.free(l);
    if (b.parent_id) |p| allocator.free(p);
    var extra = b.extra;
    var it = extra.iterator();
    while (it.next()) |entry| {
        allocator.free(entry.key_ptr.*);
        entry.value_ptr.deinit(allocator);
    }
    extra.deinit(allocator);
}

// ─── Validation ─────────────────────────────────────────────────────────

pub const IssueSeverity = enum { err, warning };

pub const ValidationIssue = struct {
    severity: IssueSeverity,
    message: []const u8,
    location: ?[]const u8 = null,
};

pub const ValidationResult = struct {
    errors: std.ArrayListUnmanaged(ValidationIssue) = .{},
    warnings: std.ArrayListUnmanaged(ValidationIssue) = .{},
    allocator: Allocator,

    pub fn init(allocator: Allocator) ValidationResult {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *ValidationResult) void {
        for (self.errors.items) |issue| {
            self.allocator.free(issue.message);
            if (issue.location) |l| self.allocator.free(l);
        }
        self.errors.deinit(self.allocator);
        for (self.warnings.items) |issue| {
            self.allocator.free(issue.message);
            if (issue.location) |l| self.allocator.free(l);
        }
        self.warnings.deinit(self.allocator);
    }

    pub fn addError(self: *ValidationResult, msg: []const u8) !void {
        try self.errors.append(self.allocator, .{ .severity = .err, .message = try self.allocator.dupe(u8, msg) });
    }

    pub fn addWarning(self: *ValidationResult, msg: []const u8) !void {
        try self.warnings.append(self.allocator, .{ .severity = .warning, .message = try self.allocator.dupe(u8, msg) });
    }

    pub fn addErrorFmt(self: *ValidationResult, comptime fmt: []const u8, args: anytype) !void {
        const msg = try std.fmt.allocPrint(self.allocator, fmt, args);
        try self.errors.append(self.allocator, .{ .severity = .err, .message = msg });
    }

    pub fn addWarningFmt(self: *ValidationResult, comptime fmt: []const u8, args: anytype) !void {
        const msg = try std.fmt.allocPrint(self.allocator, fmt, args);
        try self.warnings.append(self.allocator, .{ .severity = .warning, .message = msg });
    }

    pub fn isValid(self: *const ValidationResult) bool {
        return self.errors.items.len == 0;
    }
};

// ─── Loader ─────────────────────────────────────────────────────────────

pub const LoadError = error{
    MissingTypeField,
    UnknownNodeType,
    InvalidConfig,
    ParseFailed,
    OutOfMemory,
    IoError,
};

/// Load a network from a map of filename -> TOML content strings.
pub fn loadNetworkFromFiles(
    allocator: Allocator,
    files: *const std.StringArrayHashMapUnmanaged([]const u8),
    validation: *ValidationResult,
) LoadError!Network {
    var network = Network{};
    errdefer network.deinit(allocator);

    // Parse config.toml if present
    if (files.get("config.toml")) |config_content| {
        var config_val = toml.Parser.parse(allocator, config_content) catch {
            try validation.addError("Failed to parse config.toml");
            return LoadError.ParseFailed;
        };
        defer config_val.deinit(allocator);

        // Extract id and label from config
        if (config_val.table.get("id")) |id_val| {
            if (id_val.getString()) |s| {
                network.id = try allocator.dupe(u8, s);
            }
        }
        if (config_val.table.get("label")) |label_val| {
            if (label_val.getString()) |s| {
                network.label = try allocator.dupe(u8, s);
            }
        }
    }

    // Parse each node file
    var it = files.iterator();
    while (it.next()) |entry| {
        const filename = entry.key_ptr.*;
        const content = entry.value_ptr.*;

        if (std.mem.eql(u8, filename, "config.toml")) continue;
        if (!std.mem.endsWith(u8, filename, ".toml")) continue;

        // Derive node ID from filename
        const node_id = filename[0 .. filename.len - 5]; // strip .toml

        var parsed = toml.Parser.parse(allocator, content) catch {
            try validation.addWarningFmt("Failed to parse {s}", .{filename});
            continue;
        };
        defer parsed.deinit(allocator);

        const node = loadNode(allocator, node_id, &parsed, validation) catch |e| {
            switch (e) {
                LoadError.MissingTypeField, LoadError.UnknownNodeType => {
                    continue;
                },
                else => return e,
            }
        };

        try network.nodes.append(allocator, node);
    }

    // Build edges from branch outgoing connections
    for (network.nodes.items) |*node| {
        switch (node.*) {
            .branch => |*branch| {
                for (branch.outgoing.items) |out| {
                    const edge_id = try std.fmt.allocPrint(allocator, "{s}_{s}", .{ branch.base.id, out.target });
                    errdefer allocator.free(edge_id);

                    // Validate target exists
                    if (network.findNode(out.target) == null) {
                        try validation.addWarningFmt("Edge target '{s}' not found (from {s})", .{ out.target, branch.base.id });
                    }

                    try network.edges.append(allocator, .{
                        .id = edge_id,
                        .source = try allocator.dupe(u8, branch.base.id),
                        .target = try allocator.dupe(u8, out.target),
                        .weight = out.weight,
                    });
                }
            },
            else => {},
        }
    }

    // Validate parent_id references
    for (network.nodes.items) |*node| {
        const b = node.base();
        if (b.parent_id) |pid| {
            if (network.findNode(pid) == null) {
                try validation.addWarningFmt("Node '{s}' references parent '{s}' which doesn't exist", .{ b.id, pid });
            }
        }
    }

    return network;
}

fn loadNode(
    allocator: Allocator,
    node_id: []const u8,
    parsed: *Value,
    validation: *ValidationResult,
) LoadError!NodeData {
    const type_str = blk: {
        if (parsed.table.get("type")) |t| {
            if (t.getString()) |s| break :blk s;
        }
        try validation.addWarningFmt("Node '{s}' missing 'type' field", .{node_id});
        return LoadError.MissingTypeField;
    };

    const owned_id = try allocator.dupe(u8, node_id);
    errdefer allocator.free(owned_id);
    const owned_type = try allocator.dupe(u8, type_str);
    errdefer allocator.free(owned_type);

    var base = NodeBase{
        .id = owned_id,
        .type_name = owned_type,
    };

    // Extract common fields
    if (parsed.table.get("label")) |v| {
        if (v.getString()) |s| base.label = try allocator.dupe(u8, s);
    }
    if (parsed.table.get("parent_id")) |v| {
        if (v.getString()) |s| base.parent_id = try allocator.dupe(u8, s);
    }
    // Also check parentId (camelCase from dagger)
    if (base.parent_id == null) {
        if (parsed.table.get("parentId")) |v| {
            if (v.getString()) |s| base.parent_id = try allocator.dupe(u8, s);
        }
    }
    if (parsed.table.get("position")) |pos_val| {
        const pos_table = pos_val.table;
        if (pos_table.get("x")) |x| base.position.x = x.getFloat() orelse 0;
        if (pos_table.get("y")) |y| base.position.y = y.getFloat() orelse 0;
    }
    if (parsed.table.get("width")) |v| base.width = v.getFloat();
    if (parsed.table.get("height")) |v| base.height = v.getFloat();

    // Collect extra properties (everything not a known field)
    const known_fields = [_][]const u8{ "type", "label", "parent_id", "parentId", "position", "width", "height", "outgoing", "block", "path" };
    var extra_it = parsed.table.iterator();
    while (extra_it.next()) |entry| {
        var is_known = false;
        for (known_fields) |kf| {
            if (std.mem.eql(u8, entry.key_ptr.*, kf)) {
                is_known = true;
                break;
            }
        }
        if (!is_known) {
            // Clone the key and value into extra
            const extra_key = try allocator.dupe(u8, entry.key_ptr.*);
            errdefer allocator.free(extra_key);
            const extra_val = try entry.value_ptr.clone(allocator);
            try base.extra.put(allocator, extra_key, extra_val);
        }
    }

    if (std.mem.eql(u8, type_str, "branch")) {
        var branch = BranchNode{ .base = base };
        errdefer {
            for (branch.blocks.items) |*bl| {
                allocator.free(bl.type_name);
                var eit = bl.extra.iterator();
                while (eit.next()) |e| {
                    allocator.free(e.key_ptr.*);
                    e.value_ptr.deinit(allocator);
                }
                bl.extra.deinit(allocator);
            }
            branch.blocks.deinit(allocator);
            for (branch.outgoing.items) |*o| allocator.free(o.target);
            branch.outgoing.deinit(allocator);
        }

        // Parse blocks
        if (parsed.table.get("block")) |blocks_val| {
            if (blocks_val.getArray()) |blocks| {
                for (blocks) |block_val| {
                    const block = try loadBlock(allocator, block_val.table);
                    try branch.blocks.append(allocator, block);
                }
            }
        }

        // Parse outgoing
        if (parsed.table.get("outgoing")) |outgoing_val| {
            if (outgoing_val.getArray()) |outgoing_arr| {
                for (outgoing_arr) |out_val| {
                    const out_table = out_val.table;
                    const target = out_table.get("target").?.getString().?;
                    const weight: u32 = if (out_table.get("weight")) |w|
                        @intCast(w.getInteger() orelse 1)
                    else
                        1;

                    try branch.outgoing.append(allocator, .{
                        .target = try allocator.dupe(u8, target),
                        .weight = weight,
                    });
                }
            }
        }

        return NodeData{ .branch = branch };
    } else if (std.mem.eql(u8, type_str, "labeledGroup")) {
        return NodeData{ .group = .{ .base = base } };
    } else if (std.mem.eql(u8, type_str, "geographicAnchor")) {
        return NodeData{ .geographic_anchor = .{ .base = base } };
    } else if (std.mem.eql(u8, type_str, "geographicWindow")) {
        return NodeData{ .geographic_window = .{ .base = base } };
    } else if (std.mem.eql(u8, type_str, "image")) {
        var img = ImageNode{ .base = base };
        if (parsed.table.get("path")) |p| {
            if (p.getString()) |s| img.path = try allocator.dupe(u8, s);
        }
        return NodeData{ .image = img };
    } else {
        try validation.addWarningFmt("Unknown node type '{s}' for node '{s}'", .{ type_str, node_id });
        return LoadError.UnknownNodeType;
    }
}

fn loadBlock(allocator: Allocator, block_table: Value.Table) !Block {
    const type_str = block_table.get("type").?.getString().?;

    var block = Block{
        .type_name = try allocator.dupe(u8, type_str),
    };

    if (block_table.get("quantity")) |q| {
        if (q.getInteger()) |i| block.quantity = @intCast(i);
    }

    // Collect extra properties
    const known_block_fields = [_][]const u8{ "type", "quantity" };
    var it = block_table.iterator();
    while (it.next()) |entry| {
        var is_known = false;
        for (known_block_fields) |kf| {
            if (std.mem.eql(u8, entry.key_ptr.*, kf)) {
                is_known = true;
                break;
            }
        }
        if (!is_known) {
            const extra_key = try allocator.dupe(u8, entry.key_ptr.*);
            errdefer allocator.free(extra_key);
            const extra_val = try entry.value_ptr.clone(allocator);
            try block.extra.put(allocator, extra_key, extra_val);
        }
    }

    return block;
}

// ─── Tests ──────────────────────────────────────────────────────────────

test "load simple branch node" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\label = "Branch 1"
        \\
        \\[position]
        \\x = 100
        \\y = 200
        \\
        \\[[block]]
        \\type = "Source"
        \\pressure = 15.5
        \\
        \\[[block]]
        \\type = "Pipe"
        \\quantity = 1
    );

    var validation = ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    try std.testing.expect(validation.isValid());
    try std.testing.expectEqual(@as(usize, 1), network.nodes.items.len);

    const node = &network.nodes.items[0];
    try std.testing.expectEqualStrings("branch-1", node.id());

    const branch = &node.branch;
    try std.testing.expectEqualStrings("Branch 1", branch.base.label.?);
    try std.testing.expectApproxEqAbs(@as(f64, 100), branch.base.position.x, 0.001);
    try std.testing.expectApproxEqAbs(@as(f64, 200), branch.base.position.y, 0.001);

    try std.testing.expectEqual(@as(usize, 2), branch.blocks.items.len);
    try std.testing.expectEqualStrings("Source", branch.blocks.items[0].type_name);
    try std.testing.expectApproxEqAbs(@as(f64, 15.5), branch.blocks.items[0].extra.get("pressure").?.getFloat().?, 0.001);
    try std.testing.expectEqualStrings("Pipe", branch.blocks.items[1].type_name);
}

test "load branch node with nested block table" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\label = "Branch 1"
        \\
        \\[position]
        \\x = 100
        \\y = 200
        \\
        \\[[block]]
        \\type = "Source"
        \\pressure = 10
        \\
        \\[block.fluidComposition]
        \\carbonDioxideFraction = 0.96
        \\hydrogenFraction = 0.0075
        \\nitrogenFraction = 0.0325
        \\
        \\[[block]]
        \\type = "Pipe"
    );

    var validation = ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    try std.testing.expect(validation.isValid());
    try std.testing.expectEqual(@as(usize, 1), network.nodes.items.len);

    const branch = &network.nodes.items[0].branch;
    const fluid = branch.blocks.items[0].extra.get("fluidComposition").?.getTable().?;

    try std.testing.expectApproxEqAbs(@as(f64, 0.96), fluid.get("carbonDioxideFraction").?.getFloat().?, 0.001);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0075), fluid.get("hydrogenFraction").?.getFloat().?, 0.0001);
    try std.testing.expectApproxEqAbs(@as(f64, 0.0325), fluid.get("nitrogenFraction").?.getFloat().?, 0.0001);
    try std.testing.expectEqualStrings("Pipe", branch.blocks.items[1].type_name);
}

test "load network with edges" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\
        \\[[outgoing]]
        \\target = "branch-2"
        \\weight = 1
        \\
        \\[[block]]
        \\type = "Source"
    );
    try files.put(allocator, "branch-2.toml",
        \\type = "branch"
        \\
        \\[[block]]
        \\type = "Pipe"
    );

    var validation = ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    try std.testing.expect(validation.isValid());
    try std.testing.expectEqual(@as(usize, 2), network.nodes.items.len);
    try std.testing.expectEqual(@as(usize, 1), network.edges.items.len);

    const edge = &network.edges.items[0];
    try std.testing.expectEqualStrings("branch-1_branch-2", edge.id);
    try std.testing.expectEqualStrings("branch-1", edge.source);
    try std.testing.expectEqualStrings("branch-2", edge.target);
}

test "load group node" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "group-1.toml",
        \\type = "labeledGroup"
        \\label = "My Group"
        \\width = 700
        \\height = 300
        \\
        \\[position]
        \\x = 0
        \\y = 0
    );

    var validation = ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    try std.testing.expect(validation.isValid());
    const node = &network.nodes.items[0];
    try std.testing.expectEqualStrings("group-1", node.id());

    const group = &node.group;
    try std.testing.expectEqualStrings("My Group", group.base.label.?);
    try std.testing.expectApproxEqAbs(@as(f64, 700), group.base.width.?, 0.001);
}

test "validation warns on missing outgoing target" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\
        \\[[outgoing]]
        \\target = "nonexistent"
        \\
        \\[[block]]
        \\type = "Source"
    );

    var validation = ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    try std.testing.expectEqual(@as(usize, 1), validation.warnings.items.len);
}

test "load config.toml id and label" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "config.toml",
        \\id = "preset1"
        \\label = "Test Network"
    );

    var validation = ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    try std.testing.expectEqualStrings("preset1", network.id);
    try std.testing.expectEqualStrings("Test Network", network.label);
}
