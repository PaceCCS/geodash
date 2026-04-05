{
  description = "geodash development environments and packages";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";

    # Pinned dim source for building the shared WASM bundle.
    # Local development can override this input:
    #   nix build path:.#dim-wasm --override-input dim-src path:/Users/you/Repos/dim
    dim-src = {
      url = "github:PaceCCS/dim/v0.1.0";
      flake = false;
    };
  };

  outputs = inputs@{ self, nixpkgs, ... }:
    let
      lib = nixpkgs.lib;
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];

      forAllSystems = f:
        lib.genAttrs systems (system:
          f system (import nixpkgs { inherit system; }));
    in
    {
      packages = forAllSystems (system: pkgs:
        import ./nix/packages {
          inherit pkgs;
          dimSrc = inputs."dim-src";
        });

      devShells = forAllSystems (system: pkgs:
        import ./nix/devshells.nix {
          inherit pkgs;
          packages = self.packages.${system};
        });
    };
}
