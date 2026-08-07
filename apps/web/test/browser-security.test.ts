import { describe, expect, it, vi } from "vitest";

import {
  consumeEnrollmentFragment,
  identityRedirectTarget,
  identityRoute,
  readIdentityCsrfCookie
} from "../app/lib/browser-security";

describe("browser security helpers", () => {
  it("removes a valid enrollment fragment before returning the bearer", () => {
    const replaceUrl = vi.fn();
    const token = "A".repeat(43);

    expect(
      consumeEnrollmentFragment({
        hash: `#${token}`,
        pathname: "/enroll",
        search: "",
        replaceUrl
      })
    ).toBe(token);
    expect(replaceUrl).toHaveBeenCalledOnce();
    expect(replaceUrl).toHaveBeenCalledWith("/enroll");
    expect(replaceUrl.mock.invocationCallOrder[0]).toBeLessThan(
      Number.POSITIVE_INFINITY
    );
  });

  it("removes malformed fragments and refuses to use them", () => {
    const replaceUrl = vi.fn();
    expect(
      consumeEnrollmentFragment({
        hash: "#token=not-accepted",
        pathname: "/enroll",
        search: "?ignored=true",
        replaceUrl
      })
    ).toBeNull();
    expect(replaceUrl).toHaveBeenCalledWith("/enroll?ignored=true");
  });

  it("reads only the exact CSRF cookie", () => {
    const token = "B".repeat(43);
    expect(
      readIdentityCsrfCookie(
        `other=value; __Host-shape_of_you_csrf=${token}; session=hidden`
      )
    ).toBe(token);
    expect(readIdentityCsrfCookie("__Host-shape_of_you_csrf=short")).toBeNull();
  });

  it("keeps Identity routes and redirects on the configured origin", () => {
    expect(
      identityRoute("https://identity.staging.shape-of-you.ru", "/sign-in")
    ).toBe("https://identity.staging.shape-of-you.ru/sign-in");
    expect(
      identityRedirectTarget(
        "https://identity.staging.shape-of-you.ru",
        `https://staging.shape-of-you.ru/enroll#${"C".repeat(43)}`
      )
    ).toBe(
      `https://identity.staging.shape-of-you.ru/enroll#${"C".repeat(43)}`
    );
    expect(
      identityRedirectTarget(
        "https://identity.staging.shape-of-you.ru",
        "https://identity.staging.shape-of-you.ru/security"
      )
    ).toBeNull();
  });
});
