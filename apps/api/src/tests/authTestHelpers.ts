export interface TestTokenPayload {
  sub: string;
  email: string;
  name?: string;
}

// Tests can't mint a real Supabase JWT (no access to its signing key), so
// `authService.verifyToken` is mocked per test file to decode this format
// instead of verifying a real signature. See the `vi.mock('../services/authService.js', ...)`
// call near the top of each test file.
export function createTestToken(payload: TestTokenPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
