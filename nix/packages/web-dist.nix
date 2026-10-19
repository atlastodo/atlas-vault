# The exported web SPA (React Native Web via `expo export`), built from source: a static directory
# for any web server, or for a core server's STATIC_DIR (services.atlas.staticDir).
{
  lib,
  stdenv,
  callPackage,
  bun2nix,
  nodejs_26,
  version,
}:

stdenv.mkDerivation {
  pname = "atlas-vault-web";
  inherit version;

  src = callPackage ./js-source.nix { };

  nativeBuildInputs = [
    bun2nix.hook
    nodejs_26
  ];

  # Regenerate nix/bun.nix whenever bun.lock changes (the `nix:bun-lock` devenv script).
  bunDeps = bun2nix.fetchBunDeps { bunNix = ../bun.nix; };

  # No API URL baked in (the page's origin, or what the user types), no telemetry.
  env = {
    EXPO_PUBLIC_API_URL = "";
    CI = "1";
    EXPO_NO_TELEMETRY = "1";
  };

  dontUseBunBuild = true;
  dontUseBunCheck = true;
  dontUseBunInstall = true;

  buildPhase = ''
    runHook preBuild

    export HOME="$TMPDIR"
    cd apps/vault
    node node_modules/expo/bin/cli export --platform web --clear
    cd ../..

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    cp -r apps/vault/dist "$out"

    runHook postInstall
  '';

  meta = {
    description = "Atlas Vault web app (React Native Web export)";
    homepage = "https://github.com/atlastodo/atlas-vault";
    license = lib.licenses.agpl3Only;
    platforms = lib.platforms.linux;
  };
}
