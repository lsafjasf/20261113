import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const localLibraries = ".test-deps/root/usr/lib/x86_64-linux-gnu";
const browserEnv = existsSync(localLibraries)
  ? {
      ...process.env,
      LD_LIBRARY_PATH: [
        localLibraries,
        process.env.LD_LIBRARY_PATH || "",
      ]
        .filter(Boolean)
        .join(":"),
    }
  : process.env;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4317",
    viewport: { width: 1440, height: 960 },
    launchOptions: {
      args: ["--autoplay-policy=no-user-gesture-required"],
      env: browserEnv,
    },
  },
  webServer: {
    command: "PORT=4317 node server.mjs",
    port: 4317,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
