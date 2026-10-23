import type { PipelineResult } from "../types";

interface ParseRequest {
  text?: string;
  pdfData?: {
    data: string;
    mimeType: string;
  };
}

const toJsonSchema = (schema: any): any => {
  if (Array.isArray(schema)) return schema.map(toJsonSchema);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(Object.entries(schema).map(([key, value]) => [
    key,
    key === "type" && typeof value === "string" ? value.toLowerCase() : toJsonSchema(value)
  ]));
};

export const generateCheaperInferenceJSON = async (
  prompt: string,
  request: ParseRequest,
  schema: unknown,
  maxTokens: number
): Promise<PipelineResult> => {
  const apiKey = process.env.CHEAPERINFERENCE_API_KEY;
  if (!apiKey) throw new Error("CHEAPERINFERENCE_API_KEY is not set on the server");

  const content: any[] = [{ type: "text", text: prompt }];
  if (request.text?.trim()) content.push({ type: "text", text: request.text });
  if (request.pdfData) {
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${request.pdfData.mimeType || "application/pdf"};base64,${request.pdfData.data}`
      }
    });
  }

  const baseUrl = (process.env.CHEAPERINFERENCE_BASE_URL || "https://api.cheaperinference.com/v1").replace(/\/+$/, "");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.CHEAPERINFERENCE_MODEL || "gemini-3.1-flash-lite",
      messages: [
        {
          role: "system",
          content: `Return only a valid JSON object matching this schema. Ground extracted facts in the supplied document or text. Never invent horse names, entries, odds, weights, jockeys, trainers, dates, or past performances. Leave unsupported fields empty or omit them, except ensemble scores explicitly requested by the task.\n${JSON.stringify(toJsonSchema(schema))}`
        },
        { role: "user", content }
      ],
      response_format: { type: "json_object" },
      max_tokens: maxTokens,
      temperature: 0.1
    }),
    signal: AbortSignal.timeout(260_000)
  });

  if (!response.ok) {
    throw new Error(`CheaperInference request failed with HTTP ${response.status}`);
  }

  const result = await response.json() as any;
  const output = result?.choices?.[0]?.message?.content;
  if (typeof output !== "string" || !output.trim()) {
    throw new Error("CheaperInference returned no JSON content");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("CheaperInference returned invalid JSON");
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.races)) {
    throw new Error("CheaperInference response is missing the races array");
  }

  return parsed as PipelineResult;
};
