const std = @import("std");
const network = @import("network.zig");
const Allocator = std.mem.Allocator;

// ─── Types ──────────────────────────────────────────────────────────────

pub const PropertyMetadata = struct {
    dimension: ?[]const u8 = null,
    default_unit: ?[]const u8 = null,
    title: ?[]const u8 = null,
    min: ?f64 = null,
    max: ?f64 = null,
};

pub const SchemaDefinition = struct {
    block_type: []const u8,
    version: []const u8,
    required_properties: std.ArrayListUnmanaged([]const u8) = .{},
    optional_properties: std.ArrayListUnmanaged([]const u8) = .{},
    properties: std.StringArrayHashMapUnmanaged(PropertyMetadata) = .{},
};

pub const SchemaLibrary = struct {
    version: []const u8,
    schemas: std.StringArrayHashMapUnmanaged(SchemaDefinition) = .{},
};

pub const SchemaRegistry = struct {
    allocator: Allocator,
    libraries: std.StringArrayHashMapUnmanaged(SchemaLibrary) = .{},

    pub fn init(allocator: Allocator) SchemaRegistry {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *SchemaRegistry) void {
        var lib_it = self.libraries.iterator();
        while (lib_it.next()) |lib_entry| {
            self.allocator.free(lib_entry.key_ptr.*);
            var schema_it = lib_entry.value_ptr.schemas.iterator();
            while (schema_it.next()) |schema_entry| {
                self.allocator.free(schema_entry.key_ptr.*);
                deinitSchema(self.allocator, schema_entry.value_ptr);
            }
            lib_entry.value_ptr.schemas.deinit(self.allocator);
            self.allocator.free(lib_entry.value_ptr.version);
        }
        self.libraries.deinit(self.allocator);
    }

    fn deinitSchema(allocator: Allocator, schema: *SchemaDefinition) void {
        allocator.free(schema.block_type);
        allocator.free(schema.version);
        for (schema.required_properties.items) |p| allocator.free(p);
        schema.required_properties.deinit(allocator);
        for (schema.optional_properties.items) |p| allocator.free(p);
        schema.optional_properties.deinit(allocator);
        var it = schema.properties.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            if (entry.value_ptr.dimension) |d| allocator.free(d);
            if (entry.value_ptr.default_unit) |u| allocator.free(u);
            if (entry.value_ptr.title) |t| allocator.free(t);
        }
        schema.properties.deinit(allocator);
    }

    /// Register a schema definition
    pub fn addSchema(self: *SchemaRegistry, version: []const u8, schema: SchemaDefinition) !void {
        const gop = try self.libraries.getOrPut(self.allocator, version);
        if (!gop.found_existing) {
            gop.key_ptr.* = try self.allocator.dupe(u8, version);
            gop.value_ptr.* = .{
                .version = try self.allocator.dupe(u8, version),
            };
        }
        const block_type_key = try self.allocator.dupe(u8, schema.block_type);
        try gop.value_ptr.schemas.put(self.allocator, block_type_key, schema);
    }

    pub fn getSchema(self: *const SchemaRegistry, version: []const u8, block_type: []const u8) ?*const SchemaDefinition {
        if (self.libraries.getPtr(version)) |lib| {
            return lib.schemas.getPtr(block_type);
        }
        return null;
    }
};

// ─── Validator ──────────────────────────────────────────────────────────

pub const SchemaValidator = struct {
    registry: *const SchemaRegistry,

    pub fn init(registry: *const SchemaRegistry) SchemaValidator {
        return .{ .registry = registry };
    }

    /// Validate a block against its schema. Non-blocking: collects all issues.
    pub fn validateBlock(
        self: *const SchemaValidator,
        block: *const network.Block,
        version: []const u8,
        validation: *network.ValidationResult,
    ) !void {
        const schema = self.registry.getSchema(version, block.type_name) orelse {
            try validation.addWarningFmt("No schema found for block type '{s}' version '{s}'", .{ block.type_name, version });
            return;
        };

        // Check required properties
        for (schema.required_properties.items) |required| {
            if (block.extra.get(required) == null) {
                try validation.addErrorFmt("Required property '{s}' is missing for block type '{s}'", .{ required, block.type_name });
            }
        }

        // Check for unknown properties
        var it = block.extra.iterator();
        while (it.next()) |entry| {
            const prop_name = entry.key_ptr.*;
            var is_known = false;

            for (schema.required_properties.items) |req| {
                if (std.mem.eql(u8, prop_name, req)) {
                    is_known = true;
                    break;
                }
            }
            if (!is_known) {
                for (schema.optional_properties.items) |opt| {
                    if (std.mem.eql(u8, prop_name, opt)) {
                        is_known = true;
                        break;
                    }
                }
            }
            if (!is_known) {
                if (schema.properties.get(prop_name) != null) {
                    is_known = true;
                }
            }

            if (!is_known) {
                try validation.addWarningFmt("Unknown property '{s}' for block type '{s}' in schema '{s}'", .{ prop_name, block.type_name, version });
            }
        }
    }
};

// ─── Helper to build schemas for tests ──────────────────────────────────

pub fn buildTestSchema(allocator: Allocator, block_type: []const u8, version: []const u8, required: []const []const u8, optional: []const []const u8) !SchemaDefinition {
    var schema = SchemaDefinition{
        .block_type = try allocator.dupe(u8, block_type),
        .version = try allocator.dupe(u8, version),
    };

    for (required) |r| {
        try schema.required_properties.append(allocator, try allocator.dupe(u8, r));
    }
    for (optional) |o| {
        try schema.optional_properties.append(allocator, try allocator.dupe(u8, o));
    }

    return schema;
}

// ─── Tests ──────────────────────────────────────────────────────────────

test "validate block: passes with all required properties" {
    const allocator = std.testing.allocator;

    var registry = SchemaRegistry.init(allocator);
    defer registry.deinit();

    const schema = try buildTestSchema(allocator, "Source", "v1.0", &.{"pressure"}, &.{"temperature"});
    try registry.addSchema("v1.0", schema);

    const validator = SchemaValidator.init(&registry);

    // Block with required property
    var block_extra: @import("toml.zig").Value.Table = .{};
    const pressure_key = try allocator.dupe(u8, "pressure");
    try block_extra.put(allocator, pressure_key, .{ .float = 15.5 });
    defer {
        var it = block_extra.iterator();
        while (it.next()) |entry| {
            allocator.free(entry.key_ptr.*);
            entry.value_ptr.deinit(allocator);
        }
        block_extra.deinit(allocator);
    }

    const block = network.Block{
        .type_name = "Source",
        .extra = block_extra,
    };

    var validation = network.ValidationResult.init(allocator);
    defer validation.deinit();

    try validator.validateBlock(&block, "v1.0", &validation);
    try std.testing.expect(validation.isValid());
    try std.testing.expectEqual(@as(usize, 0), validation.warnings.items.len);
}

test "validate block: error on missing required property" {
    const allocator = std.testing.allocator;

    var registry = SchemaRegistry.init(allocator);
    defer registry.deinit();

    const schema = try buildTestSchema(allocator, "Source", "v1.0", &.{"pressure"}, &.{});
    try registry.addSchema("v1.0", schema);

    const validator = SchemaValidator.init(&registry);

    // Block WITHOUT required property
    const block = network.Block{ .type_name = "Source" };

    var validation = network.ValidationResult.init(allocator);
    defer validation.deinit();

    try validator.validateBlock(&block, "v1.0", &validation);
    try std.testing.expect(!validation.isValid());
    try std.testing.expectEqual(@as(usize, 1), validation.errors.items.len);
}

test "validate block: warning on unknown property" {
    const allocator = std.testing.allocator;

    var registry = SchemaRegistry.init(allocator);
    defer registry.deinit();

    const schema = try buildTestSchema(allocator, "Pipe", "v1.0", &.{}, &.{});
    try registry.addSchema("v1.0", schema);

    const validator = SchemaValidator.init(&registry);

    // Block with unknown property
    var block_extra: @import("toml.zig").Value.Table = .{};
    const key = try allocator.dupe(u8, "unknownProp");
    try block_extra.put(allocator, key, .{ .float = 42.0 });
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

    var validation = network.ValidationResult.init(allocator);
    defer validation.deinit();

    try validator.validateBlock(&block, "v1.0", &validation);
    try std.testing.expect(validation.isValid()); // warnings don't make it invalid
    try std.testing.expectEqual(@as(usize, 1), validation.warnings.items.len);
}

test "validate block: warning when no schema found" {
    const allocator = std.testing.allocator;

    var registry = SchemaRegistry.init(allocator);
    defer registry.deinit();

    const validator = SchemaValidator.init(&registry);

    const block = network.Block{ .type_name = "UnknownType" };

    var validation = network.ValidationResult.init(allocator);
    defer validation.deinit();

    try validator.validateBlock(&block, "v1.0", &validation);
    try std.testing.expect(validation.isValid());
    try std.testing.expectEqual(@as(usize, 1), validation.warnings.items.len);
}
