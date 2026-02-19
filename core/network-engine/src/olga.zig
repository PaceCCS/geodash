//! OLGA .key file parser and writer.
//!
//! Parser: .key → geodash TOML files + optional PolyLineZ shapefile bytes
//! Writer: geodash Network → .key file text

const std = @import("std");
const toml_mod = @import("toml.zig");
const net_mod = @import("network.zig");
const shapefile = @import("shapefile");

const Allocator = std.mem.Allocator;
const Value = toml_mod.Value;
const Network = net_mod.Network;
const ValidationResult = net_mod.ValidationResult;

// ── Public types ──────────────────────────────────────────────────────────────

pub const RootLocation = struct {
    x: f64,
    y: f64,
    z: f64,
};

/// Output of parseKey.
pub const ParsedKey = struct {
    /// filename → TOML content (e.g. "config.toml", "branch-0.toml")
    files: std.StringArrayHashMapUnmanaged([]const u8) = .{},
    /// filename → raw bytes (base64 NOT applied here; caller encodes if needed)
    /// Keys: "<branch_id>.shp", "<branch_id>.shx", "<branch_id>.dbf"
    shapefiles: std.StringArrayHashMapUnmanaged([]u8) = .{},

    pub fn deinit(self: *ParsedKey, allocator: Allocator) void {
        var fit = self.files.iterator();
        while (fit.next()) |e| {
            allocator.free(e.key_ptr.*);
            allocator.free(e.value_ptr.*);
        }
        self.files.deinit(allocator);

        var sit = self.shapefiles.iterator();
        while (sit.next()) |e| {
            allocator.free(e.key_ptr.*);
            allocator.free(e.value_ptr.*);
        }
        self.shapefiles.deinit(allocator);
    }
};

pub const RouteSegment = struct {
    length_m: f64,
    elevation_m: f64,
};

// ── Internal parser state ─────────────────────────────────────────────────────

const PipeSegment = struct {
    label: []const u8,
    diameter: f64 = 0.12,
    roughness: f64 = 2.8e-5,
    length_m: f64 = 0,
    elevation_m: f64 = 0,
    nsegment: i64 = 4,
};

const SourceDef = struct {
    label: []const u8,
    pipe: []const u8 = "",
    pressure: f64 = 0,
    temperature: f64 = 0,
    massflow: f64 = 0,
};

const CompressorDef = struct {
    label: []const u8,
    differential_pressure: f64 = 0,
};

const FlowPath = struct {
    tag: []const u8,
    branch_label: []const u8 = "",
    fluid: []const u8 = "",
    pipes: std.ArrayListUnmanaged(PipeSegment) = .{},
    sources: std.ArrayListUnmanaged(SourceDef) = .{},
    compressors: std.ArrayListUnmanaged(CompressorDef) = .{},
    ambient_temp: ?f64 = null,
};

const NodeType = enum { closed, pressure, junction };

const NodeDef = struct {
    tag: []const u8,
    node_type: NodeType = .junction,
    label: []const u8 = "",
    pressure: f64 = 0,
    temperature: f64 = 0,
    fluid: []const u8 = "",
};

const Connection = struct {
    /// "FP_TAG INLET" or "FP_TAG OUTLET"
    terminal_a: []const u8,
    terminal_b: []const u8,
};

const FluidDef = struct {
    label: []const u8,
    /// "CO2 0.95, N2 0.05" raw text
    composition: []const u8 = "",
    /// single component name (from SINGLEOPTIONS)
    single: []const u8 = "",
};

// ── Tokenizer ─────────────────────────────────────────────────────────────────

/// Remove `! ...` line comments and join backslash-continued lines.
fn preprocess(allocator: Allocator, src: []const u8) ![]u8 {
    var out = std.ArrayListUnmanaged(u8){};
    errdefer out.deinit(allocator);

    var i: usize = 0;
    while (i < src.len) {
        // Strip comment to end of line
        if (src[i] == '!') {
            while (i < src.len and src[i] != '\n') i += 1;
            continue;
        }
        // Check for backslash continuation (backslash then optional spaces then newline)
        if (src[i] == '\\') {
            var j = i + 1;
            while (j < src.len and (src[j] == ' ' or src[j] == '\t')) j += 1;
            if (j < src.len and src[j] == '\n') {
                // consume backslash + whitespace + newline, emit a space
                try out.append(allocator, ' ');
                i = j + 1;
                continue;
            }
        }
        try out.append(allocator, src[i]);
        i += 1;
    }
    return out.toOwnedSlice(allocator);
}

/// Split preprocessed text into logical statements (one per non-empty line).
fn splitStatements(allocator: Allocator, text: []const u8) ![][]const u8 {
    var stmts = std.ArrayListUnmanaged([]const u8){};
    errdefer stmts.deinit(allocator);

    var it = std.mem.splitScalar(u8, text, '\n');
    while (it.next()) |raw_line| {
        const line = std.mem.trim(u8, raw_line, " \t\r");
        if (line.len == 0) continue;
        try stmts.append(allocator, line);
    }
    return stmts.toOwnedSlice(allocator);
}

// ── Key=Value parser helpers ──────────────────────────────────────────────────

/// Parse a keyword line: first token is the keyword, rest are key=value pairs.
/// Returns keyword and a StringHashMap of key→value (all borrowed from `line`).
const KeywordLine = struct {
    keyword: []const u8,
    /// key → raw value string (may be quoted, may have units after number)
    params: std.StringHashMapUnmanaged([]const u8),

    pub fn deinit(self: *KeywordLine, allocator: Allocator) void {
        self.params.deinit(allocator);
    }

    /// Get a float value, ignoring trailing unit text (e.g. "70 BAR" → 70.0)
    pub fn getFloat(self: *const KeywordLine, key: []const u8) ?f64 {
        const raw = self.params.get(key) orelse return null;
        const trimmed = std.mem.trimLeft(u8, raw, " ");
        // Find end of number
        var end: usize = 0;
        while (end < trimmed.len and (std.ascii.isDigit(trimmed[end]) or
            trimmed[end] == '.' or trimmed[end] == '-' or
            trimmed[end] == '+' or trimmed[end] == 'E' or trimmed[end] == 'e')) end += 1;
        const num_str = trimmed[0..end];
        return std.fmt.parseFloat(f64, num_str) catch null;
    }

    /// Get a string value, stripping surrounding single quotes if present.
    pub fn getString(self: *const KeywordLine, key: []const u8) ?[]const u8 {
        const raw = self.params.get(key) orelse return null;
        const trimmed = std.mem.trim(u8, raw, " ");
        if (trimmed.len >= 2 and trimmed[0] == '\'' and trimmed[trimmed.len - 1] == '\'') {
            return trimmed[1 .. trimmed.len - 1];
        }
        if (trimmed.len >= 2 and trimmed[0] == '"' and trimmed[trimmed.len - 1] == '"') {
            return trimmed[1 .. trimmed.len - 1];
        }
        return trimmed;
    }
};

fn parseKeywordLine(allocator: Allocator, line: []const u8) !KeywordLine {
    var params = std.StringHashMapUnmanaged([]const u8){};
    errdefer params.deinit(allocator);

    // Find keyword (first word)
    var i: usize = 0;
    while (i < line.len and !std.ascii.isWhitespace(line[i])) i += 1;
    const keyword = line[0..i];

    // Parse remaining key=value pairs
    while (i < line.len) {
        // Skip whitespace and commas
        while (i < line.len and (std.ascii.isWhitespace(line[i]) or line[i] == ',')) i += 1;
        if (i >= line.len) break;

        // Find '='
        const key_start = i;
        while (i < line.len and line[i] != '=' and line[i] != ',' and !std.ascii.isWhitespace(line[i])) i += 1;
        const key = line[key_start..i];
        if (key.len == 0) { i += 1; continue; }

        while (i < line.len and std.ascii.isWhitespace(line[i])) i += 1;
        if (i >= line.len or line[i] != '=') continue;
        i += 1; // skip '='
        while (i < line.len and std.ascii.isWhitespace(line[i])) i += 1;

        // Parse value: handle parenthesized, quoted, or bare
        const val_start = i;
        var val_end: usize = i;
        if (i < line.len and line[i] == '(') {
            // Consume balanced parens
            var depth: i32 = 0;
            while (i < line.len) {
                if (line[i] == '(') depth += 1;
                if (line[i] == ')') {
                    depth -= 1;
                    if (depth == 0) { i += 1; break; }
                }
                i += 1;
            }
            val_end = i;
        } else if (i < line.len and (line[i] == '\'' or line[i] == '"')) {
            const q = line[i];
            i += 1;
            while (i < line.len and line[i] != q) i += 1;
            if (i < line.len) i += 1;
            val_end = i;
        } else {
            // Bare value: up to comma or end of line
            while (i < line.len and line[i] != ',') i += 1;
            val_end = i;
        }

        const val = std.mem.trim(u8, line[val_start..val_end], " \t");
        if (key.len > 0) {
            try params.put(allocator, key, val);
        }
    }

    return KeywordLine{ .keyword = keyword, .params = params };
}

// ── Parser ────────────────────────────────────────────────────────────────────

/// Parse an OLGA .key file into geodash TOML files.
pub fn parseKey(
    allocator: Allocator,
    key_content: []const u8,
    root_location: ?RootLocation,
    validation: *ValidationResult,
) !ParsedKey {
    var arena = std.heap.ArenaAllocator.init(allocator);
    defer arena.deinit();
    const a = arena.allocator();

    const preprocessed = try preprocess(a, key_content);
    const statements = try splitStatements(a, preprocessed);

    var flow_paths = std.ArrayListUnmanaged(FlowPath){};
    var nodes = std.ArrayListUnmanaged(NodeDef){};
    var connections = std.ArrayListUnmanaged(Connection){};
    var fluids = std.ArrayListUnmanaged(FluidDef){};
    var network_label: []const u8 = "imported";

    // Parser state
    var in_flowpath: bool = false;
    var in_node: bool = false;
    var current_fp_idx: usize = 0;
    var current_node_idx: usize = 0;

    for (statements) |stmt| {
        var kl = parseKeywordLine(a, stmt) catch continue;
        defer kl.deinit(a);

        const kw = kl.keyword;

        if (std.ascii.eqlIgnoreCase(kw, "CASE")) {
            if (kl.getString("TITLE")) |t| network_label = t;
        } else if (std.ascii.eqlIgnoreCase(kw, "NETWORKCOMPONENT")) {
            const comp_type = kl.getString("TYPE") orelse "";
            const tag = kl.getString("TAG") orelse "";

            if (std.ascii.eqlIgnoreCase(comp_type, "FlowPath")) {
                in_flowpath = true;
                in_node = false;
                current_fp_idx = flow_paths.items.len;
                try flow_paths.append(a, FlowPath{ .tag = tag });
            } else if (std.ascii.eqlIgnoreCase(comp_type, "Node")) {
                in_node = true;
                in_flowpath = false;
                current_node_idx = nodes.items.len;
                try nodes.append(a, NodeDef{ .tag = tag });
            }
        } else if (std.ascii.eqlIgnoreCase(kw, "ENDNETWORKCOMPONENT")) {
            in_flowpath = false;
            in_node = false;
        } else if (std.ascii.eqlIgnoreCase(kw, "ENDCASE")) {
            break;
        } else if (in_flowpath and flow_paths.items.len > 0) {
            const fp = &flow_paths.items[current_fp_idx];

            if (std.ascii.eqlIgnoreCase(kw, "BRANCH")) {
                if (kl.getString("LABEL")) |l| fp.branch_label = l;
                if (kl.getString("FLUID")) |f| fp.fluid = f;
            } else if (std.ascii.eqlIgnoreCase(kw, "PIPE")) {
                const seg = PipeSegment{
                    .label = kl.getString("LABEL") orelse "",
                    .diameter = kl.getFloat("DIAMETER") orelse 0.12,
                    .roughness = kl.getFloat("ROUGHNESS") orelse 2.8e-5,
                    .length_m = kl.getFloat("LENGTH") orelse 0,
                    .elevation_m = kl.getFloat("ELEVATION") orelse 0,
                    .nsegment = if (kl.params.get("NSEGMENT")) |ns|
                        std.fmt.parseInt(i64, std.mem.trim(u8, ns, " "), 10) catch 4
                    else
                        4,
                };
                try fp.pipes.append(a, seg);
            } else if (std.ascii.eqlIgnoreCase(kw, "SOURCE")) {
                const src = SourceDef{
                    .label = kl.getString("LABEL") orelse "",
                    .pipe = kl.getString("PIPE") orelse "",
                    .pressure = kl.getFloat("PRESSURE") orelse 0,
                    .temperature = kl.getFloat("TEMPERATURE") orelse 0,
                    .massflow = kl.getFloat("MASSFLOW") orelse 0,
                };
                try fp.sources.append(a, src);
            } else if (std.ascii.eqlIgnoreCase(kw, "COMPRESSOR")) {
                const comp = CompressorDef{
                    .label = kl.getString("LABEL") orelse "",
                    .differential_pressure = kl.getFloat("DIFFERENTIALPRESSURE") orelse 0,
                };
                try fp.compressors.append(a, comp);
            } else if (std.ascii.eqlIgnoreCase(kw, "HEATTRANSFER")) {
                fp.ambient_temp = kl.getFloat("TAMBIENT");
            }
        } else if (in_node and nodes.items.len > 0) {
            const nd = &nodes.items[current_node_idx];

            if (std.ascii.eqlIgnoreCase(kw, "PARAMETERS")) {
                if (kl.getString("LABEL")) |l| nd.label = l;
                if (kl.getString("FLUID")) |f| nd.fluid = f;
                nd.pressure = kl.getFloat("PRESSURE") orelse 0;
                nd.temperature = kl.getFloat("TEMPERATURE") orelse 0;

                if (kl.getString("TYPE")) |t| {
                    if (std.ascii.eqlIgnoreCase(t, "CLOSED")) {
                        nd.node_type = .closed;
                    } else if (std.ascii.eqlIgnoreCase(t, "PRESSURE")) {
                        nd.node_type = .pressure;
                    }
                }
            }
        } else if (std.ascii.eqlIgnoreCase(kw, "CONNECTION")) {
            // CONNECTION TERMINALS = (FP_A INLET, NODE_B FLOWTERM_1)
            if (kl.params.get("TERMINALS")) |terms_raw| {
                const terms = std.mem.trim(u8, terms_raw, "() \t");
                // Find the comma separating the two terminals
                if (std.mem.indexOf(u8, terms, ",")) |comma_pos| {
                    const a_str = std.mem.trim(u8, terms[0..comma_pos], " ");
                    const b_str = std.mem.trim(u8, terms[comma_pos + 1 ..], " ");
                    try connections.append(a, Connection{
                        .terminal_a = a_str,
                        .terminal_b = b_str,
                    });
                }
            }
        } else if (std.ascii.eqlIgnoreCase(kw, "FEED")) {
            const lbl = kl.getString("LABEL") orelse "FLUID1";
            const comp_raw = kl.params.get("COMPOSITION") orelse "";
            const comp = std.mem.trim(u8, comp_raw, "() \t");
            try fluids.append(a, FluidDef{ .label = lbl, .composition = comp });
        } else if (std.ascii.eqlIgnoreCase(kw, "SINGLEOPTIONS")) {
            const comp = kl.getString("COMPONENT") orelse "CO2";
            try fluids.append(a, FluidDef{ .label = "FLUID1", .single = comp });
        }
    }

    // ── Build outgoing edges from connections ──────────────────────────────────
    // Map flowpath tag → index
    var fp_by_tag = std.StringHashMapUnmanaged(usize){};
    defer fp_by_tag.deinit(a);
    for (flow_paths.items, 0..) |fp, idx| {
        try fp_by_tag.put(a, fp.tag, idx);
    }

    // Map node tag → index
    var node_by_tag = std.StringHashMapUnmanaged(usize){};
    defer node_by_tag.deinit(a);
    for (nodes.items, 0..) |nd, idx| {
        try node_by_tag.put(a, nd.tag, idx);
    }

    // For each FlowPath, track which node is its inlet/outlet
    var fp_inlet_node = std.StringHashMapUnmanaged([]const u8){}; // fp_tag → node_tag
    var fp_outlet_node = std.StringHashMapUnmanaged([]const u8){}; // fp_tag → node_tag
    defer fp_inlet_node.deinit(a);
    defer fp_outlet_node.deinit(a);

    for (connections.items) |conn| {
        // Each terminal is "TAG ROLE" e.g. "FP_PIPE INLET" or "NODE_OUTLET FLOWTERM_1"
        var fp_tag_a: ?[]const u8 = null;
        var role_a: []const u8 = "";
        var fp_tag_b: ?[]const u8 = null;
        var role_b: []const u8 = "";
        var node_tag_a: ?[]const u8 = null;
        var node_tag_b: ?[]const u8 = null;

        {
            const parts = splitTerminal(conn.terminal_a);
            const tag = parts[0];
            const role = if (parts.len > 1) parts[1] else "";
            if (fp_by_tag.contains(tag)) {
                fp_tag_a = tag;
                role_a = role;
            } else if (node_by_tag.contains(tag)) {
                node_tag_a = tag;
            }
        }
        {
            const parts = splitTerminal(conn.terminal_b);
            const tag = parts[0];
            const role = if (parts.len > 1) parts[1] else "";
            if (fp_by_tag.contains(tag)) {
                fp_tag_b = tag;
                role_b = role;
            } else if (node_by_tag.contains(tag)) {
                node_tag_b = tag;
            }
        }

        if (fp_tag_a) |fta| {
            if (std.ascii.eqlIgnoreCase(role_a, "INLET")) {
                if (node_tag_b) |ntb| try fp_inlet_node.put(a, fta, ntb);
            } else if (std.ascii.eqlIgnoreCase(role_a, "OUTLET")) {
                if (node_tag_b) |ntb| try fp_outlet_node.put(a, fta, ntb);
            }
        }
        if (fp_tag_b) |ftb| {
            if (std.ascii.eqlIgnoreCase(role_b, "INLET")) {
                if (node_tag_a) |nta| try fp_inlet_node.put(a, ftb, nta);
            } else if (std.ascii.eqlIgnoreCase(role_b, "OUTLET")) {
                if (node_tag_a) |nta| try fp_outlet_node.put(a, ftb, nta);
            }
        }
    }

    // ── Build outgoing connections between branches ────────────────────────────
    // If FP_A's outlet node is FP_B's inlet node → branch A has outgoing to branch B
    const Outgoing = struct { from_idx: usize, to_idx: usize };
    var outgoings = std.ArrayListUnmanaged(Outgoing){};

    var fp_idx_iter: usize = 0;
    while (fp_idx_iter < flow_paths.items.len) : (fp_idx_iter += 1) {
        const fp = &flow_paths.items[fp_idx_iter];
        const outlet_node_tag = fp_outlet_node.get(fp.tag) orelse continue;
        // Find which FP uses this node as inlet
        var fp_idx2: usize = 0;
        while (fp_idx2 < flow_paths.items.len) : (fp_idx2 += 1) {
            if (fp_idx2 == fp_idx_iter) continue;
            const fp2 = &flow_paths.items[fp_idx2];
            if (fp_inlet_node.get(fp2.tag)) |inlet_tag| {
                if (std.mem.eql(u8, inlet_tag, outlet_node_tag)) {
                    try outgoings.append(a, Outgoing{ .from_idx = fp_idx_iter, .to_idx = fp_idx2 });
                }
            }
        }
    }

    // ── TOML generation ────────────────────────────────────────────────────────

    var result = ParsedKey{};

    // config.toml
    {
        const config_toml = try std.fmt.allocPrint(
            allocator,
            "id = \"{s}\"\nlabel = \"{s}\"\n",
            .{ "imported", network_label },
        );
        try result.files.put(allocator, try allocator.dupe(u8, "config.toml"), config_toml);
    }

    // Branch TOML files
    for (flow_paths.items, 0..) |fp, fi| {
        const branch_id = try std.fmt.allocPrint(allocator, "branch-{d}", .{fi});
        errdefer allocator.free(branch_id);

        var branch_table = Value.Table{};
        defer {
            var it = branch_table.iterator();
            while (it.next()) |e| {
                allocator.free(e.key_ptr.*);
                e.value_ptr.deinit(allocator);
            }
            branch_table.deinit(allocator);
        }

        const type_key = try allocator.dupe(u8, "type");
        try branch_table.put(allocator, type_key, Value{ .string = try allocator.dupe(u8, "branch") });

        const label_val = if (fp.branch_label.len > 0) fp.branch_label else fp.tag;
        const label_key = try allocator.dupe(u8, "label");
        try branch_table.put(allocator, label_key, Value{ .string = try allocator.dupe(u8, label_val) });

        // Outgoing connections
        var outgoing_arr = Value.Array{};
        for (outgoings.items) |og| {
            if (og.from_idx != fi) continue;
            var og_table = Value.Table{};
            const tgt_id = try std.fmt.allocPrint(allocator, "branch-{d}", .{og.to_idx});
            const tgt_key = try allocator.dupe(u8, "target");
            try og_table.put(allocator, tgt_key, Value{ .string = tgt_id });
            try outgoing_arr.append(allocator, Value{ .table = og_table });
        }
        const outgoing_key = try allocator.dupe(u8, "outgoing");
        try branch_table.put(allocator, outgoing_key, Value{ .array = outgoing_arr });

        // Blocks: Source blocks first, then Pipe blocks, then Compressor, Sink
        var block_arr = Value.Array{};

        // Source blocks from inlet node (CLOSED type → Source block)
        if (fp_inlet_node.get(fp.tag)) |inlet_tag| {
            if (node_by_tag.get(inlet_tag)) |ni| {
                const nd = &nodes.items[ni];
                if (nd.node_type == .closed) {
                    var src_table = Value.Table{};
                    const t_key = try allocator.dupe(u8, "type");
                    try src_table.put(allocator, t_key, Value{ .string = try allocator.dupe(u8, "Source") });
                    try block_arr.append(allocator, Value{ .table = src_table });
                }
            }
        }
        // Source blocks from SOURCE statements in the FlowPath
        for (fp.sources.items) |src| {
            var src_table = Value.Table{};
            const t_key = try allocator.dupe(u8, "type");
            try src_table.put(allocator, t_key, Value{ .string = try allocator.dupe(u8, "Source") });
            if (src.pressure != 0) {
                const pk = try allocator.dupe(u8, "pressure");
                try src_table.put(allocator, pk, Value{ .float = src.pressure });
            }
            if (src.temperature != 0) {
                const tk = try allocator.dupe(u8, "temperature");
                try src_table.put(allocator, tk, Value{ .float = src.temperature });
            }
            if (src.massflow != 0) {
                const fk = try allocator.dupe(u8, "flow_rate");
                try src_table.put(allocator, fk, Value{ .float = src.massflow });
            }
            try block_arr.append(allocator, Value{ .table = src_table });
        }

        // Pipe blocks
        for (fp.pipes.items, 0..) |pipe, pi| {
            var pipe_table = Value.Table{};
            const t_key = try allocator.dupe(u8, "type");
            try pipe_table.put(allocator, t_key, Value{ .string = try allocator.dupe(u8, "Pipe") });
            const dk = try allocator.dupe(u8, "diameter");
            try pipe_table.put(allocator, dk, Value{ .float = pipe.diameter });
            const rk = try allocator.dupe(u8, "roughness");
            try pipe_table.put(allocator, rk, Value{ .float = pipe.roughness });
            if (pipe.length_m != 0) {
                const lk = try allocator.dupe(u8, "length");
                try pipe_table.put(allocator, lk, Value{ .float = pipe.length_m });
            }
            if (pipe.elevation_m != 0) {
                const ek = try allocator.dupe(u8, "elevation");
                try pipe_table.put(allocator, ek, Value{ .float = pipe.elevation_m });
            }

            // Set route property if shapefile will be generated
            if (root_location != null) {
                const route_path = try std.fmt.allocPrint(allocator, "{s}-pipe{d}.shp", .{ branch_id, pi });
                const route_key = try allocator.dupe(u8, "route");
                try pipe_table.put(allocator, route_key, Value{ .string = route_path });
            }

            try block_arr.append(allocator, Value{ .table = pipe_table });
        }

        // Compressor blocks
        for (fp.compressors.items) |comp| {
            var comp_table = Value.Table{};
            const t_key = try allocator.dupe(u8, "type");
            try comp_table.put(allocator, t_key, Value{ .string = try allocator.dupe(u8, "Compressor") });
            if (comp.differential_pressure != 0) {
                const dpk = try allocator.dupe(u8, "differential_pressure");
                try comp_table.put(allocator, dpk, Value{ .float = comp.differential_pressure });
            }
            try block_arr.append(allocator, Value{ .table = comp_table });
        }

        // Sink block from outlet node (PRESSURE type → Sink)
        if (fp_outlet_node.get(fp.tag)) |outlet_tag| {
            if (node_by_tag.get(outlet_tag)) |ni| {
                const nd = &nodes.items[ni];
                if (nd.node_type == .pressure) {
                    var sink_table = Value.Table{};
                    const t_key = try allocator.dupe(u8, "type");
                    try sink_table.put(allocator, t_key, Value{ .string = try allocator.dupe(u8, "Sink") });
                    if (nd.pressure != 0) {
                        const pk = try allocator.dupe(u8, "pressure");
                        try sink_table.put(allocator, pk, Value{ .float = nd.pressure });
                    }
                    try block_arr.append(allocator, Value{ .table = sink_table });
                }
            }
        }

        const block_key = try allocator.dupe(u8, "block");
        try branch_table.put(allocator, block_key, Value{ .array = block_arr });

        // ambient_temperature
        if (fp.ambient_temp) |at| {
            const atk = try allocator.dupe(u8, "ambient_temperature");
            try branch_table.put(allocator, atk, Value{ .float = at });
        }

        // Serialize to TOML
        const toml_content = try toml_mod.serialize(allocator, Value{ .table = branch_table });
        const toml_filename = try std.fmt.allocPrint(allocator, "{s}.toml", .{branch_id});
        try result.files.put(allocator, toml_filename, toml_content);
        allocator.free(branch_id);

        // ── Shapefile generation ───────────────────────────────────────────────
        if (root_location) |root| {
            if (fp.pipes.items.len > 0) {
                var points = try allocator.alloc(shapefile.PointZ, fp.pipes.items.len + 1);
                defer allocator.free(points);

                var cur_x = root.x;
                var cur_z = root.z;
                points[0] = .{ .x = cur_x, .y = root.y, .z = cur_z, .m = 0 };
                for (fp.pipes.items, 1..) |pipe, pidx| {
                    cur_x += pipe.length_m;
                    cur_z += pipe.elevation_m;
                    points[pidx] = .{ .x = cur_x, .y = root.y, .z = cur_z, .m = 0 };
                }

                // Build PolyLineZ
                const xy_points = try allocator.alloc([2]f64, points.len);
                defer allocator.free(xy_points);
                const z_vals = try allocator.alloc(f64, points.len);
                defer allocator.free(z_vals);
                const m_vals = try allocator.alloc(f64, points.len);
                defer allocator.free(m_vals);
                const parts = try allocator.alloc(u32, 1);
                defer allocator.free(parts);

                var min_x = points[0].x;
                var max_x = points[0].x;
                var min_z = points[0].z;
                var max_z = points[0].z;

                for (points, 0..) |pt, pidx| {
                    xy_points[pidx] = .{ pt.x, pt.y };
                    z_vals[pidx] = pt.z;
                    m_vals[pidx] = 0;
                    min_x = @min(min_x, pt.x);
                    max_x = @max(max_x, pt.x);
                    min_z = @min(min_z, pt.z);
                    max_z = @max(max_z, pt.z);
                }
                parts[0] = 0;

                const poly = shapefile.PolyLineZ{
                    .bbox = .{ .min_x = min_x, .min_y = root.y, .max_x = max_x, .max_y = root.y },
                    .parts = parts,
                    .points = xy_points,
                    .z_range = .{ .min = min_z, .max = max_z },
                    .z = z_vals,
                    .m_range = .{ .min = 0, .max = 0 },
                    .m = m_vals,
                };

                const shp_records = [_]shapefile.ShpRecord{
                    .{ .number = 1, .geometry = .{ .poly_line_z = poly } },
                };

                const shp_name_base = try std.fmt.allocPrint(allocator, "branch-{d}", .{fi});
                defer allocator.free(shp_name_base);

                const shp_bytes = try shapefile.buildSHPBytes(allocator, &shp_records);
                const shx_bytes = try shapefile.buildSHXBytes(allocator, &shp_records);
                const dbf_bytes = try shapefile.buildDBFBytes(allocator, &.{}, &.{});

                const shp_name = try std.fmt.allocPrint(allocator, "{s}.shp", .{shp_name_base});
                const shx_name = try std.fmt.allocPrint(allocator, "{s}.shx", .{shp_name_base});
                const dbf_name = try std.fmt.allocPrint(allocator, "{s}.dbf", .{shp_name_base});

                try result.shapefiles.put(allocator, shp_name, shp_bytes);
                try result.shapefiles.put(allocator, shx_name, shx_bytes);
                try result.shapefiles.put(allocator, dbf_name, dbf_bytes);
            }
        }
    }

    if (fluids.items.len == 0) {
        try validation.addWarning("No FEED or SINGLEOPTIONS found; fluid composition unknown");
    }

    return result;
}

// ── Helper: split "TAG ROLE" terminal string ──────────────────────────────────

var split_buf: [2][]const u8 = undefined;

fn splitTerminal(terminal: []const u8) []const []const u8 {
    const trimmed = std.mem.trim(u8, terminal, " \t");
    if (std.mem.indexOfScalar(u8, trimmed, ' ')) |sp| {
        split_buf[0] = trimmed[0..sp];
        split_buf[1] = std.mem.trim(u8, trimmed[sp + 1 ..], " ");
        return split_buf[0..2];
    }
    split_buf[0] = trimmed;
    return split_buf[0..1];
}

// ── Writer ────────────────────────────────────────────────────────────────────

/// Generate an OLGA .key file from a geodash network.
pub fn writeKey(
    allocator: Allocator,
    network: *const Network,
    route_segments: ?std.StringArrayHashMapUnmanaged([]const RouteSegment),
    validation: *ValidationResult,
) ![]u8 {
    var out = std.ArrayListUnmanaged(u8){};
    errdefer out.deinit(allocator);

    const w = out.writer(allocator);

    try w.print("! Generated by geodash\nCASE PROJECT='geodash', TITLE='{s}'\n\n", .{network.label});

    try w.writeAll("OPTIONS COMPOSITIONAL=OFF, TEMPERATURE=WALL\n");
    try w.writeAll("TIME ENDTIME=3600, DTSTART=1, DTMAX=60\n");
    try w.writeAll("INTEGRATION MAXITERATIONS=20, MAXLOCALERROR=1e-3\n\n");

    try w.writeAll("MATERIAL LABEL=WALL-1, CONDUCTIVITY=50, CAPACITY=500, DENSITY=7850\n");
    try w.writeAll("WALL LABEL=WALL-1, THICKNESS=(0.02), MATERIAL=(WALL-1)\n\n");

    // Collect all fluid labels from Source blocks
    var fluid_labels = std.ArrayListUnmanaged([]const u8){};
    defer fluid_labels.deinit(allocator);

    for (network.nodes.items) |*node| {
        switch (node.*) {
            .branch => |*br| {
                for (br.blocks.items) |*block| {
                    if (!std.mem.eql(u8, block.type_name, "Source")) continue;
                    if (block.extra.get("fluid_id")) |fv| {
                        if (fv.getString()) |fid| {
                            // Check not already in list
                            var found = false;
                            for (fluid_labels.items) |fl| {
                                if (std.mem.eql(u8, fl, fid)) { found = true; break; }
                            }
                            if (!found) try fluid_labels.append(allocator, fid);
                        }
                    }
                }
            },
            else => {},
        }
    }

    if (fluid_labels.items.len == 0) {
        try fluid_labels.append(allocator, "FLUID1");
        try w.writeAll("SINGLEOPTIONS COMPONENT=CO2\n\n");
    } else {
        for (fluid_labels.items) |fl| {
            try w.print("FEED LABEL={s}, COMPOSITION=(CO2 1.0)\n", .{fl});
        }
        try w.writeByte('\n');
    }

    // ── FlowPath components (branches) ────────────────────────────────────────
    const fluid_label = if (fluid_labels.items.len > 0) fluid_labels.items[0] else "FLUID1";

    for (network.nodes.items, 0..) |*node, ni| {
        switch (node.*) {
            .branch => |*br| {
                const br_id = br.base.id;
                try w.print("NETWORKCOMPONENT TYPE=FlowPath, TAG=FP_{s}\n", .{br_id});

                const br_label = if (br.base.label) |l| l else br_id;
                try w.print("  BRANCH LABEL='{s}', GEOMETRY=GEOM-{d}, FLUID={s}\n", .{ br_label, ni + 1, fluid_label });
                try w.print("  GEOMETRY LABEL=GEOM-{d}\n", .{ni + 1});

                var pipe_count: usize = 0;
                for (br.blocks.items, 0..) |*block, bi| {
                    if (!std.mem.eql(u8, block.type_name, "Pipe")) continue;

                    const block_path = try std.fmt.allocPrint(allocator, "{s}/blocks/{d}", .{ br_id, bi });
                    defer allocator.free(block_path);

                    const diameter = if (block.extra.get("diameter")) |v| v.getFloat() orelse 0.12 else 0.12;
                    const roughness = if (block.extra.get("roughness")) |v| v.getFloat() orelse 2.8e-5 else 2.8e-5;

                    if (route_segments) |rs| {
                        if (rs.get(block_path)) |segs| {
                            for (segs, 0..) |seg, si| {
                                try w.print(
                                    "  PIPE LABEL=PIPE-{d}-{d}, DIAMETER={d:.4}, ROUGHNESS={e:.2}, " ++
                                        "NSEGMENT=1, LENGTH={d:.2}, ELEVATION={d:.2}, WALL=WALL-1\n",
                                    .{ pipe_count, si, diameter, roughness, seg.length_m, seg.elevation_m },
                                );
                            }
                            pipe_count += 1;
                            continue;
                        }
                    }

                    // Fallback: single PIPE from block properties
                    const length = if (block.extra.get("length")) |v| v.getFloat() orelse 0 else 0;
                    const elevation = if (block.extra.get("elevation")) |v| v.getFloat() orelse 0 else 0;
                    if (length == 0) {
                        try validation.addWarningFmt("Pipe block {s} has no length; OLGA PIPE may be invalid", .{block_path});
                    }
                    try w.print(
                        "  PIPE LABEL=PIPE-{d}, DIAMETER={d:.4}, ROUGHNESS={e:.2}, " ++
                            "NSEGMENT=4, LENGTH={d:.2}, ELEVATION={d:.2}, WALL=WALL-1\n",
                        .{ pipe_count, diameter, roughness, length, elevation },
                    );
                    pipe_count += 1;
                }

                // Source blocks
                var src_count: usize = 0;
                for (br.blocks.items) |*block| {
                    if (!std.mem.eql(u8, block.type_name, "Source")) continue;
                    const pressure = if (block.extra.get("pressure")) |v| v.getFloat() orelse 0 else 0;
                    const temperature = if (block.extra.get("temperature")) |v| v.getFloat() orelse 20 else 20;
                    const flow_rate = if (block.extra.get("flow_rate")) |v| v.getFloat() orelse 0 else 0;
                    try w.print(
                        "  SOURCE LABEL=SRC-{s}-{d}, PIPE=PIPE-0, SECTION=1, " ++
                            "PRESSURE={d:.2}, TEMPERATURE={d:.2}, MASSFLOW={d:.4} KG/S, SOURCETYPE=PRESSUREDRIVEN\n",
                        .{ br_id, src_count, pressure, temperature, flow_rate },
                    );
                    src_count += 1;
                }

                // Compressor blocks
                var comp_count: usize = 0;
                for (br.blocks.items) |*block| {
                    if (!std.mem.eql(u8, block.type_name, "Compressor")) continue;
                    const dp = if (block.extra.get("differential_pressure")) |v| v.getFloat() orelse 0 else 0;
                    try w.print(
                        "  COMPRESSOR LABEL=COMP-{s}-{d}, PIPE=PIPE-0, SECTION=1, " ++
                            "DIFFERENTIALPRESSURE={d:.2}\n",
                        .{ br_id, comp_count, dp },
                    );
                    comp_count += 1;
                }

                // HEATTRANSFER if ambient_temperature is set
                if (br.base.extra.get("ambient_temperature")) |atv| {
                    if (atv.getFloat()) |at| {
                        try w.print("  HEATTRANSFER PIPE=ALL, TAMBIENT={d:.2}\n", .{at});
                    }
                }

                try w.writeAll("ENDNETWORKCOMPONENT\n\n");
            },
            else => {},
        }
    }

    // ── Node components ───────────────────────────────────────────────────────
    // Inlet nodes (branches with no incoming edges)
    var has_incoming = std.AutoHashMapUnmanaged(usize, bool){};
    defer has_incoming.deinit(allocator);
    for (network.edges.items) |*edge| {
        // find target node index
        for (network.nodes.items, 0..) |*nd, ni| {
            if (std.mem.eql(u8, nd.id(), edge.target)) {
                try has_incoming.put(allocator, ni, true);
            }
        }
    }

    for (network.nodes.items, 0..) |*node, ni| {
        switch (node.*) {
            .branch => |*br| {
                const br_id = br.base.id;
                if (!has_incoming.contains(ni)) {
                    try w.print("NETWORKCOMPONENT TYPE=Node, TAG=NODE_INLET_{s}\n", .{br_id});
                    try w.print("  PARAMETERS LABEL=INLET_{s}, TYPE=CLOSED\n", .{br_id});
                    try w.writeAll("ENDNETWORKCOMPONENT\n\n");
                }

                // Sink blocks → outlet nodes
                for (br.blocks.items, 0..) |*block, bi| {
                    if (!std.mem.eql(u8, block.type_name, "Sink")) continue;
                    const pressure = if (block.extra.get("pressure")) |v| v.getFloat() orelse 50 else 50;
                    const temperature = if (block.extra.get("temperature")) |v| v.getFloat() orelse 20 else 20;
                    try w.print("NETWORKCOMPONENT TYPE=Node, TAG=NODE_OUTLET_{s}_{d}\n", .{ br_id, bi });
                    try w.print(
                        "  PARAMETERS LABEL=OUTLET_{s}_{d}, TYPE=PRESSURE, " ++
                            "PRESSURE={d:.2}, TEMPERATURE={d:.2}, FLUID={s}\n",
                        .{ br_id, bi, pressure, temperature, fluid_label },
                    );
                    try w.writeAll("ENDNETWORKCOMPONENT\n\n");
                }
            },
            else => {},
        }
    }

    // Junction nodes for each edge
    for (network.edges.items) |*edge| {
        try w.print("NETWORKCOMPONENT TYPE=Node, TAG=NODE_{s}_{s}\n", .{ edge.source, edge.target });
        try w.print("  PARAMETERS LABEL=JUNC_{s}_{s}\n", .{ edge.source, edge.target });
        try w.writeAll("ENDNETWORKCOMPONENT\n\n");
    }

    // ── CONNECTION statements ─────────────────────────────────────────────────
    for (network.nodes.items, 0..) |*node, ni| {
        switch (node.*) {
            .branch => |*br| {
                const br_id = br.base.id;

                // Inlet connection
                if (!has_incoming.contains(ni)) {
                    try w.print(
                        "CONNECTION TERMINALS = (FP_{s} INLET, NODE_INLET_{s} FLOWTERM_1)\n",
                        .{ br_id, br_id },
                    );
                }

                // Outlet connections
                for (network.edges.items) |*edge| {
                    if (!std.mem.eql(u8, edge.source, br_id)) continue;
                    try w.print(
                        "CONNECTION TERMINALS = (FP_{s} OUTLET, NODE_{s}_{s} FLOWTERM_1)\n",
                        .{ br_id, br_id, edge.target },
                    );
                    try w.print(
                        "CONNECTION TERMINALS = (FP_{s} INLET, NODE_{s}_{s} FLOWTERM_1)\n",
                        .{ edge.target, br_id, edge.target },
                    );
                }

                // Sink outlet connections
                for (br.blocks.items, 0..) |*block, bi| {
                    if (!std.mem.eql(u8, block.type_name, "Sink")) continue;
                    try w.print(
                        "CONNECTION TERMINALS = (FP_{s} OUTLET, NODE_OUTLET_{s}_{d} FLOWTERM_1)\n",
                        .{ br_id, br_id, bi },
                    );
                }
            },
            else => {},
        }
    }

    try w.writeAll("\nENDCASE\n");

    return out.toOwnedSlice(allocator);
}

// ── Route helpers ─────────────────────────────────────────────────────────────

/// Compute route segments (length_m, elevation_m) from a PointZ shapefile bytes.
/// For N points, returns N-1 segments.
pub fn computeRouteSegmentsFromShp(
    allocator: Allocator,
    shp_bytes: []const u8,
) ![]RouteSegment {
    const records = try shapefile.readShpFromBytes(allocator, shp_bytes);
    defer {
        for (records) |rec| {
            if (rec.geometry == .poly_line_z) rec.geometry.poly_line_z.deinit(allocator);
        }
        allocator.free(records);
    }

    // Collect PointZ records
    var points = std.ArrayListUnmanaged(shapefile.PointZ){};
    defer points.deinit(allocator);

    for (records) |rec| {
        switch (rec.geometry) {
            .point_z => |p| try points.append(allocator, p),
            .poly_line_z => |pl| {
                for (pl.points, pl.z) |pt, z| {
                    try points.append(allocator, shapefile.PointZ{
                        .x = pt[0], .y = pt[1], .z = z, .m = 0,
                    });
                }
            },
        }
    }

    if (points.items.len < 2) return try allocator.alloc(RouteSegment, 0);

    const kp_points = try shapefile.computeKp(allocator, points.items);
    defer allocator.free(kp_points);

    const n_segs = points.items.len - 1;
    const segs = try allocator.alloc(RouteSegment, n_segs);
    for (0..n_segs) |i| {
        segs[i] = RouteSegment{
            .length_m = (kp_points[i + 1].kp_km - kp_points[i].kp_km) * 1000.0,
            .elevation_m = points.items[i + 1].z - points.items[i].z,
        };
    }
    return segs;
}

/// Create a PolyLineZ shapefile (.shp bytes) from route segments and a root location.
pub fn createRouteShpBytes(
    allocator: Allocator,
    segments: []const RouteSegment,
    root: RootLocation,
) ![]u8 {
    const n_points = segments.len + 1;
    const xy_points = try allocator.alloc([2]f64, n_points);
    defer allocator.free(xy_points);
    const z_vals = try allocator.alloc(f64, n_points);
    defer allocator.free(z_vals);
    const m_vals = try allocator.alloc(f64, n_points);
    defer allocator.free(m_vals);
    const parts = try allocator.alloc(u32, 1);
    defer allocator.free(parts);

    var cur_x = root.x;
    var cur_z = root.z;
    xy_points[0] = .{ cur_x, root.y };
    z_vals[0] = cur_z;
    m_vals[0] = 0;

    var min_x = cur_x;
    var max_x = cur_x;
    var min_z = cur_z;
    var max_z = cur_z;

    for (segments, 1..) |seg, i| {
        cur_x += seg.length_m;
        cur_z += seg.elevation_m;
        xy_points[i] = .{ cur_x, root.y };
        z_vals[i] = cur_z;
        m_vals[i] = 0;
        min_x = @min(min_x, cur_x);
        max_x = @max(max_x, cur_x);
        min_z = @min(min_z, cur_z);
        max_z = @max(max_z, cur_z);
    }
    parts[0] = 0;

    const poly = shapefile.PolyLineZ{
        .bbox = .{ .min_x = min_x, .min_y = root.y, .max_x = max_x, .max_y = root.y },
        .parts = parts,
        .points = xy_points,
        .z_range = .{ .min = min_z, .max = max_z },
        .z = z_vals,
        .m_range = .{ .min = 0, .max = 0 },
        .m = m_vals,
    };

    const shp_records = [_]shapefile.ShpRecord{
        .{ .number = 1, .geometry = .{ .poly_line_z = poly } },
    };

    return shapefile.buildSHPBytes(allocator, &shp_records);
}

pub fn createRouteSHXBytes(
    allocator: Allocator,
    segments: []const RouteSegment,
) ![]u8 {
    const n_points = segments.len + 1;
    const dummy_xy = try allocator.alloc([2]f64, n_points);
    defer allocator.free(dummy_xy);
    const dummy_z = try allocator.alloc(f64, n_points);
    defer allocator.free(dummy_z);
    const dummy_m = try allocator.alloc(f64, n_points);
    defer allocator.free(dummy_m);
    const parts = try allocator.alloc(u32, 1);
    defer allocator.free(parts);
    parts[0] = 0;
    @memset(dummy_z, 0);
    @memset(dummy_m, 0);
    for (dummy_xy) |*p| p.* = .{ 0, 0 };

    const poly = shapefile.PolyLineZ{
        .bbox = .{ .min_x = 0, .min_y = 0, .max_x = 0, .max_y = 0 },
        .parts = parts,
        .points = dummy_xy,
        .z_range = .{ .min = 0, .max = 0 },
        .z = dummy_z,
        .m_range = .{ .min = 0, .max = 0 },
        .m = dummy_m,
    };
    const shp_records = [_]shapefile.ShpRecord{
        .{ .number = 1, .geometry = .{ .poly_line_z = poly } },
    };
    return shapefile.buildSHXBytes(allocator, &shp_records);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test "preprocess strips comments and joins continuations" {
    const allocator = std.testing.allocator;

    const src =
        \\! This is a comment
        \\CASE PROJECT='test', TITLE='Test' \
        \\      OPTION=1
        \\ENDCASE
    ;

    const out = try preprocess(allocator, src);
    defer allocator.free(out);

    try std.testing.expect(std.mem.indexOf(u8, out, "!") == null);
    try std.testing.expect(std.mem.indexOf(u8, out, "CASE") != null);
    try std.testing.expect(std.mem.indexOf(u8, out, "OPTION=1") != null);
}

test "parseKeywordLine basic" {
    const allocator = std.testing.allocator;

    var kl = try parseKeywordLine(allocator, "PIPE LABEL=PIPE-1, DIAMETER=0.12, LENGTH=400");
    defer kl.deinit(allocator);

    try std.testing.expectEqualStrings("PIPE", kl.keyword);
    try std.testing.expectApproxEqAbs(@as(f64, 0.12), kl.getFloat("DIAMETER").?, 1e-9);
    try std.testing.expectApproxEqAbs(@as(f64, 400), kl.getFloat("LENGTH").?, 1e-9);
    try std.testing.expectEqualStrings("PIPE-1", kl.getString("LABEL").?);
}

test "parseKey minimal" {
    const allocator = std.testing.allocator;

    const key =
        \\CASE PROJECT='geodash', TITLE='Test Network'
        \\NETWORKCOMPONENT TYPE=FlowPath, TAG=FP_PIPE
        \\  BRANCH LABEL='PIPE', GEOMETRY=GEOM-1, FLUID=FLUID1
        \\  GEOMETRY LABEL=GEOM-1
        \\  PIPE LABEL=PIPE-1, DIAMETER=0.12, ROUGHNESS=2.8E-05, NSEGMENT=10, \
        \\       LENGTH=400, ELEVATION=10, WALL=WALL-1
        \\ENDNETWORKCOMPONENT
        \\SINGLEOPTIONS COMPONENT=CO2
        \\ENDCASE
    ;

    var validation = net_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var parsed = try parseKey(allocator, key, null, &validation);
    defer parsed.deinit(allocator);

    try std.testing.expect(parsed.files.contains("config.toml"));
    try std.testing.expect(parsed.files.contains("branch-0.toml"));
    try std.testing.expect(parsed.shapefiles.count() == 0);
}

test "parseKey with root_location generates shapefiles" {
    const allocator = std.testing.allocator;

    const key =
        \\CASE PROJECT='geodash', TITLE='Test'
        \\NETWORKCOMPONENT TYPE=FlowPath, TAG=FP_A
        \\  PIPE LABEL=PIPE-1, DIAMETER=0.15, LENGTH=1000, ELEVATION=5
        \\ENDNETWORKCOMPONENT
        \\SINGLEOPTIONS COMPONENT=CO2
        \\ENDCASE
    ;

    var validation = net_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var parsed = try parseKey(allocator, key, RootLocation{ .x = 450000, .y = 6200000, .z = 0 }, &validation);
    defer parsed.deinit(allocator);

    try std.testing.expect(parsed.shapefiles.contains("branch-0.shp"));
    try std.testing.expect(parsed.shapefiles.contains("branch-0.shx"));
    try std.testing.expect(parsed.shapefiles.contains("branch-0.dbf"));
}

test "writeKey round-trip" {
    const allocator = std.testing.allocator;

    var files = std.StringArrayHashMapUnmanaged([]const u8){};
    defer files.deinit(allocator);

    try files.put(allocator, "config.toml",
        \\id = "test"
        \\label = "Test Network"
    );
    try files.put(allocator, "branch-1.toml",
        \\type = "branch"
        \\label = "Pipeline"
        \\
        \\[[block]]
        \\type = "Source"
        \\pressure = 70.0
        \\temperature = 20.0
        \\flow_rate = 18.0
        \\
        \\[[block]]
        \\type = "Pipe"
        \\diameter = 0.12
        \\roughness = 2.8e-05
        \\length = 400
        \\elevation = 10
        \\
        \\[[block]]
        \\type = "Sink"
        \\pressure = 50.0
    );

    var validation = net_mod.ValidationResult.init(allocator);
    defer validation.deinit();

    var network = try net_mod.loadNetworkFromFiles(allocator, &files, &validation);
    defer network.deinit(allocator);

    const key_content = try writeKey(allocator, &network, null, &validation);
    defer allocator.free(key_content);

    try std.testing.expect(std.mem.indexOf(u8, key_content, "CASE PROJECT") != null);
    try std.testing.expect(std.mem.indexOf(u8, key_content, "NETWORKCOMPONENT TYPE=FlowPath") != null);
    try std.testing.expect(std.mem.indexOf(u8, key_content, "PIPE LABEL") != null);
    try std.testing.expect(std.mem.indexOf(u8, key_content, "ENDCASE") != null);
}
