const probes = [
  { name: "API liveness", url: "http://api:3000/health", expected: { status: "ok" } },
  { name: "API database readiness", url: "http://api:3000/ready", expected: { status: "ready", database: "up" } },
  { name: "Identity liveness", url: "http://identity:3000/live", expected: { status: "alive" } },
  { name: "Identity database readiness", url: "http://identity:3000/ready", expected: { status: "ready" } }
];

for (const probe of probes) {
  const response = await fetch(probe.url, { signal: AbortSignal.timeout(5_000) });
  const body = await response.json();

  if (!response.ok || JSON.stringify(body) !== JSON.stringify(probe.expected)) {
    throw new Error(`${probe.name} failed: HTTP ${response.status} ${JSON.stringify(body)}`);
  }

  process.stdout.write(`${probe.name} passed.\n`);
}

process.stdout.write("Local API and Identity E2E smoke passed.\n");
