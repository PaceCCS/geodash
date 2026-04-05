{ pkgs, dimSrc }:

{
  dim-wasm = import ./dim-wasm.nix {
    inherit pkgs dimSrc;
  };
}
