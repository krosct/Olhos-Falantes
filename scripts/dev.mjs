import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_PORT_TRIES = 100;

const ENV_KEYS = {
  "vision-api-key": "VISION_API_KEY",
  "vision-api-base": "VISION_API_BASE",
  "vision-model": "VISION_MODEL",
  "confidence-threshold": "CONFIDENCE_THRESHOLD",
  "vision-timeout-connection": "VISION_TIMEOUT_CONNECTION",
  "vision-timeout-request": "VISION_TIMEOUT_REQUEST",
  "vision-attempts": "VISION_ATTEMPTS",
  "rate-limit-per-minute": "RATE_LIMIT_PER_MINUTE",
  "rate-window-s": "RATE_WINDOW_S",
  "max-image-bytes": "MAX_IMAGE_BYTES",
  "api-port": "API_PORT",
  "api-host": "API_HOST",
  "web-port": "WEB_PORT"
};

function applyDotenv() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) {
    return;
  }
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) {
      continue;
    }
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function applyArgs(argv) {
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      continue;
    }
    let name = token.slice(2);
    let value;
    const equals = name.indexOf("=");
    if (equals !== -1) {
      value = name.slice(equals + 1);
      name = name.slice(0, equals);
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      value = args[i + 1];
      i += 1;
    } else {
      value = "1";
    }
    if (ENV_KEYS[name]) {
      process.env[ENV_KEYS[name]] = value;
    } else if (name === "host") {
      process.env.WEB_HOST = "1";
    } else if (name === "https") {
      process.env.DEV_HTTPS = "1";
    } else if (name === "no-https") {
      process.env.DEV_HTTPS = "0";
    } else {
      console.warn(`[aviso] argumento desconhecido: --${name}`);
    }
  }
}

function withDefaults() {
  process.env.API_HOST ??= "0.0.0.0";
  process.env.API_PORT ??= "8000";
  process.env.WEB_PORT ??= "5173";
  process.env.DEV_HTTPS ??= "0";
  process.env.WEB_HOST ??= "0";
}

function toPort(value, fallback) {
  const port = Number.parseInt(String(value), 10);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : fallback;
}

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", () => resolve(false));
    probe.listen({ port, host }, () => {
      probe.close(() => resolve(true));
    });
  });
}

async function findFreePort(startPort, host, avoid = []) {
  for (let port = startPort; port < startPort + MAX_PORT_TRIES && port < 65536; port += 1) {
    if (avoid.includes(port)) {
      continue;
    }
    if (await isPortFree(port, host)) {
      return port;
    }
  }
  throw new Error(`Nenhuma porta livre a partir de ${startPort}.`);
}

function prefixed(stream, label) {
  stream.on("data", (chunk) => {
    const text = chunk.toString().trimEnd();
    for (const line of text.split("\n")) {
      process.stdout.write(`[${label}] ${line}\n`);
    }
  });
}

async function main() {
  applyDotenv();
  applyArgs(process.argv);
  withDefaults();

  const uvicornBin = process.env.UVICORN ?? join(homedir(), ".venv", "bin", "uvicorn");
  const pythonBin = process.env.PYTHON ?? join(homedir(), ".venv", "bin", "python");
  spawnSync(pythonBin, [join(ROOT, "scripts", "get_voices.py")], { cwd: ROOT, stdio: "inherit" });
  const viteBin = join(ROOT, "node_modules", "vite", "bin", "vite.js");

  const apiHost = process.env.API_HOST;
  const webHost = process.env.WEB_HOST === "1" ? "0.0.0.0" : "127.0.0.1";
  const wantedApiPort = toPort(process.env.API_PORT, 8000);
  const wantedWebPort = toPort(process.env.WEB_PORT, 5173);

  const apiPort = await findFreePort(wantedApiPort, apiHost);
  const webPort = await findFreePort(wantedWebPort, webHost, [apiPort]);

  if (apiPort !== wantedApiPort) {
    console.warn(`[aviso] porta ${wantedApiPort} ocupada; usando ${apiPort} para a API.`);
  }
  if (webPort !== wantedWebPort) {
    console.warn(`[aviso] porta ${wantedWebPort} ocupada; usando ${webPort} para o site.`);
  }

  process.env.API_PORT = String(apiPort);
  process.env.WEB_PORT = String(webPort);
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${apiPort}`;

  if (!process.env.VISION_API_KEY) {
    console.warn(
      "[aviso] VISION_API_KEY nao definida. O backend vai responder 'servico indisponivel'. " +
        "Use .env ou --vision-api-key=SUA_CHAVE."
    );
  }

  const scheme = process.env.DEV_HTTPS === "1" ? "https" : "http";
  console.log("Olhos Falantes");
  console.log(`  API:  http://localhost:${apiPort}/api/describe`);
  console.log(`  Web:  ${scheme}://localhost:${webPort}/`);
  if (process.env.WEB_HOST === "1") {
    console.log("  Rede local: use o IP da maquina no celular (requer DEV_HTTPS=1 para a camera).");
  }
  console.log("  Encerre com Ctrl+C.\n");

  const api = spawn(
    uvicornBin,
    ["server.main:app", "--host", apiHost, "--port", String(apiPort), "--reload"],
    { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] }
  );

  const webArgs = [viteBin, "--port", String(webPort), "--strictPort"];
  if (process.env.WEB_HOST === "1") {
    webArgs.push("--host");
  }
  const web = spawn(process.execPath, webArgs, {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  prefixed(api.stdout, "api");
  prefixed(api.stderr, "api");
  prefixed(web.stdout, "web");
  prefixed(web.stderr, "web");

  let shuttingDown = false;

  function shutdown(code) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const child of [api, web]) {
      if (child && !child.killed) {
        child.kill("SIGINT");
      }
    }
    setTimeout(() => process.exit(code), 300);
  }

  api.on("error", (error) => {
    console.error(
      `[api] nao consegui iniciar (${error.message}). Verifique se ${uvicornBin} existe ` +
        "(pip install fastapi uvicorn no venv)."
    );
    shutdown(1);
  });

  web.on("error", (error) => {
    console.error(`[web] nao consegui iniciar (${error.message}). Rode 'npm install' primeiro.`);
    shutdown(1);
  });

  api.on("exit", (code) => {
    if (!shuttingDown) {
      console.error("[api] encerrou.");
      shutdown(code ?? 1);
    }
  });

  web.on("exit", (code) => {
    if (!shuttingDown) {
      console.error("[web] encerrou.");
      shutdown(code ?? 1);
    }
  });

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
  process.on("exit", () => {
    for (const child of [api, web]) {
      if (child && !child.killed) {
        child.kill("SIGINT");
      }
    }
  });
}

main().catch((error) => {
  console.error(`[erro] ${error.message}`);
  process.exit(1);
});
