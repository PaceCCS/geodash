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
// Output: { nodes: [{id, type, label?}], edges: [{id, source, target}], warnings: [string] }

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
        try bufPrint(&out_buf, wasm_alloc, "\"id\":\"{s}\",\"type\":\"{s}\"", .{ base.id, base.type_name });
        if (base.label) |l| try bufPrint(&out_buf, wasm_alloc, ",\"label\":\"{s}\"", .{l});
        try bufAppend(&out_buf, wasm_alloc, '}');
    }

    try bufAppendSlice(&out_buf, wasm_alloc, "],\"edges\":[");
    for (network.edges.items, 0..) |*edge, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        try bufPrint(&out_buf, wasm_alloc, "{{\"id\":\"{s}\",\"source\":\"{s}\",\"target\":\"{s}\"}}", .{
            edge.id, edge.source, edge.target,
        });
    }

    try bufAppendSlice(&out_buf, wasm_alloc, "],\"warnings\":[");
    for (validation.warnings.items, 0..) |warn, i| {
        if (i > 0) try bufAppend(&out_buf, wasm_alloc, ',');
        try bufAppend(&out_buf, wasm_alloc, '"');
        try bufAppendSlice(&out_buf, wasm_alloc, warn.message);
        try bufAppend(&out_buf, wasm_alloc, '"');
    }
    try bufAppendSlice(&out_buf, wasm_alloc, "]}");

    return out_buf.toOwnedSlice(wasm_alloc);
}

