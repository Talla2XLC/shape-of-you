import { AsyncLocalStorage } from "node:async_hooks";

interface OAuthRequestState {
  readonly resumeIdentifier: string;
}

/** Carries the exact provider resume identifier through an authorization request. */
export class OAuthRequestContext {
  private readonly storage = new AsyncLocalStorage<OAuthRequestState>();

  /** Runs provider work with the interaction that authorized session binding. */
  public run<T>(resumeIdentifier: string, callback: () => T): T {
    return this.storage.run({ resumeIdentifier }, callback);
  }

  /** Returns the active authorization resume identifier when one is present. */
  public getResumeIdentifier(): string | undefined {
    return this.storage.getStore()?.resumeIdentifier;
  }

  /** Returns the active provider resume identifier or fails closed outside that request. */
  public requireResumeIdentifier(): string {
    const value = this.getResumeIdentifier();
    if (!value) {
      throw new Error("OAuth provider session write is not bound to an authorization resume");
    }
    return value;
  }
}
