{ pkgs, packages }:

let
  lib = pkgs.lib;

  sanitizeCFlagsHook = ''
    sanitize_nix_cflags_compile() {
      local filtered=""
      local flag

      for flag in $NIX_CFLAGS_COMPILE; do
        case "$flag" in
          -fmacro-prefix-map=*) ;;
          *)
            if [ -n "$filtered" ]; then
              filtered="$filtered $flag"
            else
              filtered="$flag"
            fi
            ;;
        esac
      done

      export NIX_CFLAGS_COMPILE="$filtered"
    }

    sanitize_nix_cflags_compile
  '';

  makeShell =
    {
      name,
      extraPackages ? [ ],
      extraBuildInputs ? [ ],
      extraShellText ? ""
    }:
    pkgs.mkShell {
      packages = with pkgs; [
        bun
        just
        python3
        uv
        zig
      ] ++ extraPackages;

      nativeBuildInputs = with pkgs; [
        pkg-config
      ];

      buildInputs = with pkgs; [
        proj
      ] ++ extraBuildInputs
        ++ lib.optionals pkgs.stdenv.isDarwin [
          libiconv
        ];

      PROJ_DATA = "${pkgs.proj}/share/proj";
      PROJ_LIB = "${pkgs.proj}/share/proj";

      DIM_WASM_DIR = "${packages.dim-wasm}/share/dim";
      DIM_WASM_PATH = "${packages.dim-wasm}/share/dim/dim_wasm.wasm";
      DIM_TS_PATH = "${packages.dim-wasm}/share/dim/dim.ts";

      shellHook = ''
        ${sanitizeCFlagsHook}
        echo "Entered geodash ${name} dev shell"
        echo "Core tools: bun, zig, just, python3, uv, pkg-config, proj"
        echo "dim WASM: $DIM_WASM_PATH"
        ${extraShellText}
      '';
    };
in
{
  default = makeShell {
    name = "core";
  };

  desktop = makeShell {
    name = "desktop";
    extraPackages = with pkgs; [
      nodejs
    ];
    extraShellText = ''
      echo "Desktop extras: nodejs for Electron/Playwright workflows"
    '';
  };
}
