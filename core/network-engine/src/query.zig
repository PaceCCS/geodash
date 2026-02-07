const std = @import("std");
const toml = @import("toml.zig");
const net = @import("network.zig");
const scope_mod = @import("scope.zig");
const Allocator = std.mem.Allocator;
const Value = toml.Value;

// ─── Query AST ──────────────────────────────────────────────────────────

pub const FilterOperator = enum {
    eq,
    neq,
    gt,
    lt,
    gte,
    lte,
};

pub const QuerySegment = union(enum) {
    node: []const u8, // branch-4
    property: []const u8, // label, blocks, etc.
    index: usize, // 0, 1, 2
    range: Range,
    filter: Filter,

    pub const Range = struct {
        start: ?usize = null,
        end: ?usize = null,
    };

    pub const Filter = struct {
        field: []const u8,
        operator: FilterOperator,
        value: []const u8,
    };
};

pub const QueryParams = struct {
    scopes: ?[]const scope_mod.ScopeLevel = null,
};

pub const Query = struct {
    segments: std.ArrayListUnmanaged(QuerySegment),
    params: QueryParams = .{},
};

// ─── Query Parser ───────────────────────────────────────────────────────

pub const QueryParseError = error{
    EmptyQuery,
    InvalidFilter,
    InvalidRange,
    InvalidSegment,
    OutOfMemory,
};

pub fn parseQuery(allocator: Allocator, input: []const u8) QueryParseError!Query {
    var query = Query{ .segments = .{} };
    errdefer query.segments.deinit(allocator);

    // Split off query params (?scope=...)
    var path_part = input;
    if (std.mem.indexOf(u8, input, "?")) |qmark| {
        path_part = input[0..qmark];
        const params_str = input[qmark + 1 ..];
        query.params = try parseParams(allocator, params_str);
    }

    if (path_part.len == 0) return QueryParseError.EmptyQuery;

    // Split by '/' and parse each segment
    var iter = std.mem.splitScalar(u8, path_part, '/');
    var first = true;
    while (iter.next()) |segment_str| {
        if (segment_str.len == 0) continue;

        const segment = try parseSegment(segment_str, first);
        try query.segments.append(allocator, segment);
        first = false;
    }

    if (query.segments.items.len == 0) return QueryParseError.EmptyQuery;

    return query;
}

fn parseSegment(segment: []const u8, is_first: bool) QueryParseError!QuerySegment {
    // Check for filter: property[field=value]
    if (std.mem.indexOf(u8, segment, "[")) |bracket_start| {
        if (segment[segment.len - 1] != ']') return QueryParseError.InvalidFilter;
        const filter_content = segment[bracket_start + 1 .. segment.len - 1];

        // Find operator
        var op: FilterOperator = undefined;
        var op_pos: usize = 0;
        var op_len: usize = 1;

        if (std.mem.indexOf(u8, filter_content, "!=")) |pos| {
            op = .neq;
            op_pos = pos;
            op_len = 2;
        } else if (std.mem.indexOf(u8, filter_content, ">=")) |pos| {
            op = .gte;
            op_pos = pos;
            op_len = 2;
        } else if (std.mem.indexOf(u8, filter_content, "<=")) |pos| {
            op = .lte;
            op_pos = pos;
            op_len = 2;
        } else if (std.mem.indexOf(u8, filter_content, "=")) |pos| {
            op = .eq;
            op_pos = pos;
        } else if (std.mem.indexOf(u8, filter_content, ">")) |pos| {
            op = .gt;
            op_pos = pos;
        } else if (std.mem.indexOf(u8, filter_content, "<")) |pos| {
            op = .lt;
            op_pos = pos;
        } else {
            return QueryParseError.InvalidFilter;
        }

        const field = filter_content[0..op_pos];
        const value = filter_content[op_pos + op_len ..];

        // The property name is before the bracket
        _ = segment[0..bracket_start]; // property name, used implicitly as the segment applies to current array

        return QuerySegment{ .filter = .{
            .field = field,
            .operator = op,
            .value = value,
        } };
    }

    // Check for range: start:end
    if (std.mem.indexOf(u8, segment, ":")) |colon_pos| {
        const start_str = segment[0..colon_pos];
        const end_str = segment[colon_pos + 1 ..];

        const start: ?usize = if (start_str.len > 0)
            std.fmt.parseInt(usize, start_str, 10) catch return QueryParseError.InvalidRange
        else
            null;

        const end: ?usize = if (end_str.len > 0)
            std.fmt.parseInt(usize, end_str, 10) catch return QueryParseError.InvalidRange
        else
            null;

        return QuerySegment{ .range = .{ .start = start, .end = end } };
    }

    // Check for numeric index
    if (std.fmt.parseInt(usize, segment, 10)) |idx| {
        return QuerySegment{ .index = idx };
    } else |_| {}

    // First segment is a node ID, rest are property names
    if (is_first) {
        return QuerySegment{ .node = segment };
    }
    return QuerySegment{ .property = segment };
}

fn parseParams(allocator: Allocator, params_str: []const u8) QueryParseError!QueryParams {
    var params = QueryParams{};

    var iter = std.mem.splitScalar(u8, params_str, '&');
    while (iter.next()) |param| {
        if (std.mem.indexOf(u8, param, "=")) |eq_pos| {
            const key = param[0..eq_pos];
            const value = param[eq_pos + 1 ..];

            if (std.mem.eql(u8, key, "scope")) {
                var levels = std.ArrayListUnmanaged(scope_mod.ScopeLevel){};
                var scope_iter = std.mem.splitScalar(u8, value, ',');
                while (scope_iter.next()) |s| {
                    if (scope_mod.ScopeLevel.fromString(s)) |level| {
                        try levels.append(allocator, level);
                    }
                }
                params.scopes = try levels.toOwnedSlice(allocator);
            }
        }
    }

    return params;
}

pub fn deinitQuery(allocator: Allocator, query: *Query) void {
    query.segments.deinit(allocator);
    if (query.params.scopes) |s| allocator.free(s);
}

// ─── Query Executor ─────────────────────────────────────────────────────

pub const QueryError = error{
    NodeNotFound,
    PropertyNotFound,
    IndexOutOfRange,
    InvalidType,
    OutOfMemory,
};

pub const QueryExecutor = struct {
    network: *const net.Network,
    scope_resolver: ?*const scope_mod.ScopeResolver = null,
    allocator: Allocator,

    pub fn init(allocator: Allocator, network: *const net.Network) QueryExecutor {
        return .{ .allocator = allocator, .network = network };
    }

    pub fn withScopeResolver(allocator: Allocator, network: *const net.Network, resolver: *const scope_mod.ScopeResolver) QueryExecutor {
        return .{ .allocator = allocator, .network = network, .scope_resolver = resolver };
    }

    /// Execute a query and return the result as a Value.
    /// Caller owns the returned value and must deinit it.
    pub fn execute(self: *const QueryExecutor, query: *const Query) QueryError!Value {
        if (query.segments.items.len == 0) return QueryError.PropertyNotFound;

        // Start by resolving the first segment (must be a node ID)
        const first = query.segments.items[0];
        var current = switch (first) {
            .node => |id| try self.nodeToValue(id),
            else => return QueryError.InvalidType,
        };
        errdefer current.deinit(self.allocator);

        // Track context for scope resolution
        const node_id: ?[]const u8 = switch (first) {
            .node => |id| id,
            else => null,
        };
        var block_index: ?usize = null;

        // Walk remaining segments
        for (query.segments.items[1..]) |segment| {
            const next = switch (segment) {
                .property => |name| blk: {
                    // Try direct property access first
                    const direct = self.getProperty(current, name);
                    if (direct) |val| {
                        break :blk try val.clone(self.allocator);
                    }

                    // Try scope resolution if we have context
                    if (self.scope_resolver) |resolver| {
                        if (node_id != null and block_index != null) {
                            if (self.tryResolveScoped(resolver, name, node_id.?, block_index.?, query.params.scopes)) |val| {
                                break :blk try val.clone(self.allocator);
                            }
                        }
                    }
                    return QueryError.PropertyNotFound;
                },
                .index => |idx| blk: {
                    block_index = idx;
                    const arr = current.getArray() orelse return QueryError.InvalidType;
                    if (idx >= arr.len) return QueryError.IndexOutOfRange;
                    break :blk try arr[idx].clone(self.allocator);
                },
                .range => |r| blk: {
                    const arr = current.getArray() orelse return QueryError.InvalidType;
                    const start = r.start orelse 0;
                    const end = @min(r.end orelse (arr.len -| 1), arr.len -| 1);
                    if (start > end or start >= arr.len) return QueryError.IndexOutOfRange;

                    var result_arr = Value.Array{};
                    for (arr[start .. end + 1]) |item| {
                        try result_arr.append(self.allocator, try item.clone(self.allocator));
                    }
                    break :blk Value{ .array = result_arr };
                },
                .filter => |f| blk: {
                    const arr = current.getArray() orelse return QueryError.InvalidType;
                    var result_arr = Value.Array{};

                    for (arr) |item| {
                        if (self.matchesFilter(item, f)) {
                            try result_arr.append(self.allocator, try item.clone(self.allocator));
                        }
                    }
                    break :blk Value{ .array = result_arr };
                },
                .node => return QueryError.InvalidType,
            };
            current.deinit(self.allocator);
            current = next;
        }

        return current;
    }

    fn nodeToValue(self: *const QueryExecutor, node_id: []const u8) QueryError!Value {
        const node = self.network.findNode(node_id) orelse return QueryError.NodeNotFound;

        var table = Value.Table{};
        errdefer {
            var it = table.iterator();
            while (it.next()) |entry| {
                self.allocator.free(entry.key_ptr.*);
                entry.value_ptr.deinit(self.allocator);
            }
            table.deinit(self.allocator);
        }

        const b = node.base();

        try table.put(self.allocator, try self.allocator.dupe(u8, "id"), Value{ .string = try self.allocator.dupe(u8, b.id) });
        try table.put(self.allocator, try self.allocator.dupe(u8, "type"), Value{ .string = try self.allocator.dupe(u8, b.type_name) });

        if (b.label) |l| {
            try table.put(self.allocator, try self.allocator.dupe(u8, "label"), Value{ .string = try self.allocator.dupe(u8, l) });
        }

        // Position as subtable
        var pos_table = Value.Table{};
        try pos_table.put(self.allocator, try self.allocator.dupe(u8, "x"), Value{ .float = b.position.x });
        try pos_table.put(self.allocator, try self.allocator.dupe(u8, "y"), Value{ .float = b.position.y });
        try table.put(self.allocator, try self.allocator.dupe(u8, "position"), Value{ .table = pos_table });

        if (b.parent_id) |pid| {
            try table.put(self.allocator, try self.allocator.dupe(u8, "parentId"), Value{ .string = try self.allocator.dupe(u8, pid) });
        }

        // Branch-specific: blocks and outgoing
        switch (node.*) {
            .branch => |branch| {
                var blocks_arr = Value.Array{};
                for (branch.blocks.items) |block| {
                    var block_table = Value.Table{};
                    try block_table.put(self.allocator, try self.allocator.dupe(u8, "type"), Value{ .string = try self.allocator.dupe(u8, block.type_name) });
                    if (block.quantity) |q| {
                        try block_table.put(self.allocator, try self.allocator.dupe(u8, "quantity"), Value{ .integer = @intCast(q) });
                    }
                    // Add extra properties
                    var extra_it = block.extra.iterator();
                    while (extra_it.next()) |entry| {
                        try block_table.put(self.allocator, try self.allocator.dupe(u8, entry.key_ptr.*), try entry.value_ptr.clone(self.allocator));
                    }
                    try blocks_arr.append(self.allocator, Value{ .table = block_table });
                }
                try table.put(self.allocator, try self.allocator.dupe(u8, "blocks"), Value{ .array = blocks_arr });

                if (branch.outgoing.items.len > 0) {
                    var outgoing_arr = Value.Array{};
                    for (branch.outgoing.items) |out| {
                        var out_table = Value.Table{};
                        try out_table.put(self.allocator, try self.allocator.dupe(u8, "target"), Value{ .string = try self.allocator.dupe(u8, out.target) });
                        try out_table.put(self.allocator, try self.allocator.dupe(u8, "weight"), Value{ .integer = @intCast(out.weight) });
                        try outgoing_arr.append(self.allocator, Value{ .table = out_table });
                    }
                    try table.put(self.allocator, try self.allocator.dupe(u8, "outgoing"), Value{ .array = outgoing_arr });
                }
            },
            .image => |img| {
                if (img.path.len > 0) {
                    try table.put(self.allocator, try self.allocator.dupe(u8, "path"), Value{ .string = try self.allocator.dupe(u8, img.path) });
                }
            },
            else => {},
        }

        return Value{ .table = table };
    }

    fn getProperty(self: *const QueryExecutor, val: Value, name: []const u8) ?Value {
        _ = self;
        const t = val.getTable() orelse return null;
        return t.get(name);
    }

    fn tryResolveScoped(
        self: *const QueryExecutor,
        resolver: *const scope_mod.ScopeResolver,
        property: []const u8,
        node_id: []const u8,
        block_idx: usize,
        explicit_scopes: ?[]const scope_mod.ScopeLevel,
    ) ?Value {
        const branch = self.network.findBranch(node_id) orelse return null;
        if (block_idx >= branch.blocks.items.len) return null;
        const block = &branch.blocks.items[block_idx];

        const group = if (branch.base.parent_id) |pid|
            self.network.findGroup(pid)
        else
            null;

        if (explicit_scopes) |scopes| {
            const result = resolver.resolveWithExplicitScopes(property, block, branch, group, scopes);
            return if (result) |r| r.value else null;
        } else {
            return resolver.resolveProperty(property, block, branch, group);
        }
    }

    fn matchesFilter(self: *const QueryExecutor, val: Value, filter: QuerySegment.Filter) bool {
        _ = self;
        const t = val.getTable() orelse return false;

        // Support dotted field access (e.g. data.type)
        const field_val = if (std.mem.indexOf(u8, filter.field, ".")) |_| blk: {
            // Simple one-level dot access
            var parts = std.mem.splitScalar(u8, filter.field, '.');
            var current: ?Value = null;
            while (parts.next()) |part| {
                if (current) |curr| {
                    const inner = curr.getTable() orelse break :blk @as(?Value, null);
                    current = inner.get(part);
                } else {
                    current = t.get(part);
                }
            }
            break :blk current;
        } else t.get(filter.field);

        const fv = field_val orelse return false;

        return switch (filter.operator) {
            .eq => matchesValue(fv, filter.value),
            .neq => !matchesValue(fv, filter.value),
            .gt, .lt, .gte, .lte => compareNumeric(fv, filter.value, filter.operator),
        };
    }
};

fn matchesValue(val: Value, filter_value: []const u8) bool {
    switch (val) {
        .string => |s| return std.mem.eql(u8, s, filter_value),
        .integer => |i| {
            const fv = std.fmt.parseInt(i64, filter_value, 10) catch return false;
            return i == fv;
        },
        .float => |f| {
            const fv = std.fmt.parseFloat(f64, filter_value) catch return false;
            return @abs(f - fv) < 1e-9;
        },
        .boolean => |b| {
            if (std.mem.eql(u8, filter_value, "true")) return b;
            if (std.mem.eql(u8, filter_value, "false")) return !b;
            return false;
        },
        .quantity => |q| {
            const fv = std.fmt.parseFloat(f64, filter_value) catch return false;
            return @abs(q.value - fv) < 1e-9;
        },
        else => return false,
    }
}

fn compareNumeric(val: Value, filter_value: []const u8, op: FilterOperator) bool {
    const num = val.getFloat() orelse return false;
    const fv = std.fmt.parseFloat(f64, filter_value) catch return false;

    return switch (op) {
        .gt => num > fv,
        .lt => num < fv,
        .gte => num >= fv,
        .lte => num <= fv,
        else => false,
    };
}

// ─── Tests ──────────────────────────────────────────────────────────────

fn setupTestNetwork(allocator: Allocator) !net.Network {
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
        \\[[outgoing]]
        \\target = "branch-2"
        \\weight = 1
        \\
        \\[[block]]
        \\type = "Source"
        \\quantity = 1
        \\pressure = 15.5
        \\
        \\[[block]]
        \\type = "Pipe"
        \\quantity = 1
        \\
        \\[[block]]
        \\type = "Pipe"
        \\quantity = 2
    );
    try files.put(allocator, "branch-2.toml",
        \\type = "branch"
        \\label = "Branch 2"
        \\
        \\[position]
        \\x = 300
        \\y = 200
        \\
        \\[[block]]
        \\type = "Pipe"
        \\quantity = 1
    );

    var validation = net.ValidationResult.init(allocator);
    defer validation.deinit();

    return net.loadNetworkFromFiles(allocator, &files, &validation);
}

test "parse query: simple property access" {
    const allocator = std.testing.allocator;
    var q = try parseQuery(allocator, "branch-1/label");
    defer deinitQuery(allocator, &q);

    try std.testing.expectEqual(@as(usize, 2), q.segments.items.len);
    try std.testing.expectEqualStrings("branch-1", q.segments.items[0].node);
    try std.testing.expectEqualStrings("label", q.segments.items[1].property);
}

test "parse query: index access" {
    const allocator = std.testing.allocator;
    var q = try parseQuery(allocator, "branch-1/blocks/0");
    defer deinitQuery(allocator, &q);

    try std.testing.expectEqual(@as(usize, 3), q.segments.items.len);
    try std.testing.expectEqual(@as(usize, 0), q.segments.items[2].index);
}

test "parse query: filter" {
    const allocator = std.testing.allocator;
    var q = try parseQuery(allocator, "branch-1/blocks/[type=Pipe]");
    defer deinitQuery(allocator, &q);

    const filter = q.segments.items[2].filter;
    try std.testing.expectEqualStrings("type", filter.field);
    try std.testing.expectEqual(FilterOperator.eq, filter.operator);
    try std.testing.expectEqualStrings("Pipe", filter.value);
}

test "parse query: scope params" {
    const allocator = std.testing.allocator;
    var q = try parseQuery(allocator, "branch-1/blocks/0/pressure?scope=block,branch,global");
    defer deinitQuery(allocator, &q);

    try std.testing.expect(q.params.scopes != null);
    try std.testing.expectEqual(@as(usize, 3), q.params.scopes.?.len);
    try std.testing.expectEqual(scope_mod.ScopeLevel.block, q.params.scopes.?[0]);
    try std.testing.expectEqual(scope_mod.ScopeLevel.global, q.params.scopes.?[2]);
}

test "execute query: get node label" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    const executor = QueryExecutor.init(allocator, &network);
    var q = try parseQuery(allocator, "branch-1/label");
    defer deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectEqualStrings("Branch 1", result.getString().?);
}

test "execute query: get block by index" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    const executor = QueryExecutor.init(allocator, &network);
    var q = try parseQuery(allocator, "branch-1/blocks/0/type");
    defer deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectEqualStrings("Source", result.getString().?);
}

test "execute query: get block extra property" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    const executor = QueryExecutor.init(allocator, &network);
    var q = try parseQuery(allocator, "branch-1/blocks/0/pressure");
    defer deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectApproxEqAbs(@as(f64, 15.5), result.getFloat().?, 0.001);
}

test "execute query: filter blocks by type" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    const executor = QueryExecutor.init(allocator, &network);
    var q = try parseQuery(allocator, "branch-1/blocks/[type=Pipe]");
    defer deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    const arr = result.getArray().?;
    try std.testing.expectEqual(@as(usize, 2), arr.len);
}

test "execute query: position access" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    const executor = QueryExecutor.init(allocator, &network);
    var q = try parseQuery(allocator, "branch-1/position/x");
    defer deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectApproxEqAbs(@as(f64, 100.0), result.getFloat().?, 0.001);
}

test "execute query: scope resolution fallback to global" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    // Set up config with global property
    var config = scope_mod.Config.init(allocator);
    defer config.deinit();
    config.inheritance.general = try allocator.dupe(scope_mod.ScopeLevel, &.{ .block, .branch, .group, .global });
    const temp_key = try allocator.dupe(u8, "ambientTemperature");
    try config.properties.put(allocator, temp_key, Value{ .float = 20.0 });

    const resolver = scope_mod.ScopeResolver.init(&config);
    const executor = QueryExecutor.withScopeResolver(allocator, &network, &resolver);

    var q = try parseQuery(allocator, "branch-1/blocks/0/ambientTemperature");
    defer deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    try std.testing.expectApproxEqAbs(@as(f64, 20.0), result.getFloat().?, 0.001);
}

test "execute query: node not found returns error" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    const executor = QueryExecutor.init(allocator, &network);
    var q = try parseQuery(allocator, "nonexistent/label");
    defer deinitQuery(allocator, &q);

    const result = executor.execute(&q);
    try std.testing.expectError(QueryError.NodeNotFound, result);
}

test "execute query: range access" {
    const allocator = std.testing.allocator;
    var network = try setupTestNetwork(allocator);
    defer network.deinit(allocator);

    const executor = QueryExecutor.init(allocator, &network);
    var q = try parseQuery(allocator, "branch-1/blocks/0:1");
    defer deinitQuery(allocator, &q);

    var result = try executor.execute(&q);
    defer result.deinit(allocator);

    const arr = result.getArray().?;
    try std.testing.expectEqual(@as(usize, 2), arr.len);
}
