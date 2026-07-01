import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/requireAuth', () => ({
  requireAuth: vi
    .fn()
    .mockResolvedValue({ id: 'u1', email: 'a@test.com', name: 'Alice', defaultMarkupRate: 0 }),
}));

const apiGetMock = vi.fn();
vi.mock('../lib/apiClient', () => ({
  api: { get: (...args: unknown[]) => apiGetMock(...args) },
  ApiError: class ApiError extends Error {},
  postFileStream: vi.fn(),
}));

import { clientLoader } from './groups.$groupId_.receipt';

// Regression test: the loader used to read `expenseId` from `window.location.search`,
// but React Router runs a route's clientLoader *before* the browser's address bar
// necessarily reflects the destination URL — so window.location could still be the
// previous page's URL while the loader for the new page is already running. That
// silently dropped `expenseId`, sending "Edit line items" to the upload screen
// instead of the review screen. The fix reads `request.url` instead, which is always
// the URL being navigated to, regardless of when window.location catches up.
describe('groups.$groupId_.receipt clientLoader', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockImplementation((path: string) => {
      if (path.includes('/expenses/')) {
        return Promise.resolve({ id: 'e1', lineItems: [{ name: 'Pizza' }] });
      }
      return Promise.resolve({ id: 'g1', name: 'Trip', currency: 'EUR', members: [] });
    });
    // Simulate the browser still being on a different page while the destination
    // route's loader (carrying expenseId in its own request URL) is already running.
    window.history.pushState({}, '', '/groups/g1/expenses/e1/edit');
  });

  it('reads expenseId from the loader request URL, not window.location', async () => {
    const request = new Request('http://localhost/groups/g1/receipt?expenseId=e1');
    const result = await clientLoader({
      params: { groupId: 'g1' },
      request,
    } as Parameters<typeof clientLoader>[0]);

    expect(apiGetMock).toHaveBeenCalledWith('/api/groups/g1/expenses/e1');
    expect(result.expense).not.toBeNull();
  });

  it('does not fetch an expense when expenseId is absent from the request URL', async () => {
    const request = new Request('http://localhost/groups/g1/receipt');
    const result = await clientLoader({
      params: { groupId: 'g1' },
      request,
    } as Parameters<typeof clientLoader>[0]);

    expect(apiGetMock).not.toHaveBeenCalledWith(expect.stringContaining('/expenses/'));
    expect(result.expense).toBeNull();
  });
});
