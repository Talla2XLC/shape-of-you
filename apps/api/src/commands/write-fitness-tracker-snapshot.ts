import { parseArgs } from "node:util";

import { writePrivateFitnessTrackerSnapshot } from "../import/private-fitness-tracker-snapshot.js";

const maxInputBytes = 16 * 1024 * 1024;

/** Receives one connector capture on stdin and creates a validated private file. */
export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: { output: { type: "string" } }
  });
  const output = values.output?.trim();
  if (!output) throw new Error("Missing required runtime value --output");
  const raw = await readSingleLine();
  if (Buffer.byteLength(raw) > maxInputBytes) {
    throw new Error("Fitness Tracker snapshot input exceeds the allowed bound");
  }
  let input: unknown;
  try {
    input = JSON.parse(raw);
  } catch {
    throw new Error("Fitness Tracker snapshot input is not valid JSON");
  }
  await writePrivateFitnessTrackerSnapshot(output, input);
  process.stdout.write("Private Fitness Tracker snapshot created.\n");
}

function readSingleLine(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let buffered = "";
    if (input.isTTY) input.setRawMode(true);
    input.setEncoding("utf8");
    const finish = (error?: Error) => {
      input.pause();
      if (input.isTTY) input.setRawMode(false);
      input.removeListener("data", onData);
      input.removeListener("end", onEnd);
      if (error) reject(error);
      else resolve(buffered);
    };
    const onData = (chunk: string) => {
      const newline = chunk.search(/[\r\n]/);
      buffered += newline === -1 ? chunk : chunk.slice(0, newline);
      if (Buffer.byteLength(buffered) > maxInputBytes) {
        finish(new Error("Fitness Tracker snapshot input exceeds the allowed bound"));
      } else if (newline !== -1) {
        finish();
      }
    };
    const onEnd = () => {
      if (buffered.length === 0) {
        finish(new Error("Fitness Tracker snapshot input is empty"));
      } else {
        finish();
      }
    };
    input.on("data", onData);
    input.once("end", onEnd);
    input.resume();
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Fitness Tracker snapshot failed"}\n`
  );
  process.exitCode = 1;
});
