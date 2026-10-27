// Every workspace package is a Vitest project. Packages without their own
// config run in the default node environment; apps/web uses its vite config
// (jsdom + setup file).
export default ['packages/*', 'apps/web'];
