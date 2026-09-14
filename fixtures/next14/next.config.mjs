import {createRequire} from "node:module";
const require = createRequire(import.meta.url);

/** Keep the linked workspace package on the fixture's React peer version. */
export default {
  experimental: {instrumentationHook: true},
  webpack(config, {isServer}) {
    if (!isServer) {
      for (const specifier of ["react", "react/jsx-runtime", "react/jsx-dev-runtime"]) {
        config.resolve.alias[`${specifier}$`] = require.resolve(specifier);
      }
    }
    return config;
  },
};
