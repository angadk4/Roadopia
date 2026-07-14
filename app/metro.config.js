// Metro config for the pnpm monorepo (Expo "Work with monorepos" guide).
// Watches the workspace root and resolves modules from both the app's and the
// root node_modules so hoisted + workspace packages resolve on device + EAS.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Append the workspace root to Metro's DEFAULTS (don't replace them — expo-doctor
// flags a bare override, and the defaults carry the project root + asset globs).
config.watchFolders = [...(config.watchFolders ?? []), workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
