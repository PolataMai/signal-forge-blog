import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoScript = path.resolve(__dirname, "../../../../scripts/publish-post.mjs");

const child = spawn(process.execPath, [repoScript, ...process.argv.slice(2)], {
  stdio: "inherit"
});

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
