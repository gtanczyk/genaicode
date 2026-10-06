// scripts/build-ui.mjs bundles CSS imports into the browser client as text.
declare module '*.css' {
  const text: string;
  export default text;
}
