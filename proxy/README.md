# CUA Proxy Server

A Cloudflare Worker that acts as a free-tier API proxy for Computer Use Agent.

## Why

Users can run `npx cua` and it **just works** — no API key needed. The proxy holds the OpenRouter key server-side. Rate-limited to prevent abuse.

## Setup

```bash
cd proxy
npm install -g wrangler
wrangler login

# Create KV namespace for rate limiting
wrangler kv:namespace create "RATE_LIMIT_KV"
# Update wrangler.toml with the returned ID

# Set your API key (secret, never in code)
wrangler secret put OPENROUTER_API_KEY

# Deploy
wrangler deploy
```

## How it works

```
User (no key)  →  Cloudflare Worker  →  OpenRouter API
                     ↑
                  Rate limit per IP (30 req/hr)
                  Only free models allowed
                  Max 4096 tokens/request
```

## Cost

OpenRouter free models cost **$0**. The Cloudflare Worker free tier handles 100K requests/day. Your only cost is the domain if you want a custom one.

## Rate Limits

| Tier    | Requests/hour | Max tokens | Models           |
| ------- | ------------- | ---------- | ---------------- |
| Default | 30            | 4096       | Free models only |

Adjust in `wrangler.toml` env vars.
