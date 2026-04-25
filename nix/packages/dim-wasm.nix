{ pkgs, dimSrc }:

pkgs.stdenvNoCC.mkDerivation {
  pname = "dim-wasm";
  version = "0.1.1";
  src = dimSrc;

  nativeBuildInputs = [
    pkgs.zig
  ];

  dontConfigure = true;

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    export ZIG_GLOBAL_CACHE_DIR="$TMPDIR/zig-global-cache"
    export ZIG_LOCAL_CACHE_DIR="$TMPDIR/zig-local-cache"
    zig build wasm -Doptimize=ReleaseSmall
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm444 zig-out/bin/dim_wasm.wasm $out/share/dim/dim_wasm.wasm
    install -Dm444 wasm/dim.ts $out/share/dim/dim.ts
    runHook postInstall
  '';
}
