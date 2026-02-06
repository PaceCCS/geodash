const std = @import("std");
const Allocator = std.mem.Allocator;

pub const Value = union(enum) {
    string: []const u8,
    integer: i64,
    float: f64,
    boolean: bool,
    table: Table,
    array: Array,

    pub const Table = std.StringArrayHashMapUnmanaged(Value);
    pub const Array = std.ArrayListUnmanaged(Value);

    pub fn deinit(self: *Value, allocator: Allocator) void {
        switch (self.*) {
            .string => |s| allocator.free(s),
            .table => |*t| {
                var it = t.iterator();
                while (it.next()) |entry| {
                    allocator.free(entry.key_ptr.*);
                    entry.value_ptr.deinit(allocator);
                }
                t.deinit(allocator);
            },
            .array => |*a| {
                for (a.items) |*item| {
                    item.deinit(allocator);
                }
                a.deinit(allocator);
            },
            .integer, .float, .boolean => {},
        }
    }

    pub fn getTable(self: Value) ?Table {
        return switch (self) {
            .table => |t| t,
            else => null,
        };
    }

    pub fn getString(self: Value) ?[]const u8 {
        return switch (self) {
            .string => |s| s,
            else => null,
        };
    }

    pub fn getInteger(self: Value) ?i64 {
        return switch (self) {
            .integer => |i| i,
            else => null,
        };
    }

    pub fn getFloat(self: Value) ?f64 {
        return switch (self) {
            .float => |f| f,
            .integer => |i| @as(f64, @floatFromInt(i)),
            else => null,
        };
    }

    pub fn getBool(self: Value) ?bool {
        return switch (self) {
            .boolean => |b| b,
            else => null,
        };
    }

    pub fn getArray(self: Value) ?[]const Value {
        return switch (self) {
            .array => |a| a.items,
            else => null,
        };
    }
};

pub const ParseError = error{
    UnexpectedCharacter,
    UnterminatedString,
    InvalidNumber,
    InvalidValue,
    DuplicateKey,
    InvalidTableHeader,
    OutOfMemory,
    InvalidEscape,
};

pub const Parser = struct {
    allocator: Allocator,
    source: []const u8,
    pos: usize,
    line: usize,

    pub fn init(allocator: Allocator, source: []const u8) Parser {
        return .{
            .allocator = allocator,
            .source = source,
            .pos = 0,
            .line = 1,
        };
    }

    pub fn parse(allocator: Allocator, source: []const u8) ParseError!Value {
        var parser = Parser.init(allocator, source);
        return parser.parseDocument();
    }

    fn parseDocument(self: *Parser) ParseError!Value {
        var root = Value.Table{};
        errdefer {
            var v = Value{ .table = root };
            v.deinit(self.allocator);
        }

        // Parse top-level key-value pairs
        try self.parseKeyValues(&root);

        // Parse table headers and their contents
        while (self.pos < self.source.len) {
            self.skipWhitespaceAndNewlines();
            if (self.pos >= self.source.len) break;

            if (self.source[self.pos] == '[') {
                if (self.pos + 1 < self.source.len and self.source[self.pos + 1] == '[') {
                    // Array of tables [[name]]
                    try self.parseArrayTable(&root);
                } else {
                    // Table [name]
                    try self.parseTableHeader(&root);
                }
            } else if (self.source[self.pos] == '#') {
                self.skipComment();
            } else {
                break;
            }
        }

        return Value{ .table = root };
    }

    fn parseKeyValues(self: *Parser, table: *Value.Table) ParseError!void {
        while (self.pos < self.source.len) {
            self.skipWhitespaceOnly();
            if (self.pos >= self.source.len) break;

            const ch = self.source[self.pos];
            if (ch == '\n') {
                self.pos += 1;
                self.line += 1;
                continue;
            }
            if (ch == '#') {
                self.skipComment();
                continue;
            }
            if (ch == '[') break; // Table header

            // Must be a key-value pair
            const key = try self.parseKey();
            errdefer self.allocator.free(key);

            self.skipWhitespaceOnly();
            if (self.pos >= self.source.len or self.source[self.pos] != '=') {
                self.allocator.free(key);
                return ParseError.UnexpectedCharacter;
            }
            self.pos += 1; // skip '='
            self.skipWhitespaceOnly();

            var value = try self.parseValue();
            errdefer value.deinit(self.allocator);

            try table.put(self.allocator, key, value);
            self.skipWhitespaceOnly();
            if (self.pos < self.source.len and self.source[self.pos] == '#') {
                self.skipComment();
            }
            if (self.pos < self.source.len and self.source[self.pos] == '\n') {
                self.pos += 1;
                self.line += 1;
            }
        }
    }

    fn parseTableHeader(self: *Parser, root: *Value.Table) ParseError!void {
        self.pos += 1; // skip '['
        self.skipWhitespaceOnly();

        // Parse potentially dotted key: [inheritance.rules]
        var keys = try self.parseDottedKey();
        defer {
            for (keys.items) |k| self.allocator.free(k);
            keys.deinit(self.allocator);
        }

        self.skipWhitespaceOnly();
        if (self.pos >= self.source.len or self.source[self.pos] != ']') {
            return ParseError.InvalidTableHeader;
        }
        self.pos += 1; // skip ']'
        self.skipToNextLine();

        // Navigate to the right nested table
        var current: *Value.Table = root;
        for (keys.items[0 .. keys.items.len - 1]) |part| {
            if (current.getPtr(part)) |existing| {
                current = switch (existing.*) {
                    .table => |*t| t,
                    else => return ParseError.DuplicateKey,
                };
            } else {
                const owned_key = try self.allocator.dupe(u8, part);
                errdefer self.allocator.free(owned_key);
                try current.put(self.allocator, owned_key, Value{ .table = .{} });
                current = &current.getPtr(owned_key).?.table;
            }
        }

        // Create the final table
        const final_key = keys.items[keys.items.len - 1];
        if (current.getPtr(final_key)) |existing| {
            current = switch (existing.*) {
                .table => |*t| t,
                else => return ParseError.DuplicateKey,
            };
        } else {
            const owned_key = try self.allocator.dupe(u8, final_key);
            errdefer self.allocator.free(owned_key);
            try current.put(self.allocator, owned_key, Value{ .table = .{} });
            current = &current.getPtr(owned_key).?.table;
        }

        try self.parseKeyValues(current);
    }

    fn parseArrayTable(self: *Parser, root: *Value.Table) ParseError!void {
        self.pos += 2; // skip '[['
        self.skipWhitespaceOnly();

        const name = try self.parseKey();
        errdefer self.allocator.free(name);

        self.skipWhitespaceOnly();
        if (self.pos + 1 >= self.source.len or
            self.source[self.pos] != ']' or
            self.source[self.pos + 1] != ']')
        {
            self.allocator.free(name);
            return ParseError.InvalidTableHeader;
        }
        self.pos += 2; // skip ']]'
        self.skipToNextLine();

        // Parse the table contents
        var item_table = Value.Table{};
        errdefer {
            var v = Value{ .table = item_table };
            v.deinit(self.allocator);
        }
        try self.parseKeyValues(&item_table);

        // Get or create array
        if (root.getPtr(name)) |existing| {
            self.allocator.free(name);
            switch (existing.*) {
                .array => |*arr| {
                    try arr.append(self.allocator, Value{ .table = item_table });
                },
                else => return ParseError.DuplicateKey,
            }
        } else {
            var arr = Value.Array{};
            try arr.append(self.allocator, Value{ .table = item_table });
            try root.put(self.allocator, name, Value{ .array = arr });
        }
    }

    fn parseDottedKey(self: *Parser) ParseError!std.ArrayListUnmanaged([]const u8) {
        var parts = std.ArrayListUnmanaged([]const u8){};
        errdefer {
            for (parts.items) |p| self.allocator.free(p);
            parts.deinit(self.allocator);
        }

        const first = try self.parseKey();
        try parts.append(self.allocator, first);

        while (self.pos < self.source.len and self.source[self.pos] == '.') {
            self.pos += 1; // skip '.'
            const next = try self.parseKey();
            try parts.append(self.allocator, next);
        }

        return parts;
    }

    fn parseKey(self: *Parser) ParseError![]const u8 {
        if (self.pos >= self.source.len) return ParseError.UnexpectedCharacter;

        if (self.source[self.pos] == '"') {
            return self.parseQuotedString();
        }

        // Bare key: A-Za-z0-9_-
        const start = self.pos;
        while (self.pos < self.source.len) {
            const ch = self.source[self.pos];
            if (std.ascii.isAlphanumeric(ch) or ch == '_' or ch == '-') {
                self.pos += 1;
            } else {
                break;
            }
        }
        if (self.pos == start) return ParseError.UnexpectedCharacter;
        return self.allocator.dupe(u8, self.source[start..self.pos]);
    }

    fn parseValue(self: *Parser) ParseError!Value {
        if (self.pos >= self.source.len) return ParseError.InvalidValue;

        const ch = self.source[self.pos];

        if (ch == '"') {
            const s = try self.parseQuotedString();
            return Value{ .string = s };
        }

        if (ch == 't') {
            if (self.pos + 4 <= self.source.len and std.mem.eql(u8, self.source[self.pos..][0..4], "true")) {
                self.pos += 4;
                return Value{ .boolean = true };
            }
            return ParseError.InvalidValue;
        }

        if (ch == 'f') {
            if (self.pos + 5 <= self.source.len and std.mem.eql(u8, self.source[self.pos..][0..5], "false")) {
                self.pos += 5;
                return Value{ .boolean = false };
            }
            return ParseError.InvalidValue;
        }

        if (ch == '[') {
            return self.parseInlineArray();
        }

        // Number (int or float)
        if (ch == '-' or ch == '+' or std.ascii.isDigit(ch)) {
            return self.parseNumber();
        }

        return ParseError.InvalidValue;
    }

    fn parseQuotedString(self: *Parser) ParseError![]const u8 {
        self.pos += 1; // skip opening '"'
        var result = std.ArrayListUnmanaged(u8){};
        errdefer result.deinit(self.allocator);

        while (self.pos < self.source.len) {
            const ch = self.source[self.pos];
            if (ch == '"') {
                self.pos += 1;
                return result.toOwnedSlice(self.allocator);
            }
            if (ch == '\\') {
                self.pos += 1;
                if (self.pos >= self.source.len) return ParseError.InvalidEscape;
                const esc = self.source[self.pos];
                switch (esc) {
                    'n' => try result.append(self.allocator, '\n'),
                    't' => try result.append(self.allocator, '\t'),
                    '\\' => try result.append(self.allocator, '\\'),
                    '"' => try result.append(self.allocator, '"'),
                    'r' => try result.append(self.allocator, '\r'),
                    else => return ParseError.InvalidEscape,
                }
                self.pos += 1;
                continue;
            }
            try result.append(self.allocator, ch);
            self.pos += 1;
        }
        return ParseError.UnterminatedString;
    }

    fn parseNumber(self: *Parser) ParseError!Value {
        const start = self.pos;
        var is_float = false;

        if (self.source[self.pos] == '-' or self.source[self.pos] == '+') {
            self.pos += 1;
        }

        while (self.pos < self.source.len) {
            const ch = self.source[self.pos];
            if (std.ascii.isDigit(ch) or ch == '_') {
                self.pos += 1;
            } else if (ch == '.' and !is_float) {
                is_float = true;
                self.pos += 1;
            } else if (ch == 'e' or ch == 'E') {
                is_float = true;
                self.pos += 1;
                if (self.pos < self.source.len and (self.source[self.pos] == '+' or self.source[self.pos] == '-')) {
                    self.pos += 1;
                }
            } else {
                break;
            }
        }

        const num_str = self.source[start..self.pos];

        if (is_float) {
            var clean = std.ArrayListUnmanaged(u8){};
            defer clean.deinit(self.allocator);
            for (num_str) |c| {
                if (c != '_') clean.append(self.allocator, c) catch return ParseError.OutOfMemory;
            }
            const f = std.fmt.parseFloat(f64, clean.items) catch return ParseError.InvalidNumber;
            return Value{ .float = f };
        } else {
            var clean = std.ArrayListUnmanaged(u8){};
            defer clean.deinit(self.allocator);
            for (num_str) |c| {
                if (c != '_') clean.append(self.allocator, c) catch return ParseError.OutOfMemory;
            }
            const i = std.fmt.parseInt(i64, clean.items, 10) catch return ParseError.InvalidNumber;
            return Value{ .integer = i };
        }
    }

    fn parseInlineArray(self: *Parser) ParseError!Value {
        self.pos += 1; // skip '['
        var arr = Value.Array{};
        errdefer {
            for (arr.items) |*item| {
                item.deinit(self.allocator);
            }
            arr.deinit(self.allocator);
        }

        self.skipWhitespaceAndNewlines();

        if (self.pos < self.source.len and self.source[self.pos] == ']') {
            self.pos += 1;
            return Value{ .array = arr };
        }

        while (self.pos < self.source.len) {
            self.skipWhitespaceAndNewlines();
            if (self.pos < self.source.len and self.source[self.pos] == ']') {
                self.pos += 1;
                return Value{ .array = arr };
            }

            var val = try self.parseValue();
            errdefer val.deinit(self.allocator);
            try arr.append(self.allocator, val);

            self.skipWhitespaceAndNewlines();
            if (self.pos < self.source.len and self.source[self.pos] == ',') {
                self.pos += 1;
            }
        }

        return ParseError.UnexpectedCharacter;
    }

    fn skipWhitespaceOnly(self: *Parser) void {
        while (self.pos < self.source.len and (self.source[self.pos] == ' ' or self.source[self.pos] == '\t' or self.source[self.pos] == '\r')) {
            self.pos += 1;
        }
    }

    fn skipWhitespaceAndNewlines(self: *Parser) void {
        while (self.pos < self.source.len) {
            const ch = self.source[self.pos];
            if (ch == ' ' or ch == '\t' or ch == '\r') {
                self.pos += 1;
            } else if (ch == '\n') {
                self.pos += 1;
                self.line += 1;
            } else if (ch == '#') {
                self.skipComment();
            } else {
                break;
            }
        }
    }

    fn skipComment(self: *Parser) void {
        while (self.pos < self.source.len and self.source[self.pos] != '\n') {
            self.pos += 1;
        }
    }

    fn skipToNextLine(self: *Parser) void {
        self.skipWhitespaceOnly();
        if (self.pos < self.source.len and self.source[self.pos] == '#') {
            self.skipComment();
        }
        if (self.pos < self.source.len and self.source[self.pos] == '\n') {
            self.pos += 1;
            self.line += 1;
        }
    }
};

// Tests
test "parse simple key-value pairs" {
    const allocator = std.testing.allocator;
    const source =
        \\type = "branch"
        \\label = "Branch 4"
        \\quantity = 42
        \\ratio = 3.14
        \\active = true
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    const table = result.table;
    try std.testing.expectEqualStrings("branch", table.get("type").?.getString().?);
    try std.testing.expectEqualStrings("Branch 4", table.get("label").?.getString().?);
    try std.testing.expectEqual(@as(i64, 42), table.get("quantity").?.getInteger().?);
    try std.testing.expectApproxEqAbs(@as(f64, 3.14), table.get("ratio").?.getFloat().?, 0.001);
    try std.testing.expectEqual(true, table.get("active").?.getBool().?);
}

test "parse table sections" {
    const allocator = std.testing.allocator;
    const source =
        \\name = "test"
        \\
        \\[position]
        \\x = -100
        \\y = 350
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    const root = result.table;
    try std.testing.expectEqualStrings("test", root.get("name").?.getString().?);

    const pos = root.get("position").?.table;
    try std.testing.expectEqual(@as(i64, -100), pos.get("x").?.getInteger().?);
    try std.testing.expectEqual(@as(i64, 350), pos.get("y").?.getInteger().?);
}

test "parse array of tables" {
    const allocator = std.testing.allocator;
    const source =
        \\[[block]]
        \\type = "Source"
        \\pressure = 15.5
        \\
        \\[[block]]
        \\type = "Pipe"
        \\quantity = 1
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    const blocks = result.table.get("block").?.getArray().?;
    try std.testing.expectEqual(@as(usize, 2), blocks.len);

    const first = blocks[0].table;
    try std.testing.expectEqualStrings("Source", first.get("type").?.getString().?);
    try std.testing.expectApproxEqAbs(@as(f64, 15.5), first.get("pressure").?.getFloat().?, 0.001);

    const second = blocks[1].table;
    try std.testing.expectEqualStrings("Pipe", second.get("type").?.getString().?);
}

test "parse comments" {
    const allocator = std.testing.allocator;
    const source =
        \\# This is a comment
        \\name = "test" # inline comment
        \\value = 42
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    try std.testing.expectEqualStrings("test", result.table.get("name").?.getString().?);
    try std.testing.expectEqual(@as(i64, 42), result.table.get("value").?.getInteger().?);
}

test "parse dagger config.toml format" {
    const allocator = std.testing.allocator;
    const source =
        \\# Global properties (preset-level defaults)
        \\[properties]
        \\ambientTemperature = 20.0
        \\pressure = 14.7
        \\
        \\# Inheritance rules
        \\[inheritance]
        \\general = ["block", "branch", "group", "global"]
        \\
        \\[inheritance.rules]
        \\ambientTemperature = ["group", "global"]
        \\pressure = ["block"]
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    const props = result.table.get("properties").?.table;
    try std.testing.expectApproxEqAbs(@as(f64, 20.0), props.get("ambientTemperature").?.getFloat().?, 0.001);
    try std.testing.expectApproxEqAbs(@as(f64, 14.7), props.get("pressure").?.getFloat().?, 0.001);

    const inheritance = result.table.get("inheritance").?.table;
    const general = inheritance.get("general").?.getArray().?;
    try std.testing.expectEqual(@as(usize, 4), general.len);
    try std.testing.expectEqualStrings("block", general[0].getString().?);

    const rules = inheritance.get("rules").?.table;
    const ambient_rule = rules.get("ambientTemperature").?.getArray().?;
    try std.testing.expectEqual(@as(usize, 2), ambient_rule.len);
    try std.testing.expectEqualStrings("group", ambient_rule[0].getString().?);
}

test "parse dagger branch file format" {
    const allocator = std.testing.allocator;
    const source =
        \\type = "branch"
        \\
        \\label = "Branch 4"
        \\
        \\[position]
        \\x = -100
        \\y = 350
        \\
        \\[[outgoing]]
        \\target = "branch-2"
        \\weight = 1
        \\
        \\[[block]]
        \\quantity = 1
        \\type = "Source"
        \\pressure = 15.5
        \\
        \\[[block]]
        \\quantity = 1
        \\type = "Pipe"
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    const root = result.table;
    try std.testing.expectEqualStrings("branch", root.get("type").?.getString().?);
    try std.testing.expectEqualStrings("Branch 4", root.get("label").?.getString().?);

    const pos = root.get("position").?.table;
    try std.testing.expectEqual(@as(i64, -100), pos.get("x").?.getInteger().?);

    const outgoing = root.get("outgoing").?.getArray().?;
    try std.testing.expectEqual(@as(usize, 1), outgoing.len);
    try std.testing.expectEqualStrings("branch-2", outgoing[0].table.get("target").?.getString().?);

    const blocks = root.get("block").?.getArray().?;
    try std.testing.expectEqual(@as(usize, 2), blocks.len);
    try std.testing.expectEqualStrings("Source", blocks[0].table.get("type").?.getString().?);
    try std.testing.expectApproxEqAbs(@as(f64, 15.5), blocks[0].table.get("pressure").?.getFloat().?, 0.001);
}

test "parse inline array" {
    const allocator = std.testing.allocator;
    const source =
        \\items = ["block", "branch", "group", "global"]
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    const items = result.table.get("items").?.getArray().?;
    try std.testing.expectEqual(@as(usize, 4), items.len);
    try std.testing.expectEqualStrings("block", items[0].getString().?);
    try std.testing.expectEqualStrings("global", items[3].getString().?);
}

test "parse negative numbers" {
    const allocator = std.testing.allocator;
    const source =
        \\x = -100
        \\y = -3.14
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    try std.testing.expectEqual(@as(i64, -100), result.table.get("x").?.getInteger().?);
    try std.testing.expectApproxEqAbs(@as(f64, -3.14), result.table.get("y").?.getFloat().?, 0.001);
}

test "parse empty input" {
    const allocator = std.testing.allocator;
    var result = try Parser.parse(allocator, "");
    defer result.deinit(allocator);
    try std.testing.expectEqual(@as(usize, 0), result.table.count());
}

test "parse string escapes" {
    const allocator = std.testing.allocator;
    const source =
        \\path = "foo\\bar"
        \\msg = "hello\nworld"
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    try std.testing.expectEqualStrings("foo\\bar", result.table.get("path").?.getString().?);
    try std.testing.expectEqualStrings("hello\nworld", result.table.get("msg").?.getString().?);
}

test "parse dotted table headers" {
    const allocator = std.testing.allocator;
    const source =
        \\[inheritance]
        \\general = ["block"]
        \\
        \\[inheritance.rules]
        \\pressure = ["block"]
    ;

    var result = try Parser.parse(allocator, source);
    defer result.deinit(allocator);

    const inheritance = result.table.get("inheritance").?.table;
    const general = inheritance.get("general").?.getArray().?;
    try std.testing.expectEqualStrings("block", general[0].getString().?);

    const rules = inheritance.get("rules").?.table;
    const pressure = rules.get("pressure").?.getArray().?;
    try std.testing.expectEqualStrings("block", pressure[0].getString().?);
}
