import { spawn } from "node:child_process";

const projectName = `shape-of-you-e2e-${process.pid}-${Date.now()}`;
const composeArguments = [
  "compose",
  "--project-name",
  projectName,
  "--file",
  "docker-compose.yml",
  "--file",
  "docker-compose.e2e.yml"
];
const environment = {
  ...process.env,
  LOCAL_API_DATABASE_PORT: "0",
  LOCAL_API_PORT: "0",
  LOCAL_IDENTITY_DATABASE_PORT: "0",
  LOCAL_IDENTITY_PORT: "0"
};

function runDocker(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", arguments_, {
      env: environment,
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve(signal ? 1 : (code ?? 1));
    });
  });
}

let result = 1;

try {
  result = await runDocker([
    ...composeArguments,
    "up",
    "--build",
    "--wait",
    "--wait-timeout",
    "120",
    "api",
    "identity"
  ]);

  if (result === 0) {
    result = await runDocker([
      ...composeArguments,
      "run",
      "--rm",
      "--no-deps",
      "e2e"
    ]);
  }
} finally {
  const cleanupResult = await runDocker([
    ...composeArguments,
    "down",
    "--volumes",
    "--rmi",
    "local",
    "--remove-orphans",
    "--timeout",
    "10"
  ]);

  if (result === 0 && cleanupResult !== 0) {
    result = cleanupResult;
  }
}

process.exitCode = result;
