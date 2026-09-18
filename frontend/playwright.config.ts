import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.resolve(__dirname, "..");

/**
 * Suite E2E - exécutée contre un vrai backend Fastify + une vraie base
 * Postgres jetable (voir docs/testing.md pour le setup local et CI).
 *
 * `webServer` lance backend + frontend automatiquement si rien n'écoute déjà
 * sur ces ports (utile en CI) ; en local, si tu as déjà les deux qui
 * tournent (comme pendant le développement habituel), Playwright les
 * réutilise tels quels (reuseExistingServer).
 */
export default defineConfig({
    testDir: "./e2e",
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    timeout: 30_000,
    use: {
        baseURL: "http://localhost:5173",
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ],
    webServer: [
        {
            command: "npm run dev --workspace=backend",
            cwd: monorepoRoot,
            url: "http://localhost:3000/api/health",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            stdout: "pipe",
        },
        {
            command: "npm run dev --workspace=frontend -- --port 5173 --strictPort",
            cwd: monorepoRoot,
            url: "http://localhost:5173",
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            stdout: "pipe",
        },
    ],
});
