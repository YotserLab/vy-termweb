/// <reference types="vite/client" />

// Explicit fallbacks — some IDE TypeScript servers don't pick up the
// vite/client ambient declarations, producing false "cannot find module"
// errors on these imports.
declare module "*.css";
declare module "*?worker" {
  const workerConstructor: new () => Worker;
  export default workerConstructor;
}
