const path = require("node:path")
const { getDefaultConfig, mergeConfig } = require("@react-native/metro-config")

const pixScriptingRoot = path.resolve(__dirname, "../../Pix-Scripting")
const localNodeModules = path.resolve(__dirname, "node_modules")
const scriptingEntry = path.resolve(__dirname, "src/scripting/index.ts")

const config = {
  watchFolders: [pixScriptingRoot],
  resolver: {
    extraNodeModules: {
      scripting: scriptingEntry,
      react: path.join(localNodeModules, "react"),
      "react-native": path.join(localNodeModules, "react-native"),
      "@babel/runtime": path.join(localNodeModules, "@babel/runtime"),
    },
    nodeModulesPaths: [localNodeModules],
    resolveRequest(context, moduleName, platform) {
      if (moduleName === "scripting") {
        return {
          filePath: scriptingEntry,
          type: "sourceFile",
        }
      }
      if (moduleName === "react/jsx-runtime" || moduleName === "react/jsx-dev-runtime") {
        return {
          filePath: require.resolve(moduleName, { paths: [localNodeModules] }),
          type: "sourceFile",
        }
      }
      return context.resolveRequest(context, moduleName, platform)
    },
  },
}

module.exports = mergeConfig(getDefaultConfig(__dirname), config)
