// hash-wasm's per-algorithm build has no type declarations of its own; it exports the same function
// as the package entry.
declare module "hash-wasm/dist/argon2.umd.min.js" {
  export { argon2id } from "hash-wasm";
}
