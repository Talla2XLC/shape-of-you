import { Injectable, type OnApplicationShutdown } from "@nestjs/common";

import type { DatabaseContext } from "./context.js";

/**
 * Closes a database context only when the current application created it.
 */
@Injectable()
export class DatabaseLifecycle implements OnApplicationShutdown {
  public constructor(
    private readonly database: DatabaseContext | undefined,
    private readonly ownsDatabase: boolean
  ) {}

  /**
   * Releases the owned PostgreSQL pool during Nest application shutdown.
   */
  public async onApplicationShutdown(): Promise<void> {
    if (this.ownsDatabase && this.database) {
      await this.database.pool.end();
    }
  }
}
