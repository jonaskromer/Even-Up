import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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

  it('throws 503 on network failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('network down'));
    await expect(parseReceiptImage('x', 'image/jpeg')).rejects.toMatchObject({ status: 503 });
  });

  it('throws 503 when Gemini responds non-ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 500 } as Response);
    await expect(parseReceiptImage('x', 'image/jpeg')).rejects.toMatchObject({ status: 503 });
  });
});
