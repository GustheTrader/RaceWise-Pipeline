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

const validateSchema = (value: any, schema: any, path = "$"): string[] => {
  const errors: string[] = [];
  const type = schema?.type;
  const valid = type === "object"
    ? value !== null && typeof value === "object" && !Array.isArray(value)
    : type === "array"
      ? Array.isArray(value)
      : type === "string"
        ? typeof value === "string"
        : type === "integer"
          ? Number.isInteger(value)
          : type === "number"
            ? typeof value === "number" && Number.isFinite(value)
            : true;

  if (!valid) return [`${path} must be ${type || "valid"}`];

  if (type === "object") {
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) errors.push(`${path}.${key} is required`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) errors.push(...validateSchema(value[key], childSchema, `${path}.${key}`));
    }
  }

  if (type === "array") {
    value.forEach((item: any, index: number) => {
      errors.push(...validateSchema(item, schema.items, `${path}[${index}]`));
    });
  }

  return errors;
};

const isRetryable = (error: any) => [429, 500, 502, 503].includes(error?.status)
  || error?.name === "TimeoutError"
  || error?.name === "AbortError";

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
  const model = process.env.CHEAPERINFERENCE_MODEL || "gemini-3.1-flash-lite";
  const jsonSchema = toJsonSchema(schema);
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: `Return only a valid JSON object matching this schema. Ground extracted facts in the supplied document or text. Never invent horse names, entries, odds, weights, jockeys, trainers, dates, or past performances. Leave unsupported fields empty or omit them, except ensemble scores explicitly requested by the task.\n${JSON.stringify(jsonSchema)}`
      },
      { role: "user", content }
    ],
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    temperature: 0.1
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000)
      });

      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1200).replaceAll(apiKey, "[redacted]");
        console.error("CheaperInference request rejected", response.status, detail);
        const error: any = new Error(`CheaperInference request failed with HTTP ${response.status}`);
        error.status = response.status;
        throw error;
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

      const errors = validateSchema(parsed, jsonSchema);
      if (errors.length) {
        throw new Error(`CheaperInference response does not match the card schema: ${errors.slice(0, 8).join("; ")}`);
      }

      return parsed as PipelineResult;
    } catch (error: any) {
      if (attempt === 1 || !isRetryable(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }

  throw new Error("CheaperInference request failed after retries");
};
