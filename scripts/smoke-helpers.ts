type InjectableApp = {
  inject(options: {
    method: "GET" | "POST" | "PATCH";
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<{
    statusCode: number;
    body: string;
    json<T>(): T;
  }>;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export async function withVerifiedPhone<T extends Record<string, unknown>>(app: InjectableApp, payload: T): Promise<T & { phoneVerificationToken: string }> {
  const phone = String(payload.phone ?? "");
  assert(phone.length >= 10, "Smoke ticket payload needs a phone number before mock OTP verification.");

  const start = await app.inject({
    method: "POST",
    url: "/api/citizen/otp/start",
    payload: {
      phone,
      language: payload.language === "ta" ? "ta" : "en",
    },
  });
  assert(start.statusCode === 201, `OTP start returned ${start.statusCode}; expected 201. Body: ${start.body}`);
  const challenge = start.json<{ challenge: { challengeId: string; mockOtp: string } }>().challenge;

  const verify = await app.inject({
    method: "POST",
    url: "/api/citizen/otp/verify",
    payload: {
      challengeId: challenge.challengeId,
      otp: challenge.mockOtp,
    },
  });
  assert(verify.statusCode === 200, `OTP verify returned ${verify.statusCode}; expected 200. Body: ${verify.body}`);
  const verification = verify.json<{ verification: { verificationToken: string } }>().verification;

  return {
    ...payload,
    phoneVerificationToken: verification.verificationToken,
  };
}
