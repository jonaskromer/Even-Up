import { geminiReceiptResultSchema } from '@evenup/shared';
import { env } from '../env.js';
import { HttpError } from '../lib/HttpError.js';

const RECEIPT_PROMPT = `You are a specialized financial document OCR parser. Your single task is to analyze the provided image of a receipt/invoice and extract its content into a highly accurate, structured JSON format optimized for an expense-splitting application.

### Extraction Rules:

1. STORE NAME: Extract the merchant/store name as printed on the receipt. Convert it from ALL CAPS to Clean Title Case if needed (e.g. "REWE MARKT" -> "Rewe Markt").

2. RECEIPT DATE: If a purchase date is printed on the receipt and is legible, extract it as an ISO date string (YYYY-MM-DD). If no date is legible, omit the field entirely — do not guess.

3. LINE ITEMS: Extract every individual line item. Strip out standard quantity numbers or units from the beginning of text lines (e.g., convert "2x Burger" or "2 24 FL Fritz Cola" to name: "Fritz Cola...", quantity: 2).

4. NET VS. GROSS AUDIT (CRITICAL): Check if the listed line-item prices are Net (excluding tax/MwSt) or Gross (including tax). Cross-reference the sum of the line items against the final payable amount.
   - If the receipt lists NET prices, you must identify the tax rate (e.g., 7%, 19%) applied to each specific item (using the tax column or the breakdown table at the bottom).
   - Dynamically calculate and save the Gross Total Price (Net Price + Tax Amount) for that line item into the \`price\` field. The \`price\` must reflect the actual final cost of that line item to ensure accurate expense splitting.

5. DISCOUNTS: If a line item has a discount applied directly below it, subtract the discount from that item's final price before saving it.

6. CLEAN CASING: Convert ALL CAPS item names into Clean Title Case (e.g., "FARINA CAPUTO 00" -> "Farina Caputo 00"). Retain relevant volume/weight metrics in the name if helpful for identification.

7. METADATA & SIMPLIFIED SCHEMA: Extract only the total sum of the items as \`subtotal\` and the absolute final payable amount as \`grand_total\` (which must include any handwritten tips or manual adjustments written on the receipt). Do not output separate fields for tax or tip.

8. OUTPUT FORMAT: Return ONLY a raw JSON object matching the schema. Do not append any markdown formatting, backticks, or conversational text.`;

// Gemini's structured-output schema (OpenAPI 3.0 subset — uppercase type names).
// Paired with generationConfig.responseMimeType so the model is constrained at decode
// time rather than relying solely on the prompt's "no backticks" instruction.
const RECEIPT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    store_name: { type: 'STRING' },
    date: { type: 'STRING', description: 'ISO date YYYY-MM-DD, omit if not legible' },
    line_items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          quantity: { type: 'NUMBER' },
          price: { type: 'NUMBER' },
        },
        required: ['name', 'quantity', 'price'],
      },
    },
    subtotal: { type: 'NUMBER' },
    grand_total: { type: 'NUMBER' },
  },
  required: ['store_name', 'line_items', 'grand_total'],
};

export interface ParsedReceipt {
  storeName: string;
  date?: string;
  lineItems: { name: string; quantity: number; priceCents: number }[];
  subtotalCents?: number;
  grandTotalCents: number;
}

interface GeminiGenerateContentResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

export function isReceiptParsingEnabled(): boolean {
  return !!env.GEMINI_API_KEY;
}

export async function parseReceiptImage(
  imageBase64: string,
  mimeType: string,
): Promise<ParsedReceipt> {
  if (!env.GEMINI_API_KEY) {
    throw new HttpError(404, 'Beleg-Scan ist auf diesem Server nicht aktiviert.');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;
  const body = {
    contents: [
      {
        parts: [{ text: RECEIPT_PROMPT }, { inlineData: { mimeType, data: imageBase64 } }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RECEIPT_RESPONSE_SCHEMA,
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HttpError(503, 'Beleg konnte nicht analysiert werden (Netzwerkfehler).');
  }

  if (!res.ok) {
    throw new HttpError(503, 'Beleg konnte nicht analysiert werden.');
  }

  const json = (await res.json()) as GeminiGenerateContentResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new HttpError(422, 'Beleg konnte nicht ausgelesen werden.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(422, 'Beleg konnte nicht ausgelesen werden.');
  }

  const result = geminiReceiptResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new HttpError(422, 'Beleg-Daten unvollständig oder ungültig.');
  }

  const { store_name, date, line_items, subtotal, grand_total } = result.data;
  return {
    storeName: store_name,
    date,
    lineItems: line_items.map((item) => ({
      name: item.name,
      quantity: item.quantity,
      priceCents: Math.round(item.price * 100),
    })),
    subtotalCents: subtotal != null ? Math.round(subtotal * 100) : undefined,
    grandTotalCents: Math.round(grand_total * 100),
  };
}
