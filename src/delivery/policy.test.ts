import { describe, expect, it } from "vitest";
import { isPermanentDeliveryFailure } from "./policy.js";

describe("Delivery-failure policy", () => {
  it("treats bot blocked and chat not found as permanent", () => {
    expect(isPermanentDeliveryFailure({ error_code: 403, description: "Forbidden: bot was blocked by the user" })).toBe(
      true,
    );
    expect(
      isPermanentDeliveryFailure({
        error_code: 403,
        description: "Forbidden: user is deactivated",
      }),
    ).toBe(true);
    expect(
      isPermanentDeliveryFailure({
        error_code: 400,
        description: "Bad Request: chat not found",
      }),
    ).toBe(true);
  });

  it("treats rate limits and network-ish errors as transient", () => {
    expect(
      isPermanentDeliveryFailure({
        error_code: 429,
        description: "Too Many Requests: retry after 3",
      }),
    ).toBe(false);
    expect(
      isPermanentDeliveryFailure({
        error_code: 500,
        description: "Internal Server Error",
      }),
    ).toBe(false);
  });
});
