import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const edgeChannelPath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const playwrightPort = 4174;
const playwrightBaseUrl = `http://127.0.0.1:${playwrightPort}`;
const browserUse = { baseURL: playwrightBaseUrl };

if (process.platform === "win32" && existsSync(edgeChannelPath)) {
  browserUse.channel = "msedge";
}

export default defineConfig({
  testDir: "./tests",
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${playwrightPort} --strictPort`,
    url: playwrightBaseUrl,
    reuseExistingServer: false,
  },
  use: browserUse,
  reporter: "list",
});
