{
  description = "Atlas Vault: the web app build (a static directory for any web server or a core server's STATIC_DIR)";

  # The sync server and its NixOS module (services.atlas) are in the core repository:
  # use `github:atlastodo/atlas` for those, and point services.atlas.staticDir at this web-dist
  # (or serve it from any static host and name the server on the sign-in screen).

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    bun2nix = {
      url = "github:nix-community/bun2nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      bun2nix,
    }:
    let
      lib = nixpkgs.lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAllSystems = lib.genAttrs systems;

      # The root package.json is the single source of truth: version:bump keeps every manifest in
      # lockstep with it.
      version = (builtins.fromJSON (builtins.readFile ./package.json)).version;

      overlay = final: _prev: {
        atlas-vault-web = final.callPackage ./nix/packages/web-dist.nix {
          inherit version;
          bun2nix = bun2nix.packages.${final.stdenv.hostPlatform.system}.default;
        };
      };

      pkgsFor = system: nixpkgs.legacyPackages.${system}.extend overlay;
    in
    {
      overlays.default = overlay;

      packages = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # The web app built from source with no API URL baked in: it talks to the server on its
          # own origin, and users can name another on the sign-in screen.
          web-dist = pkgs.atlas-vault-web;
          default = pkgs.atlas-vault-web;
        }
      );

      checks = forAllSystems (system: {
        inherit (self.packages.${system}) web-dist;
      });
    };
}
