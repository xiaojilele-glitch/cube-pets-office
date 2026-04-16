import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const vitePackageJson = require.resolve("vite/package.json");
const viteBin = path.join(path.dirname(vitePackageJson), "bin", "vite.js");

const result = spawnSync(process.execPath, [viteBin, "build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    GITHUB_PAGES: "true",
    DEPLOY_TARGET: "github-pages",
  },
});

process.exit(result.status ?? 1);
