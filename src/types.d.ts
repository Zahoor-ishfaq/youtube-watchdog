// esbuild inlines CSS imported from TypeScript as a string (see esbuild.config.mjs).
declare module '*.css' {
  const css: string;
  export default css;
}
