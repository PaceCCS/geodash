const std = @import("std");
const toml = @import("toml.zig");
const network = @import("network.zig");
const Allocator = std.mem.Allocator;
const Value = toml.Value;

// ─── Types ──────────────────────────────────────────────────────────────

pub const ScopeLevel = enum {
    block,
    branch,
    group,
    global,

    pub fn fromString(s: []const u8) ?ScopeLevel {
        if (std.mem.eql(u8, s, "block")) return .block;
        if (std.mem.eql(u8, s, "branch")) return .branch;
        if (std.mem.eql(u8, s, "group")) return .group;
        if (std.mem.eql(u8, s, "global")) return .global;
        return null;
    }
};

pub const PropertyInheritanceRule = union(enum) {
    simple: []const ScopeLevel,
    complex: Complex,

    pub const Complex = struct {
        inheritance: []const ScopeLevel,
        overrides: std.StringArrayHashMapUnmanaged([]const ScopeLevel),
    };
};

const default_inheritance_general: []const ScopeLevel = &.{ .block, .branch, .group, .global };

pub const InheritanceConfig = struct {
    general: []const ScopeLevel = default_inheritance_general,
    rules: std.StringArrayHashMapUnmanaged(PropertyInheritanceRule) = .{},
};

pub const Config = struct {
    properties: Value.Table = .{},
    property_dimensions: Value.Table = .{},
    unit_preferences: Value.Table = .{},
    inheritance: InheritanceConfig = .{},
    allocator: Allocator,

    pub fn init(allocator: Allocator) Config {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *Config) void {
        deinitValueTable(self.allocator, &self.properties);
        deinitValueTable(self.allocator, &self.property_dimensions);
        deinitValueTable(self.allocator, &self.unit_preferences);

        // Free general scope chain
        if (self.inheritance.general.len > 0 and self.inheritance.general.ptr != default_inheritance_general.ptr) {
            self.allocator.free(self.inheritance.general);
        }

        // Free rules
        var rule_it = self.inheritance.rules.iterator();
        while (rule_it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            switch (entry.value_ptr.*) {
                .simple => |s| self.allocator.free(s),
                .complex => |*c| {
                    self.allocator.free(c.inheritance);
                    var ov_it = c.overrides.iterator();
                    while (ov_it.next()) |ov| {
                        self.allocator.free(ov.key_ptr.*);
                        self.allocator.free(ov.value_ptr.*);
                    }
                    c.overrides.deinit(self.allocator);
                },
            }
        }
        self.inheritance.rules.deinit(self.allocator);
    }

    /// Load Config from a parsed TOML config.toml value
    pub fn loadFromToml(allocator: Allocator, root: Value.Table) !Config {
        var config = Config.init(allocator);
        errdefer config.deinit();

        // Load [properties]
        if (root.get("properties")) |props_val| {
            config.properties = try cloneValueTable(allocator, props_val.table);
        }

        // Load property -> dimension fallback metadata.
        if (root.get("propertyDimensions")) |property_dimensions_val| {
            config.property_dimensions = try cloneValueTable(allocator, property_dimensions_val.table);
        } else if (root.get("dimensions")) |dimensions_val| {
            config.property_dimensions = try cloneValueTable(allocator, dimensions_val.table);
        }

        // Load block-level and dimension-level unit preferences.
        if (root.get("unitPreferences")) |unit_preferences_val| {
            config.unit_preferences = try cloneValueTable(allocator, unit_preferences_val.table);
        }

        // Load [inheritance]
        if (root.get("inheritance")) |inh_val| {
            const inh_table = inh_val.table;

            // general = ["block", "branch", ...]
            if (inh_table.get("general")) |general_val| {
                if (general_val.getArray()) |arr| {
                    var levels = std.ArrayListUnmanaged(ScopeLevel).empty;
                    defer levels.deinit(allocator);
                    for (arr) |item| {
                        if (item.getString()) |s| {
                            if (ScopeLevel.fromString(s)) |level| {
                                try levels.append(allocator, level);
                            }
                        }
                    }
                    config.inheritance.general = try allocator.dupe(ScopeLevel, levels.items);
                }
            }

            // [inheritance.rules]
            if (inh_table.get("rules")) |rules_val| {
                var rules_it = rules_val.table.iterator();
                while (rules_it.next()) |entry| {
                    const rule_name = try allocator.dupe(u8, entry.key_ptr.*);
                    errdefer allocator.free(rule_name);

                    // Simple rule: property = ["block", "branch"]
                    if (entry.value_ptr.getArray()) |arr| {
                        var levels = std.ArrayListUnmanaged(ScopeLevel).empty;
                        defer levels.deinit(allocator);
                        for (arr) |item| {
                            if (item.getString()) |s| {
                                if (ScopeLevel.fromString(s)) |level| {
                                    try levels.append(allocator, level);
                                }
                            }
                        }
                        try config.inheritance.rules.put(allocator, rule_name, .{
                            .simple = try allocator.dupe(ScopeLevel, levels.items),
                        });
                    }
                    // Complex rules with overrides would be a table — not yet used in preset1
                }
            }
        }

        return config;
    }
};

fn cloneValueTable(allocator: Allocator, source: Value.Table) !Value.Table {
    var result: Value.Table = .{};
    errdefer deinitValueTable(allocator, &result);

    var it = source.iterator();
    while (it.next()) |entry| {
        const key = try allocator.dupe(u8, entry.key_ptr.*);
        errdefer allocator.free(key);
        const value = try entry.value_ptr.clone(allocator);
        try result.put(allocator, key, value);
    }

    return result;
}

fn deinitValueTable(allocator: Allocator, table: *Value.Table) void {
    var it = table.iterator();
    while (it.next()) |entry| {
        allocator.free(entry.key_ptr.*);
        entry.value_ptr.deinit(allocator);
    }
    table.deinit(allocator);
}

// ─── Resolver ───────────────────────────────────────────────────────────

pub const ResolveResult = struct {
    value: Value,
    scope: ScopeLevel,
};

pub const ScopeResolver = struct {
    config: *const Config,

    pub fn init(config: *const Config) ScopeResolver {
        return .{ .config = config };
    }

    /// Resolve a property using the configured scope chain
    pub fn resolveProperty(
        self: *const ScopeResolver,
        property: []const u8,
        block: *const network.Block,
        branch: *const network.BranchNode,
        group_node: ?*const network.GroupNode,
    ) ?Value {
        const result = self.resolvePropertyWithScope(property, block, branch, group_node);
        return if (result) |r| r.value else null;
    }

    /// Resolve a property and return which scope it was found at
    pub fn resolvePropertyWithScope(
        self: *const ScopeResolver,
        property: []const u8,
        block: *const network.Block,
        branch: *const network.BranchNode,
        group_node: ?*const network.GroupNode,
    ) ?ResolveResult {
        const chain = self.getScopeChain(property, block.type_name);
        return self.resolveWithExplicitScopes(property, block, branch, group_node, chain);
    }

    /// Resolve using an explicit list of scopes (for query ?scope= overrides)
    pub fn resolveWithExplicitScopes(
        self: *const ScopeResolver,
        property: []const u8,
        block: *const network.Block,
        branch: *const network.BranchNode,
        group_node: ?*const network.GroupNode,
        scopes: []const ScopeLevel,
    ) ?ResolveResult {
        for (scopes) |scope| {
            switch (scope) {
                .block => {
                    if (block.extra.get(property)) |v| {
                        return .{ .value = v, .scope = .block };
                    }
                },
                .branch => {
                    if (branch.base.extra.get(property)) |v| {
                        return .{ .value = v, .scope = .branch };
                    }
                },
                .group => {
                    if (group_node) |g| {
                        if (g.base.extra.get(property)) |v| {
                            return .{ .value = v, .scope = .group };
                        }
                    }
                },
                .global => {
                    if (self.config.properties.get(property)) |v| {
                        return .{ .value = v, .scope = .global };
                    }
                },
            }
        }
        return null;
    }

    fn getScopeChain(self: *const ScopeResolver, property: []const u8, block_type: []const u8) []const ScopeLevel {
        if (self.config.inheritance.rules.get(property)) |rule| {
            switch (rule) {
                .simple => |scopes| return scopes,
                .complex => |c| {
                    if (c.overrides.get(block_type)) |override| return override;
                    return c.inheritance;
                },
            }
        }
        return self.config.inheritance.general;
    }
};

// ─── Tests ──────────────────────────────────────────────────────────────

test "load config from TOML" {
    const allocator = std.testing.allocator;

    const source =
        \\[properties]
        \\ambientTemperature = 20.0
        \\pressure = 14.7
        \\
        \\[inheritance]
        \\general = ["block", "branch", "group", "global"]
        \\
        \\[inheritance.rules]
        \\ambientTemperature = ["group", "global"]
        \\pressure = ["block"]
    ;

    var parsed = try toml.Parser.parse(allocator, source);
    defer parsed.deinit(allocator);

    var config = try Config.loadFromToml(allocator, parsed.table);
    defer config.deinit();

    // Check global properties
    try std.testing.expectApproxEqAbs(@as(f64, 20.0), config.properties.get("ambientTemperature").?.getFloat().?, 0.001);
    try std.testing.expectApproxEqAbs(@as(f64, 14.7), config.properties.get("pressure").?.getFloat().?, 0.001);

    // Check general scope chain
    try std.testing.expectEqual(@as(usize, 4), config.inheritance.general.len);
    try std.testing.expectEqual(ScopeLevel.block, config.inheritance.general[0]);
    try std.testing.expectEqual(ScopeLevel.global, config.inheritance.general[3]);

    // Check rules
    const ambient_rule = config.inheritance.rules.get("ambientTemperature").?;
    try std.testing.expectEqual(@as(usize, 2), ambient_rule.simple.len);
    try std.testing.expectEqual(ScopeLevel.group, ambient_rule.simple[0]);
    try std.testing.expectEqual(ScopeLevel.global, ambient_rule.simple[1]);

    const pressure_rule = config.inheritance.rules.get("pressure").?;
    try std.testing.expectEqual(@as(usize, 1), pressure_rule.simple.len);
    try std.testing.expectEqual(ScopeLevel.block, pressure_rule.simple[0]);
}

test "load config unit metadata from TOML" {
    const allocator = std.testing.allocator;

    const source =
        \\[propertyDimensions]
        \\length = "length"
        \\pressure = "pressure"
        \\
        \\[unitPreferences.dimensions]
        \\length = "km"
        \\
        \\[unitPreferences.Source]
        \\length = "m"
    ;

    var parsed = try toml.Parser.parse(allocator, source);
    defer parsed.deinit(allocator);

    var config = try Config.loadFromToml(allocator, parsed.table);
    defer config.deinit();

    try std.testing.expectEqualStrings(
        "length",
        config.property_dimensions.get("length").?.getString().?,
    );
    try std.testing.expectEqualStrings(
        "pressure",
        config.property_dimensions.get("pressure").?.getString().?,
    );

    const dimension_units = config.unit_preferences.get("dimensions").?.table;
    try std.testing.expectEqualStrings(
        "km",
        dimension_units.get("length").?.getString().?,
    );

    const source_units = config.unit_preferences.get("Source").?.table;
    try std.testing.expectEqualStrings(
        "m",
        source_units.get("length").?.getString().?,
    );
}

test "scope resolver: block-level property" {
    const allocator = std.testing.allocator;

    // Create a simple config
    var config = Config.init(allocator);
    defer config.deinit();
    config.inheritance.general = try allocator.dupe(ScopeLevel, &.{ .block, .branch, .group, .global });

    // Create a block with pressure
    var block_extra = Value.Table{};
    const pressure_key = try allocator.dupe(u8, "pressure");
    try block_extra.put(allocator, pressure_key, Value{ .float = 15.5 });
    defer {
        var it = block_extra.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit(allocator);
        }
        block_extra.deinit(allocator);
    }

    const block = network.Block{
        .type_name = "Pipe",
        .extra = block_extra,
    };

    const branch = network.BranchNode{
        .base = .{ .id = "branch-1", .type_name = "branch" },
    };

    const resolver = ScopeResolver.init(&config);
    const result = resolver.resolvePropertyWithScope("pressure", &block, &branch, null);

    try std.testing.expect(result != null);
    try std.testing.expectApproxEqAbs(@as(f64, 15.5), result.?.value.getFloat().?, 0.001);
    try std.testing.expectEqual(ScopeLevel.block, result.?.scope);
}

test "scope resolver: falls back to global" {
    const allocator = std.testing.allocator;

    var config = Config.init(allocator);
    defer config.deinit();
    config.inheritance.general = try allocator.dupe(ScopeLevel, &.{ .block, .branch, .group, .global });

    // Add global property
    const temp_key = try allocator.dupe(u8, "ambientTemperature");
    try config.properties.put(allocator, temp_key, Value{ .float = 20.0 });

    // Empty block — no local override
    const block = network.Block{ .type_name = "Pipe" };
    const branch = network.BranchNode{
        .base = .{ .id = "branch-1", .type_name = "branch" },
    };

    const resolver = ScopeResolver.init(&config);
    const result = resolver.resolvePropertyWithScope("ambientTemperature", &block, &branch, null);

    try std.testing.expect(result != null);
    try std.testing.expectApproxEqAbs(@as(f64, 20.0), result.?.value.getFloat().?, 0.001);
    try std.testing.expectEqual(ScopeLevel.global, result.?.scope);
}

test "scope resolver: per-property rule limits scope chain" {
    const allocator = std.testing.allocator;

    var config = Config.init(allocator);
    defer config.deinit();
    config.inheritance.general = try allocator.dupe(ScopeLevel, &.{ .block, .branch, .group, .global });

    // Rule: pressure only checked at block level
    const rule_key = try allocator.dupe(u8, "pressure");
    const rule_scopes = try allocator.dupe(ScopeLevel, &.{.block});
    try config.inheritance.rules.put(allocator, rule_key, .{ .simple = rule_scopes });

    // Add global pressure — should NOT be found because rule restricts to block only
    const pressure_key = try allocator.dupe(u8, "pressure");
    try config.properties.put(allocator, pressure_key, Value{ .float = 14.7 });

    // Empty block
    const block = network.Block{ .type_name = "Source" };
    const branch = network.BranchNode{
        .base = .{ .id = "branch-1", .type_name = "branch" },
    };

    const resolver = ScopeResolver.init(&config);
    const result = resolver.resolveProperty("pressure", &block, &branch, null);

    try std.testing.expect(result == null);
}

test "scope resolver: property not found returns null" {
    const allocator = std.testing.allocator;

    var config = Config.init(allocator);
    defer config.deinit();
    config.inheritance.general = try allocator.dupe(ScopeLevel, &.{ .block, .branch, .group, .global });

    const block = network.Block{ .type_name = "Pipe" };
    const branch = network.BranchNode{
        .base = .{ .id = "branch-1", .type_name = "branch" },
    };

    const resolver = ScopeResolver.init(&config);
    const result = resolver.resolveProperty("nonexistent", &block, &branch, null);

    try std.testing.expect(result == null);
}
