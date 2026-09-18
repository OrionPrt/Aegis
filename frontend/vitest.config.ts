import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
    plugins: [react()],
    test: {
        environment: "jsdom",
        globals: false,
        setupFiles: ["./test/setup.ts"],
        exclude: ["node_modules", "dist", "e2e"],
        // deriveKeys() (Argon2id, 64 MiB / 3 passes) prend volontairement
        // 1-3s par appel - le timeout par défaut (5s) est trop court dès
        // qu'un test en fait plusieurs.
        testTimeout: 20_000,
    },
});
