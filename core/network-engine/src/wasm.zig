//! WASM entry point for the geodash network engine.
//! Exports JSON-in / JSON-out functions callable from TypeScript via WebAssembly.
//!
//! Memory protocol:
//!   JS calls geodash_alloc(len) to get a pointer, writes input bytes there,
//!   then calls the function with that pointer + length.
//!   The function allocates an output buffer with wasm_allocator and sets
//!   *out_ptr and *out_len to point at it.
//!   JS reads the output, then calls geodash_free(out_ptr, out_len) to release it.
//!   Input buffers must also be freed with geodash_free after the call.

const std = @import("std");
const toml_mod = @import("toml.zig");
const net_mod = @import("network.zig");
const scope_mod = @import("scope.zig");
const query_mod = @import("query.zig");
const fluid_mod = @import("fluid.zig");
const olga_mod = @import("olga.zig");
const shapefile = @import("shapefile");

const Value = toml_mod.Value;
const Allocator = std.mem.Allocator;

// Persistent allocator for buffers shared with JavaScript.
const wasm_alloc = std.heap.wasm_allocator;

// ── Memory management ─────────────────────────────────────────────────────────

export fn geodash_alloc(len: u32) u32 {
    const buf = wasm_alloc.alloc(u8, len) catch return 0;
    return @intFromPtr(buf.ptr);
}

export fn geodash_free(ptr: u32, len: u32) void {
    if (ptr == 0 or len == 0) return;
    const buf = @as([*]u8, @ptrFromInt(ptr))[0..len];
    wasm_alloc.free(buf);
}

// ── Response helpers ──────────────────────────────────────────────────────────

fn setOutput(out_ptr: u32, out_len: u32, data: []const u8) i32 {
    @as(*u32, @ptrFromInt(out_ptr)).* = @intFromPtr(data.ptr);
    @as(*u32, @ptrFromInt(out_len)).* = @intCast(data.len);
    return 0;
}

fn setError(err: anyerror, out_ptr: u32, out_len: u32) i32 {
    const msg = std.fmt.allocPrint(
        wasm_alloc,
        "{{\"error\":\"{s}\"}}",
        .{@errorName(err)},
    ) catch {
        @as(*u32, @ptrFromInt(out_ptr)).* = 0;
        @as(*u32, @ptrFromInt(out_len)).* = 0;
        return -1;
    };
    @as(*u32, @ptrFromInt(out_ptr)).* = @intFromPtr(msg.ptr);
    @as(*u32, @ptrFromInt(out_len)).* = @intCast(msg.len);
    return -1;
}

// ── JSON output buffer ────────────────────────────────────────────────────────
// In Zig 0.15, std.ArrayList is unmanaged — pass the allocator to each method.

const Buf = std.ArrayListUnmanaged(u8);

fn bufAppend(buf: *Buf, a: Allocator, byte: u8) !void {
    try buf.append(a, byte);
}

fn bufAppendSlice(buf: *Buf, a: Allocator, slice: []const u8) !void {
    try buf.appendSlice(a, slice);
}

fn bufPrint(buf: *Buf, a: Allocator, comptime fmt: []const u8, args: anytype) !void {
    const s = try std.fmt.allocPrint(a, fmt, args);
    defer a.free(s);
    try buf.appendSlice(a, s);
}

// ── Value → JSON serializer ───────────────────────────────────────────────────

fn writeValueJson(value: *const Value, buf: *Buf, a: Allocator) error{OutOfMemory}!void {
    switch (value.*) {
        .string => |s| {
            try bufAppend(buf, a, '"');
            for (s) |c| {
                switch (c) {
                    '"' => try bufAppendSlice(buf, a, "\\\""),
                    '\\' => try bufAppendSlice(buf, a, "\\\\"),
                    '\t' => try bufAppendSlice(buf, a, "\\t"),
                    '\n' => try bufAppendSlice(buf, a, "\\n"),
                    '\r' => try bufAppendSlice(buf, a, "\\r"),
                    // Other control chars: 0x00–0x08, 0x0b–0x0c, 0x0e–0x1f
                    0x00...0x08, 0x0b...0x0c, 0x0e...0x1f => try bufPrint(buf, a, "\\u{x:0>4}", .{c}),
                    else => try bufAppend(buf, a, c),
                }
            }
            try bufAppend(buf, a, '"');
        },
        .integer => |i| try bufPrint(buf, a, "{d}", .{i}),
        .float => |f| {
            if (std.math.isNan(f) or std.math.isInf(f)) {
                try bufAppendSlice(buf, a, "null");
            } else {
                try bufPrint(buf, a, "{d}", .{f});
            }
        },
        .boolean => |b| try bufAppendSlice(buf, a, if (b) "true" else "false"),
        .quantity => |q| {
            // Serialize as "value unit" string — compatible with the dim evaluator
            // on the TypeScript side (e.g. "10.5 MPa", "293.15 K").
            try bufAppend(buf, a, '"');
            try bufPrint(buf, a, "{d} {s}", .{ q.value, q.unit });
            try bufAppend(buf, a, '"');
        },
        .table => |t| {
            try bufAppend(buf, a, '{');
            var first = true;
            var it = t.iterator();
            while (it.next()) |entry| {
                if (!first) try bufAppend(buf, a, ',');
                first = false;
                try bufAppend(buf, a, '"');
                for (entry.key_ptr.*) |c| {
                    switch (c) {
                        '"' => try bufAppendSlice(buf, a, "\\\""),
                        '\\' => try bufAppendSlice(buf, a, "\\\\"),
                        else => try bufAppend(buf, a, c),
                    }
                }
                try bufAppendSlice(buf, a, "\":");
                try writeValueJson(entry.value_ptr, buf, a);
            }
            try bufAppend(buf, a, '}');
        },
        .array => |arr| {
            try bufAppend(buf, a, '[');
            for (arr.items, 0..) |*item, i| {
                if (i > 0) try bufAppend(buf, a, ',');
                try writeValueJson(item, buf, a);
            }
            try bufAppend(buf, a, ']');
        },
    }
}

/// Write a JSON-quoted, escaped string to buf.
fn writeJsonString(s: []const u8, buf: *Buf, a: Allocator) !void {
    try bufAppend(buf, a, '"');
    for (s) |c| {
        switch (c) {
            '"' => try bufAppendSlice(buf, a, "\\\""),
            '\\' => try bufAppendSlice(buf, a, "\\\\"),
            '\t' => try bufAppendSlice(buf, a, "\\t"),
            '\n' => try bufAppendSlice(buf, a, "\\n"),
            '\r' => try bufAppendSlice(buf, a, "\\r"),
            0x00...0x08, 0x0b...0x0c, 0x0e...0x1f => try bufPrint(buf, a, "\\u{x:0>4}", .{c}),
            else => try bufAppend(buf, a, c),
        }
    }
    try bufAppend(buf, a, '"');
}

// ── Input parsing ─────────────────────────────────────────────────────────────

const ParsedInput = struct {
    files: std.StringArrayHashMapUnmanaged([]const u8),
    config: ?[]const u8,
    query: ?[]const u8,
};

/// Parse `{ files: Record<string,string>, config?: string, query?: string }`.
/// All returned slices are borrowed from `parsed_json` — valid until that is freed.
fn parseInput(a: Allocator, parsed_json: std.json.Value) !ParsedInput {
    const obj = switch (parsed_json) {
        .object => |o| o,
        else => return error.InvalidInput,
    };

    const files_val = obj.get("files") orelse return error.MissingFiles;
    const files_obj = switch (files_val) {
        .object => |o| o,
        else => return error.InvalidFiles,
    };

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    var it = files_obj.iterator();
    while (it.next()) |entry| {
        const content = switch (entry.value_ptr.*) {
            .string => |s| s,
            else => return error.InvalidFileContent,
        };
        try files.put(a, entry.key_ptr.*, content);
    }

    const config: ?[]const u8 = if (obj.get("config")) |cv| switch (cv) {
        .string => |s| s,
        else => null,
    } else null;

    const query: ?[]const u8 = if (obj.get("query")) |qv| switch (qv) {
        .string => |s| s,
        else => null,
    } else null;

    return .{ .files = files, .config = config, .query = query };
}

// ── geodash_query ─────────────────────────────────────────────────────────────
//
// Input:  { files: Record<string,string>, config?: string, query: string }
// Output: JSON of the query result (a TOML Value rendered as JSON)

export fn geodash_query(in_ptr: u32, in_len: u32, out_ptr: u32, out_len: u32) i32 {
    const input = @as([*]const u8, @ptrFromInt(in_ptr))[0..in_len];
    const data = runQuery(input) catch |e| return setError(e, out_ptr, out_len);
    return setOutput(out_ptr, out_len, data);
}

fn runQuery(input: []const u8) ![]u8 {
    const json_parsed = try std.json.parseFromSlice(std.json.Value, wasm_alloc, input, .{});
    defer json_parsed.deinit();

    var arena = std.heap.ArenaAllocator.init(wasm_alloc);
    defer arena.deinit();
    const a = arena.allocator();

    const pi = try parseInput(a, json_parsed.value);
    const query_str = pi.query orelse return error.MissingQuery;

    var validation = net_mod.ValidationResult.init(a);
    var network = try net_mod.loadNetworkFromFiles(a, &pi.files, &validation);
    try fluid_mod.propagateAndInject(a, &network, &validation);

    var config_storage: scope_mod.Config = undefined;
    var resolver_opt: ?scope_mod.ScopeResolver = null;
    if (pi.config) |cs| {
        const config_value = try toml_mod.Parser.parse(a, cs);
        config_storage = try scope_mod.Config.loadFromToml(a, config_value.table);
        resolver_opt = scope_mod.ScopeResolver.init(&config_storage);
    }

    const q = try query_mod.parseQuery(a, query_str);

    const executor = if (resolver_opt) |*r|
        query_mod.QueryExecutor.withScopeResolver(a, &network, r)
    else
        query_mod.QueryExecutor.init(a, &network);

    const result = try executor.execute(&q);

    // Serialize the result into a wasm_alloc buffer that outlives the arena.
    var out_buf: Buf = .{};
    errdefer out_buf.deinit(wasm_alloc);
    try writeValueJson(&result, &out_buf, wasm_alloc);
    return out_buf.toOwnedSlice(wasm_alloc);
}

// ── geodash_load_network ──────────────────────────────────────────────────────
//
// Input:  { files: Record<string,string>, config?: string }
// Output: {
//   nodes: [{
//     id, type, position: {x, y}, parentId?, width?, height?,
//     data: { id, label?, blocks?: [{type, kind, label, quantity, ...}], path? }
//   }],
//   edges: [{ id, source, target, data: { weight } }],
//   warnings: [string]
// }

export fn geodash_load_network(in_ptr: u32, in_len: u32, out_ptr: u32, out_len: u32) i32 {
    const input = @as([*]const u8, @ptrFromInt(in_ptr))[0..in_len];
    const data = runLoadNetwork(input) catch |e| return setError(e, out_ptr, out_len);
    return setOutput(out_ptr, out_len, data);
}

fn runLoadNetwork(input: []const u8) ![]u8 {
    const json_parsed = try std.json.parseFromSlice(std.json.Value, wasm_alloc, input, .{});
    defer json_parsed.deinit();

    var arena = std.heap.ArenaAllocator.init(wasm_alloc);
    defer arena.deinit();
    const a = arena.allocator();

    const pi = try parseInput(a, json_parsed.value);

    var validation = net_mod.ValidationResult.init(a);
    var network = try net_mod.loadNetworkFromFiles(a, &pi.files, &validation);
    try fluid_mod.propagateAndInject(a, &network, &validation);

    var out_buf: Buf = .{};
    errdefer out_buf.deinit(wasm_alloc);

    try bufAppendSlice(&out_buf, wasm_alloc, "{\"nodes\":[");
    for (network.nodes.items, 0..) |*node, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        const base = node.base();
        try bufAppend(&out_buf, wasm_alloc, '{');

        // id, type
        try bufAppendSlice(&out_buf, wasm_alloc, "\"id\":");
        try writeJsonString(base.id, &out_buf, wasm_alloc);
        try bufAppendSlice(&out_buf, wasm_alloc, ",\"type\":");
        try writeJsonString(base.type_name, &out_buf, wasm_alloc);

        // parentId (optional, top-level)
        if (base.parent_id) |pid| {
            try bufAppendSlice(&out_buf, wasm_alloc, ",\"parentId\":");
            try writeJsonString(pid, &out_buf, wasm_alloc);
        }

        // width, height (optional, top-level)
        if (base.width) |w| try bufPrint(&out_buf, wasm_alloc, ",\"width\":{d}", .{w});
        if (base.height) |h| try bufPrint(&out_buf, wasm_alloc, ",\"height\":{d}", .{h});

        // position (always present)
        try bufPrint(&out_buf, wasm_alloc, ",\"position\":{{\"x\":{d},\"y\":{d}}}", .{
            base.position.x, base.position.y,
        });

        // data object
        try bufAppendSlice(&out_buf, wasm_alloc, ",\"data\":{\"id\":");
        try writeJsonString(base.id, &out_buf, wasm_alloc);

        if (base.label) |l| {
            try bufAppendSlice(&out_buf, wasm_alloc, ",\"label\":");
            try writeJsonString(l, &out_buf, wasm_alloc);
        }

        // Type-specific data fields
        switch (node.*) {
            .branch => |*b| {
                // Always emit blocks array for branch nodes (may be empty).
                try bufAppendSlice(&out_buf, wasm_alloc, ",\"blocks\":[");
                for (b.blocks.items, 0..) |*block, bi| {
                    if (bi > 0) try bufAppend(&out_buf, wasm_alloc, ',');
                    try bufAppend(&out_buf, wasm_alloc, '{');

                    // type
                    try bufAppendSlice(&out_buf, wasm_alloc, "\"type\":");
                    try writeJsonString(block.type_name, &out_buf, wasm_alloc);

                    // kind = lowercase type_name
                    try bufAppendSlice(&out_buf, wasm_alloc, ",\"kind\":\"");
                    for (block.type_name) |c| try bufAppend(&out_buf, wasm_alloc, std.ascii.toLower(c));
                    try bufAppend(&out_buf, wasm_alloc, '"');

                    // label = type_name (human-readable display name)
                    try bufAppendSlice(&out_buf, wasm_alloc, ",\"label\":");
                    try writeJsonString(block.type_name, &out_buf, wasm_alloc);

                    // quantity (always emit, default 1)
                    const qty: u32 = block.quantity orelse 1;
                    try bufPrint(&out_buf, wasm_alloc, ",\"quantity\":{d}", .{qty});

                    // extra properties (e.g. pressure, diameter)
                    var block_extra = block.extra;
                    var eit = block_extra.iterator();
                    while (eit.next()) |entry| {
                        try bufAppend(&out_buf, wasm_alloc, ',');
                        try bufAppend(&out_buf, wasm_alloc, '"');
                        try bufAppendSlice(&out_buf, wasm_alloc, entry.key_ptr.*);
                        try bufAppendSlice(&out_buf, wasm_alloc, "\":");
                        try writeValueJson(entry.value_ptr, &out_buf, wasm_alloc);
                    }

                    try bufAppend(&out_buf, wasm_alloc, '}');
                }
                try bufAppend(&out_buf, wasm_alloc, ']');
            },
            .image => |*img| {
                if (img.path.len > 0) {
                    try bufAppendSlice(&out_buf, wasm_alloc, ",\"path\":");
                    try writeJsonString(img.path, &out_buf, wasm_alloc);
                }
            },
            else => {
                // Extra data properties for group/geographic nodes
                var node_extra = base.extra;
                var eit = node_extra.iterator();
                while (eit.next()) |entry| {
                    try bufAppend(&out_buf, wasm_alloc, ',');
                    try bufAppend(&out_buf, wasm_alloc, '"');
                    try bufAppendSlice(&out_buf, wasm_alloc, entry.key_ptr.*);
                    try bufAppendSlice(&out_buf, wasm_alloc, "\":");
                    try writeValueJson(entry.value_ptr, &out_buf, wasm_alloc);
                }
            },
        }

        try bufAppend(&out_buf, wasm_alloc, '}'); // close data
        try bufAppend(&out_buf, wasm_alloc, '}'); // close node
    }

    try bufAppendSlice(&out_buf, wasm_alloc, "],\"edges\":[");
    for (network.edges.items, 0..) |*edge, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        try bufAppend(&out_buf, wasm_alloc, '{');
        try bufAppendSlice(&out_buf, wasm_alloc, "\"id\":");
        try writeJsonString(edge.id, &out_buf, wasm_alloc);
        try bufAppendSlice(&out_buf, wasm_alloc, ",\"source\":");
        try writeJsonString(edge.source, &out_buf, wasm_alloc);
        try bufAppendSlice(&out_buf, wasm_alloc, ",\"target\":");
        try writeJsonString(edge.target, &out_buf, wasm_alloc);
        try bufPrint(&out_buf, wasm_alloc, ",\"data\":{{\"weight\":{d}}}", .{edge.weight});
        try bufAppend(&out_buf, wasm_alloc, '}');
    }

    try bufAppendSlice(&out_buf, wasm_alloc, "],\"warnings\":[");
    for (validation.warnings.items, 0..) |warn, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        try writeJsonString(warn.message, &out_buf, wasm_alloc);
    }
    try bufAppendSlice(&out_buf, wasm_alloc, "]}");

    return out_buf.toOwnedSlice(wasm_alloc);
}

// ── geodash_olga_import ───────────────────────────────────────────────────────
//
// Input:  { key_content: string, root_location?: {x, y, z} }
// Output: { files: Record<string,string>, shapefiles: Record<string,string>, warnings: string[] }
// (shapefiles values are base64-encoded bytes)

export fn geodash_olga_import(in_ptr: u32, in_len: u32, out_ptr: u32, out_len: u32) i32 {
    const input = @as([*]const u8, @ptrFromInt(in_ptr))[0..in_len];
    const data = runOlgaImport(input) catch |e| return setError(e, out_ptr, out_len);
    return setOutput(out_ptr, out_len, data);
}

fn runOlgaImport(input: []const u8) ![]u8 {
    const json_parsed = try std.json.parseFromSlice(std.json.Value, wasm_alloc, input, .{});
    defer json_parsed.deinit();

    const obj = switch (json_parsed.value) {
        .object => |o| o,
        else => return error.InvalidInput,
    };

    const key_content: []const u8 = switch (obj.get("key_content") orelse return error.MissingKeyContent) {
        .string => |s| s,
        else => return error.InvalidInput,
    };

    var root_loc: ?olga_mod.RootLocation = null;
    if (obj.get("root_location")) |rl| {
        if (rl == .object) {
            const rlo = rl.object;
            root_loc = olga_mod.RootLocation{
                .x = switch (rlo.get("x") orelse .null) {
                    .float => |f| f,
                    .integer => |i| @as(f64, @floatFromInt(i)),
                    else => 0,
                },
                .y = switch (rlo.get("y") orelse .null) {
                    .float => |f| f,
                    .integer => |i| @as(f64, @floatFromInt(i)),
                    else => 0,
                },
                .z = switch (rlo.get("z") orelse .null) {
                    .float => |f| f,
                    .integer => |i| @as(f64, @floatFromInt(i)),
                    else => 0,
                },
            };
        }
    }

    var validation = net_mod.ValidationResult.init(wasm_alloc);
    defer validation.deinit();

    var parsed = try olga_mod.parseKey(wasm_alloc, key_content, root_loc, &validation);
    defer parsed.deinit(wasm_alloc);

    var out_buf: Buf = .{};
    errdefer out_buf.deinit(wasm_alloc);

    try bufAppendSlice(&out_buf, wasm_alloc, "{\"files\":{");
    var first = true;
    var fit = parsed.files.iterator();
    while (fit.next()) |e| {
        if (!first) try bufAppend(&out_buf, wasm_alloc, ',');
        first = false;
        try bufAppend(&out_buf, wasm_alloc, '"');
        try bufAppendSlice(&out_buf, wasm_alloc, e.key_ptr.*);
        try bufAppendSlice(&out_buf, wasm_alloc, "\":\"");
        // Escape the TOML content for JSON
        for (e.value_ptr.*) |c| {
            switch (c) {
                '"' => try bufAppendSlice(&out_buf, wasm_alloc, "\\\""),
                '\\' => try bufAppendSlice(&out_buf, wasm_alloc, "\\\\"),
                '\n' => try bufAppendSlice(&out_buf, wasm_alloc, "\\n"),
                '\r' => try bufAppendSlice(&out_buf, wasm_alloc, "\\r"),
                '\t' => try bufAppendSlice(&out_buf, wasm_alloc, "\\t"),
                else => try bufAppend(&out_buf, wasm_alloc, c),
            }
        }
        try bufAppend(&out_buf, wasm_alloc, '"');
    }

    try bufAppendSlice(&out_buf, wasm_alloc, "},\"shapefiles\":{");
    first = true;
    var sit = parsed.shapefiles.iterator();
    while (sit.next()) |e| {
        if (!first) try bufAppend(&out_buf, wasm_alloc, ',');
        first = false;
        try bufAppend(&out_buf, wasm_alloc, '"');
        try bufAppendSlice(&out_buf, wasm_alloc, e.key_ptr.*);
        try bufAppendSlice(&out_buf, wasm_alloc, "\":\"");
        // Base64 encode the binary bytes
        const enc = std.base64.standard.Encoder;
        const b64_len = enc.calcSize(e.value_ptr.len);
        const b64_buf = try wasm_alloc.alloc(u8, b64_len);
        defer wasm_alloc.free(b64_buf);
        _ = enc.encode(b64_buf, e.value_ptr.*);
        try bufAppendSlice(&out_buf, wasm_alloc, b64_buf);
        try bufAppend(&out_buf, wasm_alloc, '"');
    }

    try bufAppendSlice(&out_buf, wasm_alloc, "},\"warnings\":[");
    for (validation.warnings.items, 0..) |warn, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        try bufAppend(&out_buf, wasm_alloc, '"');
        for (warn.message) |c| {
            if (c == '"') try bufAppendSlice(&out_buf, wasm_alloc, "\\\"") else try bufAppend(&out_buf, wasm_alloc, c);
        }
        try bufAppend(&out_buf, wasm_alloc, '"');
    }
    try bufAppendSlice(&out_buf, wasm_alloc, "]}");

    return out_buf.toOwnedSlice(wasm_alloc);
}

// ── geodash_olga_export ───────────────────────────────────────────────────────
//
// Input:  { files: Record<string,string>, config?: string,
//           route_segments?: Record<string, [{length_m, elevation_m}]> }
// Output: { key_content: string, warnings: string[] }

export fn geodash_olga_export(in_ptr: u32, in_len: u32, out_ptr: u32, out_len: u32) i32 {
    const input = @as([*]const u8, @ptrFromInt(in_ptr))[0..in_len];
    const data = runOlgaExport(input) catch |e| return setError(e, out_ptr, out_len);
    return setOutput(out_ptr, out_len, data);
}

fn runOlgaExport(input: []const u8) ![]u8 {
    const json_parsed = try std.json.parseFromSlice(std.json.Value, wasm_alloc, input, .{});
    defer json_parsed.deinit();

    var arena = std.heap.ArenaAllocator.init(wasm_alloc);
    defer arena.deinit();
    const a = arena.allocator();

    const pi = try parseInput(a, json_parsed.value);

    var validation = net_mod.ValidationResult.init(a);
    var network = try net_mod.loadNetworkFromFiles(a, &pi.files, &validation);
    try fluid_mod.propagateAndInject(a, &network, &validation);

    // Parse route_segments if provided
    var route_segs: ?std.StringArrayHashMapUnmanaged([]const olga_mod.RouteSegment) = null;
    const obj = switch (json_parsed.value) {
        .object => |o| o,
        else => return error.InvalidInput,
    };

    if (obj.get("route_segments")) |rs_val| {
        if (rs_val == .object) {
            var rs_map = std.StringArrayHashMapUnmanaged([]const olga_mod.RouteSegment){};
            var rs_it = rs_val.object.iterator();
            while (rs_it.next()) |e| {
                if (e.value_ptr.* != .array) continue;
                const arr = e.value_ptr.array.items;
                const segs = try a.alloc(olga_mod.RouteSegment, arr.len);
                for (arr, segs) |item, *seg| {
                    if (item != .object) {
                        seg.* = .{ .length_m = 0, .elevation_m = 0 };
                        continue;
                    }
                    seg.length_m = switch (item.object.get("length_m") orelse .null) {
                        .float => |f| f,
                        .integer => |i| @as(f64, @floatFromInt(i)),
                        else => 0,
                    };
                    seg.elevation_m = switch (item.object.get("elevation_m") orelse .null) {
                        .float => |f| f,
                        .integer => |i| @as(f64, @floatFromInt(i)),
                        else => 0,
                    };
                }
                try rs_map.put(a, e.key_ptr.*, segs);
            }
            route_segs = rs_map;
        }
    }

    const key_content = try olga_mod.writeKey(wasm_alloc, &network, route_segs, &validation);
    defer wasm_alloc.free(key_content);

    var out_buf: Buf = .{};
    errdefer out_buf.deinit(wasm_alloc);

    try bufAppendSlice(&out_buf, wasm_alloc, "{\"key_content\":\"");
    for (key_content) |c| {
        switch (c) {
            '"' => try bufAppendSlice(&out_buf, wasm_alloc, "\\\""),
            '\\' => try bufAppendSlice(&out_buf, wasm_alloc, "\\\\"),
            '\n' => try bufAppendSlice(&out_buf, wasm_alloc, "\\n"),
            '\r' => try bufAppendSlice(&out_buf, wasm_alloc, "\\r"),
            '\t' => try bufAppendSlice(&out_buf, wasm_alloc, "\\t"),
            else => try bufAppend(&out_buf, wasm_alloc, c),
        }
    }
    try bufAppendSlice(&out_buf, wasm_alloc, "\",\"warnings\":[");
    for (validation.warnings.items, 0..) |warn, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        try bufAppend(&out_buf, wasm_alloc, '"');
        for (warn.message) |c| {
            if (c == '"') try bufAppendSlice(&out_buf, wasm_alloc, "\\\"") else try bufAppend(&out_buf, wasm_alloc, c);
        }
        try bufAppend(&out_buf, wasm_alloc, '"');
    }
    try bufAppendSlice(&out_buf, wasm_alloc, "]}");

    return out_buf.toOwnedSlice(wasm_alloc);
}

// ── geodash_compute_route_kp ──────────────────────────────────────────────────
//
// Input:  { shp_b64: string }
// Output: { segments: [{length_m: number, elevation_m: number}] }

export fn geodash_compute_route_kp(in_ptr: u32, in_len: u32, out_ptr: u32, out_len: u32) i32 {
    const input = @as([*]const u8, @ptrFromInt(in_ptr))[0..in_len];
    const data = runComputeRouteKp(input) catch |e| return setError(e, out_ptr, out_len);
    return setOutput(out_ptr, out_len, data);
}

fn runComputeRouteKp(input: []const u8) ![]u8 {
    const json_parsed = try std.json.parseFromSlice(std.json.Value, wasm_alloc, input, .{});
    defer json_parsed.deinit();

    const obj = switch (json_parsed.value) {
        .object => |o| o,
        else => return error.InvalidInput,
    };
    const b64_str: []const u8 = switch (obj.get("shp_b64") orelse return error.MissingShpB64) {
        .string => |s| s,
        else => return error.InvalidInput,
    };

    const dec = std.base64.standard.Decoder;
    const decoded_len = try dec.calcSizeForSlice(b64_str);
    const shp_bytes = try wasm_alloc.alloc(u8, decoded_len);
    defer wasm_alloc.free(shp_bytes);
    try dec.decode(shp_bytes, b64_str);

    var validation = net_mod.ValidationResult.init(wasm_alloc);
    defer validation.deinit();

    const segs = try olga_mod.computeRouteSegmentsFromShp(wasm_alloc, shp_bytes);
    defer wasm_alloc.free(segs);

    var out_buf: Buf = .{};
    errdefer out_buf.deinit(wasm_alloc);

    try bufAppendSlice(&out_buf, wasm_alloc, "{\"segments\":[");
    for (segs, 0..) |seg, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        try bufPrint(&out_buf, wasm_alloc, "{{\"length_m\":{d},\"elevation_m\":{d}}}", .{
            seg.length_m, seg.elevation_m,
        });
    }
    try bufAppendSlice(&out_buf, wasm_alloc, "]}");

    return out_buf.toOwnedSlice(wasm_alloc);
}

// ── geodash_create_route ──────────────────────────────────────────────────────
//
// Input:  { segments: [{length_m, elevation_m}], root: {x, y, z} }
// Output: { shp_b64: string, shx_b64: string, dbf_b64: string }

export fn geodash_create_route(in_ptr: u32, in_len: u32, out_ptr: u32, out_len: u32) i32 {
    const input = @as([*]const u8, @ptrFromInt(in_ptr))[0..in_len];
    const data = runCreateRoute(input) catch |e| return setError(e, out_ptr, out_len);
    return setOutput(out_ptr, out_len, data);
}

fn runCreateRoute(input: []const u8) ![]u8 {
    const json_parsed = try std.json.parseFromSlice(std.json.Value, wasm_alloc, input, .{});
    defer json_parsed.deinit();

    var arena = std.heap.ArenaAllocator.init(wasm_alloc);
    defer arena.deinit();
    const a = arena.allocator();

    const obj = switch (json_parsed.value) {
        .object => |o| o,
        else => return error.InvalidInput,
    };

    // Parse root
    const root_val = obj.get("root") orelse return error.MissingRoot;
    if (root_val != .object) return error.InvalidInput;
    const ro = root_val.object;
    const root = olga_mod.RootLocation{
        .x = switch (ro.get("x") orelse .null) {
            .float => |f| f,
            .integer => |i| @as(f64, @floatFromInt(i)),
            else => 0,
        },
        .y = switch (ro.get("y") orelse .null) {
            .float => |f| f,
            .integer => |i| @as(f64, @floatFromInt(i)),
            else => 0,
        },
        .z = switch (ro.get("z") orelse .null) {
            .float => |f| f,
            .integer => |i| @as(f64, @floatFromInt(i)),
            else => 0,
        },
    };

    // Parse segments
    const segs_val = obj.get("segments") orelse return error.MissingSegments;
    if (segs_val != .array) return error.InvalidInput;
    const segs_arr = segs_val.array.items;
    const segs = try a.alloc(olga_mod.RouteSegment, segs_arr.len);
    for (segs_arr, segs) |item, *seg| {
        if (item != .object) {
            seg.* = .{ .length_m = 0, .elevation_m = 0 };
            continue;
        }
        seg.length_m = switch (item.object.get("length_m") orelse .null) {
            .float => |f| f,
            .integer => |i| @as(f64, @floatFromInt(i)),
            else => 0,
        };
        seg.elevation_m = switch (item.object.get("elevation_m") orelse .null) {
            .float => |f| f,
            .integer => |i| @as(f64, @floatFromInt(i)),
            else => 0,
        };
    }

    const shp_bytes = try olga_mod.createRouteShpBytes(wasm_alloc, segs, root);
    defer wasm_alloc.free(shp_bytes);
    const shx_bytes = try olga_mod.createRouteSHXBytes(wasm_alloc, segs);
    defer wasm_alloc.free(shx_bytes);
    const dbf_bytes = try shapefile.buildDBFBytes(wasm_alloc, &.{}, &.{});
    defer wasm_alloc.free(dbf_bytes);

    const enc = std.base64.standard.Encoder;

    const shp_b64 = try wasm_alloc.alloc(u8, enc.calcSize(shp_bytes.len));
    defer wasm_alloc.free(shp_b64);
    _ = enc.encode(shp_b64, shp_bytes);

    const shx_b64 = try wasm_alloc.alloc(u8, enc.calcSize(shx_bytes.len));
    defer wasm_alloc.free(shx_b64);
    _ = enc.encode(shx_b64, shx_bytes);

    const dbf_b64 = try wasm_alloc.alloc(u8, enc.calcSize(dbf_bytes.len));
    defer wasm_alloc.free(dbf_b64);
    _ = enc.encode(dbf_b64, dbf_bytes);

    var out_buf: Buf = .{};
    errdefer out_buf.deinit(wasm_alloc);

    try bufAppendSlice(&out_buf, wasm_alloc, "{\"shp_b64\":\"");
    try bufAppendSlice(&out_buf, wasm_alloc, shp_b64);
    try bufAppendSlice(&out_buf, wasm_alloc, "\",\"shx_b64\":\"");
    try bufAppendSlice(&out_buf, wasm_alloc, shx_b64);
    try bufAppendSlice(&out_buf, wasm_alloc, "\",\"dbf_b64\":\"");
    try bufAppendSlice(&out_buf, wasm_alloc, dbf_b64);
    try bufAppendSlice(&out_buf, wasm_alloc, "\"}");

    return out_buf.toOwnedSlice(wasm_alloc);
}
