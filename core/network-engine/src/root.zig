pub const toml = @import("toml.zig");
pub const network = @import("network.zig");
pub const scope = @import("scope.zig");
pub const query = @import("query.zig");
pub const fluid = @import("fluid.zig");

// Re-export key types for convenience
pub const Value = toml.Value;
pub const Network = network.Network;
pub const NodeData = network.NodeData;
pub const Block = network.Block;
pub const Edge = network.Edge;
pub const ValidationResult = network.ValidationResult;
pub const Config = scope.Config;
pub const ScopeLevel = scope.ScopeLevel;
pub const ScopeResolver = scope.ScopeResolver;
pub const QueryExecutor = query.QueryExecutor;
pub const Composition = fluid.Composition;
pub const BranchFluid = fluid.BranchFluid;
pub const FluidMap = fluid.FluidMap;

pub const loadNetworkFromFiles = network.loadNetworkFromFiles;
pub const propagateFluid = fluid.propagate;
pub const parseQuery = query.parseQuery;
pub const evaluateQuantities = toml.evaluateQuantities;
pub const serialize = toml.serialize;

test {
    // Pull in all tests from submodules
    @import("std").testing.refAllDecls(@This());
    _ = @import("integration_test.zig");
}
