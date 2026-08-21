import { writeFile } from "node:fs/promises";

/** Sink for explicitly requested private import evidence. */
export interface PrivateImportReportSink<Detail> {
  /** Writes one private report without replacing an existing file. */
  write(detail: Detail): Promise<void>;
}

/** File sink that creates a new operator-owned report with private permissions. */
export class PrivateJsonFileReportSink<Detail>
  implements PrivateImportReportSink<Detail>
{
  public constructor(private readonly path: string) {}

  /** Writes deterministic JSON with mode 0600 and fails if the path exists. */
  public write(detail: Detail): Promise<void> {
    return writeFile(this.path, `${JSON.stringify(detail, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  }
}
