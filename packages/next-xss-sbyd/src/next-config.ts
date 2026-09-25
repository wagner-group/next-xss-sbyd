import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import type {NextConfig} from "next";

export interface XssSbydOptions {
  /** Disable automatic JSX import redirection when diagnosing compatibility problems. */
  redirectJsxRuntime?: boolean;
}

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));

function normalized(filename: string): string {
  return filename.replace(/\\/g, "/");
}

/**
 * Adds default-on JSX import checks to Next webpack builds, after the existing
 * webpack callback. Wrap the resolved object in function/async Next configs.
 * Turbopack requires an explicit opt-out until it supports this integration.
 * This does not cover external modules, classic React calls, or DOM writes.
 */
export function withXssSbyd(config: NextConfig = {}, options: XssSbydOptions = {}): NextConfig {
  if (options.redirectJsxRuntime === false) {
    console.warn("next-xss-sbyd: JSX import redirection is disabled; dependency JSX imports are unchecked.");
    return config;
  }
  if (process.env.TURBOPACK) {
    throw new Error("next-xss-sbyd: JSX import redirection does not support Turbopack. Use next dev/build --webpack on Next 16 (omit --turbo on Next 14/15), or explicitly disable it with withXssSbyd(config, {redirectJsxRuntime: false}).");
  }
  const previous = config.webpack;
  return {
    ...config,
    // A CommonJS dependency needs a synchronous JSX factory. Next's Pages
    // externalization can otherwise turn the ESM adapter into import(), yielding
    // a Promise instead of its functions. Keep the adapters and their ESM
    // SafeValues dependency synchronous, sharing the bundled builders.
    transpilePackages: [...new Set([...(config.transpilePackages ?? []), "next-xss-sbyd", "safevalues"])],
    webpack(webpackConfig, context) {
      const configured = previous ? previous.call(this, webpackConfig, context) : webpackConfig;
      // Environment-selected opt-outs need distinct persistent caches even when
      // next.config itself is unchanged. Cached modules contain rewritten imports.
      if (configured.cache && configured.cache.type === "filesystem") {
        configured.cache = {...configured.cache, version: `${configured.cache.version ?? ""}|next-xss-sbyd-jsx-v1`};
      }
      const require = createRequire(join(context.dir, "package.json"));
      const nextDirectory = join(dirname(require.resolve("next/package.json")), "dist");
      const excluded = [runtimeDirectory, nextDirectory].map((directory) => `${normalized(directory)}/`);
      configured.plugins ??= [];
      configured.plugins.push(new context.webpack.NormalModuleReplacementPlugin(
        /^react\/jsx(?:-dev)?-runtime$/,
        function redirectRuntime(resource: {contextInfo: {issuer: string}; request: string; dependencies: {request: string}[]}) {
          const issuer = normalized(resource.contextInfo.issuer);
          // Keep original React imports in our checked adapters and Next's own
          // renderers. Also recognize unresolved symlinks (resolve.symlinks=false).
          if (excluded.some((directory) => issuer.startsWith(directory)) ||
              /\/node_modules\/(?:next-xss-sbyd|next)\/dist\//.test(issuer)) return;
          const request = resource.request;
          resource.request = join(runtimeDirectory, request === "react/jsx-dev-runtime" ? "jsx-dev-runtime.js" : "jsx-runtime.js");
          // ExternalsPlugin reads the dependency request rather than the resolve
          // request. Update both so Pages Router cannot externalize the original
          // runtime before resolving our replacement. The wrapper's own React
          // imports remain untouched and retain Next's external/alias behavior.
          for (const dependency of resource.dependencies) {
            dependency.request = resource.request;
          }
        },
      ));
      return configured;
    },
  };
}
