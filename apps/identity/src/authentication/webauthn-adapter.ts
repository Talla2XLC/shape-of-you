import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON
} from "@simplewebauthn/server";

/** Transport values persisted by the existing Identity PostgreSQL enum. */
export type DatabaseWebAuthnTransport =
  | "ble"
  | "cable"
  | "hybrid"
  | "internal"
  | "nfc"
  | "smart_card"
  | "usb";

/** Maps a WebAuthn transport value to the stable database representation. */
export function toDatabaseWebAuthnTransport(
  value: AuthenticatorTransportFuture
): DatabaseWebAuthnTransport {
  return value === "smart-card" ? "smart_card" : value;
}

/** Maps the stable database transport value back to the WebAuthn contract. */
export function toExternalWebAuthnTransport(
  value: DatabaseWebAuthnTransport
): AuthenticatorTransportFuture {
  return value === "smart_card" ? "smart-card" : value;
}

/** Persisted passkey material required to verify an assertion. */
export interface StoredPasskey {
  readonly credentialId: Buffer;
  readonly publicKey: Buffer;
  readonly counter: number;
  readonly deviceType: "single_device" | "multi_device";
  readonly backedUp: boolean;
  readonly transports: readonly DatabaseWebAuthnTransport[];
}

/** Verified credential material returned after passkey enrollment. */
export interface VerifiedPasskeyRegistration {
  readonly credentialId: Buffer;
  readonly publicKey: Buffer;
  readonly counter: number;
  readonly deviceType: "single_device" | "multi_device";
  readonly backedUp: boolean;
  readonly transports: readonly DatabaseWebAuthnTransport[];
}

/** Verified assertion state returned after passkey authentication. */
export interface VerifiedPasskeyAuthentication {
  readonly counter: number;
  readonly backedUp: boolean;
}

/** Replaceable project boundary around the pinned WebAuthn implementation. */
export interface WebAuthnAdapter {
  createRegistrationOptions(input: {
    readonly rpId: string;
    readonly rpName: string;
    readonly userHandle: Buffer;
    readonly userName: string;
    readonly displayName: string;
    readonly excludedCredentialIds: readonly Buffer[];
  }): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(input: {
    readonly response: RegistrationResponseJSON;
    readonly expectedChallenge: (challenge: string) => boolean;
    readonly expectedOrigin: string;
    readonly expectedRpId: string;
  }): Promise<VerifiedPasskeyRegistration>;
  createAuthenticationOptions(input: {
    readonly rpId: string;
  }): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(input: {
    readonly response: AuthenticationResponseJSON;
    readonly expectedChallenge: (challenge: string) => boolean;
    readonly expectedOrigin: string;
    readonly expectedRpId: string;
    readonly credential: StoredPasskey;
  }): Promise<VerifiedPasskeyAuthentication>;
}

/** Production WebAuthn adapter backed by the pinned SimpleWebAuthn package. */
export class SimpleWebAuthnAdapter implements WebAuthnAdapter {
  async createRegistrationOptions(
    input: Parameters<WebAuthnAdapter["createRegistrationOptions"]>[0]
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpID: input.rpId,
      rpName: input.rpName,
      userID: Uint8Array.from(input.userHandle),
      userName: input.userName,
      userDisplayName: input.displayName,
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "required"
      },
      excludeCredentials: input.excludedCredentialIds.map((id) => ({
        id: id.toString("base64url")
      }))
    });
  }

  async verifyRegistration(
    input: Parameters<WebAuthnAdapter["verifyRegistration"]>[0]
  ): Promise<VerifiedPasskeyRegistration> {
    const result = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRpId,
      requireUserPresence: true,
      requireUserVerification: true
    });
    if (!result.verified || !result.registrationInfo) {
      throw new Error("WebAuthn registration verification failed");
    }
    const { credential, credentialBackedUp, credentialDeviceType } =
      result.registrationInfo;
    return {
      credentialId: Buffer.from(credential.id, "base64url"),
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter,
      deviceType:
        credentialDeviceType === "singleDevice"
          ? "single_device"
          : "multi_device",
      backedUp: credentialBackedUp,
      transports: (credential.transports ?? []).map(toDatabaseWebAuthnTransport)
    };
  }

  async createAuthenticationOptions(
    input: Parameters<WebAuthnAdapter["createAuthenticationOptions"]>[0]
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: input.rpId,
      userVerification: "required"
    });
  }

  async verifyAuthentication(
    input: Parameters<WebAuthnAdapter["verifyAuthentication"]>[0]
  ): Promise<VerifiedPasskeyAuthentication> {
    const result = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: input.expectedChallenge,
      expectedOrigin: input.expectedOrigin,
      expectedRPID: input.expectedRpId,
      requireUserVerification: true,
      credential: {
        id: input.credential.credentialId.toString("base64url"),
        publicKey: Uint8Array.from(input.credential.publicKey),
        counter:
          input.credential.deviceType === "multi_device"
            ? 0
            : input.credential.counter,
        transports: input.credential.transports.map(toExternalWebAuthnTransport)
      }
    });
    if (!result.verified) {
      throw new Error("WebAuthn authentication verification failed");
    }
    return {
      counter: Math.max(input.credential.counter, result.authenticationInfo.newCounter),
      backedUp: result.authenticationInfo.credentialBackedUp
    };
  }
}
