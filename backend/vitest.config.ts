import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        environment: "node",
        globals: false,
        // Les tests d'intégration parlent à une vraie DB Postgres jetable -
        // pas de parallélisme entre fichiers pour éviter que deux suites ne
        // se marchent dessus sur le même compte/table.
        fileParallelism: false,
        setupFiles: ["./test/setup.ts"],
        testTimeout: 15_000,
    },
});
