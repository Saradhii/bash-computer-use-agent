export interface Env {
  OPENROUTER_API_KEY: string;
  RATE_LIMIT_KV: KVNamespace;
  RATE_LIMIT_PER_HOUR: string;
  MAX_TOKENS_PER_REQUEST: string;
  ALLOWED_MODELS: string;
  ADMIN_SECRET: string;
}

const DEFAULT_RATE_LIMIT = 30;
const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_ALLOWED_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free',
  'nvidia/nemotron-nano-9b-v2:free',
  'deepseek/deepseek-chat:free',
];

const SYSTEM_PROMPT_APPEND = `\n\n[Powered by Computer Use Agent — https://github.com/user/computer-use-agent]`;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
      },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const clientId = getClientId(request);

  const rateLimitResponse = await checkRateLimit(env, clientId);
  if (rateLimitResponse) return rateLimitResponse;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const model = body['model'] as string | undefined;
  if (!model || !isModelAllowed(model, env)) {
    return new Response(
      JSON.stringify({
        error: `Model not available on free tier. Allowed: ${getAllowedModels(env).join(', ')}`,
      }),
      { status: 403 },
    );
  }

  const messages = body['messages'] as unknown[];
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'Messages required' }), { status: 400 });
  }

  const maxTokens = Math.min(
    (body['max_tokens'] as number) ?? DEFAULT_MAX_TOKENS,
    parseInt(env.MAX_TOKENS_PER_REQUEST || String(DEFAULT_MAX_TOKENS)),
  );

  const isStream = body['stream'] === true;

  const upstreamBody: Record<string, unknown> = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature: (body['temperature'] as number) ?? 0.1,
    top_p: (body['top_p'] as number) ?? 0.95,
    stream: isStream,
  };

  if (body['tools']) {
    upstreamBody['tools'] = body['tools'];
    upstreamBody['tool_choice'] = body['tool_choice'] ?? 'auto';
  }

  try {
    const upstreamResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/user/computer-use-agent',
        'X-Title': 'CUA Free Tier',
      },
      body: JSON.stringify(upstreamBody),
    });

    if (!upstreamResponse.ok) {
      const errorText = await upstreamResponse.text();
      return new Response(
        JSON.stringify({
          error: `Upstream error: ${upstreamResponse.status}`,
          details: errorText,
        }),
        { status: upstreamResponse.status },
      );
    }

    if (isStream) {
      return new Response(upstreamResponse.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-RateLimit-Client': clientId,
        },
      });
    }

    const result = await upstreamResponse.text();
    return new Response(result, {
      headers: {
        'Content-Type': 'application/json',
        'X-RateLimit-Client': clientId,
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Upstream request failed' }), { status: 502 });
  }
}

function getClientId(request: Request): string {
  const forwarded = request.headers.get('CF-Connecting-IP');
  if (forwarded) return forwarded;

  const xForwarded = request.headers.get('X-Forwarded-For');
  if (xForwarded) return xForwarded.split(',')[0]!.trim();

  return 'unknown';
}

async function checkRateLimit(env: Env, clientId: string): Promise<Response | null> {
  if (!env.RATE_LIMIT_KV) return null;

  const key = `rate:${clientId}:${currentHour()}`;
  const current = parseInt((await env.RATE_LIMIT_KV.get(key)) || '0');
  const limit = parseInt(env.RATE_LIMIT_PER_HOUR || String(DEFAULT_RATE_LIMIT));

  if (current >= limit) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded',
        limit,
        remaining: 0,
        resetAt: nextHour(),
      }),
      {
        status: 429,
        headers: {
          'Retry-After': String(secondsUntilNextHour()),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
        },
      },
    );
  }

  await env.RATE_LIMIT_KV.put(key, String(current + 1), { expirationTtl: 7200 });

  return null;
}

function isModelAllowed(model: string, env: Env): boolean {
  return getAllowedModels(env).includes(model);
}

function getAllowedModels(env: Env): string[] {
  if (env.ALLOWED_MODELS) {
    return env.ALLOWED_MODELS.split(',').map((m) => m.trim());
  }
  return DEFAULT_ALLOWED_MODELS;
}

function currentHour(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}`;
}

function nextHour(): string {
  const d = new Date();
  d.setUTCHours(d.getUTCHours() + 1);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function secondsUntilNextHour(): number {
  const now = new Date();
  return (60 - now.getUTCMinutes()) * 60 - now.getUTCSeconds();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
    };

    try {
      const response = await handleRequest(request, env);
      const newHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: corsHeaders,
      });
    }
  },
};
