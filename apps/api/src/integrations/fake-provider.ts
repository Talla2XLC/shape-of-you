import type {
  HealthDataProvider,
  ProviderAuthorization,
  ProviderReconciliation
} from "./provider.js";
import { IntegrationProviderError, type IntegrationFailureCode } from "./provider.js";

/** Deterministic contract fake used without any external provider account. */
export class FakeHealthDataProvider implements HealthDataProvider {
  public reconciliation: ProviderReconciliation = { wellness: [], activities: [] };
  public nextFailure: IntegrationFailureCode | null = null;
  public disconnectedTokens: string[] = [];

  public authorizationUrl(state: string): string {
    return `https://provider.invalid/oauth/authorize?state=${encodeURIComponent(state)}`;
  }

  public async exchangeAuthorizationCode(code: string): Promise<ProviderAuthorization> {
    this.failIfRequested();
    if (code === "denied") throw new IntegrationProviderError("authorization_required");
    return { accessToken: `fake-token-${code}`, externalUserId: "fake-athlete" };
  }

  public async reconcile(): Promise<ProviderReconciliation> {
    this.failIfRequested();
    return this.reconciliation;
  }

  public async disconnect(accessToken: string): Promise<void> {
    this.failIfRequested();
    this.disconnectedTokens.push(accessToken);
  }

  private failIfRequested(): void {
    const failure = this.nextFailure;
    this.nextFailure = null;
    if (failure) throw new IntegrationProviderError(failure);
  }
}
