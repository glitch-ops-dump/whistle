import { buildWhistleApi } from "../server/app.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`PASS ${message}`);
}

const adminHeaders = {
  "x-whistle-role": "admin",
  "x-whistle-actor": "admin:prototype",
};

function setCookieHeader(response: { headers: Record<string, string | string[] | undefined> }) {
  const value = response.headers["set-cookie"];
  const cookie = Array.isArray(value) ? value[0] : value;
  assert(cookie, "Auth response should set an HttpOnly account-session cookie.");
  assert(cookie.includes("whistle_account_session="), "Auth cookie should use the account-session cookie name.");
  assert(cookie.includes("HttpOnly"), "Auth cookie should be HttpOnly.");
  return cookie.split(";")[0];
}

async function run() {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalLogLevel = process.env.LOG_LEVEL;
  const originalDeploymentProfile = process.env.WHISTLE_DEPLOYMENT_PROFILE;
  const originalWhistleEnv = process.env.WHISTLE_ENV;
  const originalNodeEnv = process.env.NODE_ENV;
  delete process.env.DATABASE_URL;
  process.env.WHISTLE_DEPLOYMENT_PROFILE = "local";
  delete process.env.WHISTLE_ENV;
  delete process.env.NODE_ENV;
  process.env.LOG_LEVEL = "silent";

  const app = buildWhistleApi();
  await app.ready();

  try {
    const config = await app.inject({ method: "GET", url: "/api/auth/config" });
    assert(config.statusCode === 200, `Auth config returned ${config.statusCode}; expected 200. Body: ${config.body}`);
    assert(typeof config.json<{ controls: { citizenOtpRequired: boolean; governmentOtpRequired: boolean } }>().controls.citizenOtpRequired === "boolean", "Auth config should expose the citizen OTP control.");
    pass("auth config exposes citizen and government OTP controls");

    const enableCitizenOtp = await app.inject({
      method: "PATCH",
      url: "/api/admin/config/app-controls/citizen-phone-otp-required",
      headers: adminHeaders,
      payload: { value: true },
    });
    assert(enableCitizenOtp.statusCode === 200, `Enable citizen OTP returned ${enableCitizenOtp.statusCode}; expected 200. Body: ${enableCitizenOtp.body}`);

    const otpStart = await app.inject({
      method: "POST",
      url: "/api/auth/otp/start",
      payload: { phone: "+91 98888 10001", language: "en" },
    });
    assert(otpStart.statusCode === 201, `Auth OTP start returned ${otpStart.statusCode}; expected 201. Body: ${otpStart.body}`);
    const challenge = otpStart.json<{ challenge: { challengeId: string; mockOtp: string } }>().challenge;

    const otpVerify = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { challengeId: challenge.challengeId, otp: challenge.mockOtp },
    });
    assert(otpVerify.statusCode === 200, `Auth OTP verify returned ${otpVerify.statusCode}; expected 200. Body: ${otpVerify.body}`);
    const verification = otpVerify.json<{ verification: { verificationToken: string } }>().verification;

    const register = await app.inject({
      method: "POST",
      url: "/api/auth/citizen/register",
      payload: {
        phone: "+91 98888 10001",
        displayName: "Smoke Citizen",
        password: "Citizen@123",
        phoneVerificationToken: verification.verificationToken,
      },
    });
    assert(register.statusCode === 201, `Citizen register returned ${register.statusCode}; expected 201. Body: ${register.body}`);
    const citizenCookie = setCookieHeader(register);
    const citizenSession = register.json<{ session: { sessionToken?: string; phoneVerificationToken?: string; role: string; phoneMasked: string } }>().session;
    assert(citizenSession.role === "citizen", "Citizen register should create a citizen session.");
    assert(citizenSession.phoneMasked.endsWith("0001"), "Citizen session should return masked phone.");
    assert(!citizenSession.sessionToken, "Citizen register response must not expose the account session token.");
    assert(!citizenSession.phoneVerificationToken, "Citizen register response must not expose the citizen verification token.");
    pass("citizens can create a mobile/password account with OTP when required");

    const noOtpLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        surface: "citizen",
        phone: "+91 98888 10001",
        password: "Citizen@123",
      },
    });
    assert(noOtpLogin.statusCode === 401, `Citizen login without OTP returned ${noOtpLogin.statusCode}; expected 401. Body: ${noOtpLogin.body}`);
    assert(noOtpLogin.json<{ otpRequired?: boolean }>().otpRequired, "Citizen login without OTP should say OTP is required.");
    pass("citizen login honors Admin-mandated OTP");

    const passwordChange = await app.inject({
      method: "POST",
      url: "/api/auth/password/change",
      headers: { cookie: citizenCookie },
      payload: { currentPassword: "Citizen@123", newPassword: "Citizen@456" },
    });
    assert(passwordChange.statusCode === 200, `Password change returned ${passwordChange.statusCode}; expected 200. Body: ${passwordChange.body}`);
    pass("citizens can change password from an authenticated session");

    const resetOtpStart = await app.inject({
      method: "POST",
      url: "/api/auth/otp/start",
      payload: { phone: "+91 98888 10001", language: "en" },
    });
    assert(resetOtpStart.statusCode === 201, `Reset OTP start returned ${resetOtpStart.statusCode}; expected 201. Body: ${resetOtpStart.body}`);
    const resetChallenge = resetOtpStart.json<{ challenge: { challengeId: string; mockOtp: string } }>().challenge;

    const resetOtpVerify = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { challengeId: resetChallenge.challengeId, otp: resetChallenge.mockOtp },
    });
    assert(resetOtpVerify.statusCode === 200, `Reset OTP verify returned ${resetOtpVerify.statusCode}; expected 200. Body: ${resetOtpVerify.body}`);
    const resetVerification = resetOtpVerify.json<{ verification: { verificationToken: string } }>().verification;

    const citizenReset = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset",
      payload: {
        surface: "citizen",
        phone: "+91 98888 10001",
        newPassword: "Citizen@789",
        phoneVerificationToken: resetVerification.verificationToken,
      },
    });
    assert(citizenReset.statusCode === 200, `Citizen password reset returned ${citizenReset.statusCode}; expected 200. Body: ${citizenReset.body}`);

    const citizenOldPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        surface: "citizen",
        phone: "+91 98888 10001",
        password: "Citizen@456",
        phoneVerificationToken: resetVerification.verificationToken,
      },
    });
    assert(citizenOldPassword.statusCode === 401, `Old citizen password login returned ${citizenOldPassword.statusCode}; expected 401. Body: ${citizenOldPassword.body}`);
    pass("citizen password reset requires verified mobile ownership and replaces the old password");

    const governmentLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        surface: "government",
        phone: "+91 90000 21001",
        password: "Whistle@123",
        role: "cm_cell",
      },
    });
    assert(governmentLogin.statusCode === 200, `Government login returned ${governmentLogin.statusCode}; expected 200. Body: ${governmentLogin.body}`);
    const governmentCookie = setCookieHeader(governmentLogin);
    const governmentSession = governmentLogin.json<{ session: { sessionToken?: string; actor: string; role: string; officialBearerToken?: string } }>().session;
    assert(governmentSession.actor === "cm_cell:prototype", "Government login should map to the seeded CM Cell actor.");
    assert(governmentSession.role === "cm_cell", "Government login should keep the requested role.");
    assert(!governmentSession.sessionToken, "Government login response must not expose the account session token.");
    assert(!governmentSession.officialBearerToken, "Government login response must not expose a local-UAT official bearer token.");
    pass("government users can login with mobile number and password");

    const sessionDashboard = await app.inject({
      method: "GET",
      url: "/api/dashboard?role=cm_cell&ticketLimit=1",
      headers: {
        cookie: governmentCookie,
        "x-whistle-role": "cm_cell",
        "x-whistle-actor": "cm_cell:prototype",
      },
    });
    assert(sessionDashboard.statusCode === 200, `Session dashboard returned ${sessionDashboard.statusCode}; expected 200. Body: ${sessionDashboard.body}`);
    pass("government mobile/password sessions authorize role-scoped API reads");

    const wrongRole = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        surface: "government",
        phone: "+91 90000 21001",
        password: "Whistle@123",
        role: "minister",
      },
    });
    assert(wrongRole.statusCode === 403, `Wrong-role login returned ${wrongRole.statusCode}; expected 403. Body: ${wrongRole.body}`);
    pass("government login rejects roles not granted to the mobile account");

    const govResetOtpStart = await app.inject({
      method: "POST",
      url: "/api/auth/otp/start",
      payload: { phone: "+91 90000 21001", language: "en" },
    });
    assert(govResetOtpStart.statusCode === 201, `Government reset OTP start returned ${govResetOtpStart.statusCode}; expected 201. Body: ${govResetOtpStart.body}`);
    const govResetChallenge = govResetOtpStart.json<{ challenge: { challengeId: string; mockOtp: string } }>().challenge;

    const govResetOtpVerify = await app.inject({
      method: "POST",
      url: "/api/auth/otp/verify",
      payload: { challengeId: govResetChallenge.challengeId, otp: govResetChallenge.mockOtp },
    });
    assert(govResetOtpVerify.statusCode === 200, `Government reset OTP verify returned ${govResetOtpVerify.statusCode}; expected 200. Body: ${govResetOtpVerify.body}`);
    const govResetVerification = govResetOtpVerify.json<{ verification: { verificationToken: string } }>().verification;

    const governmentReset = await app.inject({
      method: "POST",
      url: "/api/auth/password/reset",
      payload: {
        surface: "government",
        phone: "+91 90000 21001",
        newPassword: "Whistle@456",
        phoneVerificationToken: govResetVerification.verificationToken,
      },
    });
    assert(governmentReset.statusCode === 200, `Government password reset returned ${governmentReset.statusCode}; expected 200. Body: ${governmentReset.body}`);

    const governmentNewPasswordLogin = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        surface: "government",
        phone: "+91 90000 21001",
        password: "Whistle@456",
        role: "cm_cell",
      },
    });
    assert(governmentNewPasswordLogin.statusCode === 200, `Government new-password login returned ${governmentNewPasswordLogin.statusCode}; expected 200. Body: ${governmentNewPasswordLogin.body}`);
    pass("government users can reset passwords through verified mobile ownership");
  } finally {
    await app.close();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalLogLevel === undefined) delete process.env.LOG_LEVEL;
    else process.env.LOG_LEVEL = originalLogLevel;
    if (originalDeploymentProfile === undefined) delete process.env.WHISTLE_DEPLOYMENT_PROFILE;
    else process.env.WHISTLE_DEPLOYMENT_PROFILE = originalDeploymentProfile;
    if (originalWhistleEnv === undefined) delete process.env.WHISTLE_ENV;
    else process.env.WHISTLE_ENV = originalWhistleEnv;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  }
}

await run();
