import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// env.js is optional-gated on GEMINI_API_KEY; set it before the service (which
// statically imports env.js) is ever loaded in this file's isolated module graph.
process.env.GEMINI_API_KEY = 'test-gemini-key';

let parseReceiptImage: typeof import('../services/geminiReceiptService.js').parseReceiptImage;
let isReceiptParsingEnabled: typeof import('../services/geminiReceiptService.js').isReceiptParsingEnabled;

beforeAll(async () => {
  const mod = await import('../services/geminiReceiptService.js');
  parseReceiptImage = mod.parseReceiptImage;
  isReceiptParsingEnabled = mod.isReceiptParsingEnabled;
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

// Retries use a random jitter delay via setTimeout; fake timers let tests resolve
// instantly instead of waiting on real (up to ~1.2s per retry) delays.
async function runWithFakeTimers<T>(promiseFactory: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  const promise = promiseFactory();
  // Attach a no-op handler immediately so Node doesn't flag the promise as an
  // unhandled rejection while timers are being advanced below — the caller's own
  // `await`/`.rejects` assertion still observes the same rejection normally.
  promise.catch(() => {});
  await vi.advanceTimersByTimeAsync(10000);
  return promise;
}

function geminiResponse(obj: unknown): Response {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }],
    }),
  } as Response;
}

describe('isReceiptParsingEnabled', () => {
  it('returns true when GEMINI_API_KEY is set', () => {
    expect(isReceiptParsingEnabled()).toBe(true);
  });
});

describe('parseReceiptImage', () => {
  it('parses a well-formed Gemini response into cents', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      geminiResponse({
        store_name: 'Rewe',
        date: '2026-06-30',
        line_items: [{ name: 'Milch', quantity: 2, price: 2.58 }],
        subtotal: 2.58,
        grand_total: 2.58,
      }),
    );

    const result = await parseReceiptImage('base64data', 'image/jpeg');
    expect(result).toEqual({
      storeName: 'Rewe',
      date: '2026-06-30',
      lineItems: [{ name: 'Milch', quantity: 2, priceCents: 258 }],
      subtotalCents: 258,
      grandTotalCents: 258,
    });
  });

  it('sends responseSchema structured output and inlineData in the request body', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      geminiResponse({
        store_name: 'X',
        line_items: [{ name: 'A', quantity: 1, price: 1 }],
        grand_total: 1,
      }),
    );

    await parseReceiptImage('abc123', 'image/png');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-3.5-flash');
    const body = JSON.parse(options.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeDefined();
    expect(body.contents[0].parts[1].inlineData).toEqual({
      mimeType: 'image/png',
      data: 'abc123',
    });
  });

  it('throws 422 when Gemini returns non-JSON text', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] }),
    } as Response);

    await expect(parseReceiptImage('x', 'image/jpeg')).rejects.toMatchObject({ status: 422 });
  });

  it('throws 422 when Gemini JSON fails schema validation', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(geminiResponse({ foo: 'bar' }));
    await expect(parseReceiptImage('x', 'image/jpeg')).rejects.toMatchObject({ status: 422 });
  });

  it('retries the primary model up to 3 times before falling back, with jitter delays between attempts', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        geminiResponse({
          store_name: 'Rewe',
          line_items: [{ name: 'Milch', quantity: 1, price: 1 }],
          grand_total: 1,
        }),
      );

    const result = await runWithFakeTimers(() => parseReceiptImage('x', 'image/jpeg'));

    expect(result.storeName).toBe('Rewe');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    // First 3 calls retried the primary model; the 4th fell back to the secondary.
    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[0]).toContain('gemini-3.5-flash');
    expect((fetchSpy.mock.calls[1] as [string, RequestInit])[0]).toContain('gemini-3.5-flash');
    expect((fetchSpy.mock.calls[2] as [string, RequestInit])[0]).toContain('gemini-3.5-flash');
    expect((fetchSpy.mock.calls[3] as [string, RequestInit])[0]).toContain('gemini-2.5-flash');
  });

  it('succeeds on a retry without falling back to the secondary model', async () => {
    const fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        geminiResponse({
          store_name: 'Rewe',
          line_items: [{ name: 'Milch', quantity: 1, price: 1 }],
          grand_total: 1,
        }),
      );

    const result = await runWithFakeTimers(() => parseReceiptImage('x', 'image/jpeg'));

    expect(result.storeName).toBe('Rewe');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect((fetchSpy.mock.calls[0] as [string, RequestInit])[0]).toContain('gemini-3.5-flash');
    expect((fetchSpy.mock.calls[1] as [string, RequestInit])[0]).toContain('gemini-3.5-flash');
  });

  it('throws 503 when the primary model (after retries) and the fallback both fail', async () => {
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    await expect(
      runWithFakeTimers(() => parseReceiptImage('x', 'image/jpeg')),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('reports progress for each retry and the fallback attempt', async () => {
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        geminiResponse({
          store_name: 'Rewe',
          line_items: [{ name: 'Milch', quantity: 1, price: 1 }],
          grand_total: 1,
        }),
      );

    const onProgress = vi.fn();
    await runWithFakeTimers(() => parseReceiptImage('x', 'image/jpeg', onProgress));

    expect(onProgress.mock.calls.map((call) => call[0])).toEqual([
      { model: 'primary', attempt: 1, attempts: 3 },
      { model: 'primary', attempt: 2, attempts: 3 },
      { model: 'primary', attempt: 3, attempts: 3 },
    ]);
  });

  it('reports a secondary-model progress event when falling back', async () => {
    vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(
        geminiResponse({
          store_name: 'Rewe',
          line_items: [{ name: 'Milch', quantity: 1, price: 1 }],
          grand_total: 1,
        }),
      );

    const onProgress = vi.fn();
    await runWithFakeTimers(() => parseReceiptImage('x', 'image/jpeg', onProgress));

    expect(onProgress).toHaveBeenLastCalledWith({ model: 'secondary', attempt: 1, attempts: 1 });
  });
});
