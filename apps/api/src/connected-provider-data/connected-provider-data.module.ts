import { Global, Module } from "@nestjs/common";
import { ConnectedProviderDataController } from "./connected-provider-data.controller.js";
import { ConnectedProviderDataService } from "./connected-provider-data.service.js";

/** In-process owner-scoped read facade for the existing domain facts. */
@Global()
@Module({ controllers: [ConnectedProviderDataController], providers: [ConnectedProviderDataService], exports: [ConnectedProviderDataService] })
export class ConnectedProviderDataModule {}
