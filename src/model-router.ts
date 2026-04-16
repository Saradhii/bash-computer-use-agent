import type { TrustTier } from './types.js';
import { PROVIDERS, type ProviderConfig } from './config.js';

const SIMPLE_PATTERNS = [
  /^(ls|pwd|cat|head|tail|wc|whoami|date|uname|id|echo|which|whereis|file|df|du|ps|uptime|env|hostname)\b/i,
  /^(show|list|print|display|what|where|which|how many|count)\b/i,
];

const COMPLEX_PATTERNS = [
  /\b(create|build|write|implement|develop|refactor|debug|fix|deploy|configure|setup|install|migrate|analyze|design|architect)\b/i,
  /\b(multi|multiple|all|every|each|entire|full|complete|comprehensive)\b/i,
  /\b(script|program|application|project|pipeline|workflow|system|service|module|component)\b/i,
];

export interface ModelRouterConfig {
  primaryModel: string;
  fallbackModel: string;
}

export class ModelRouter {
  private readonly _config: ModelRouterConfig;

  constructor(config: ModelRouterConfig) {
    this._config = config;
  }

  route(input: string): string {
    const trimmed = input.trim();

    if (this._isSimple(trimmed)) {
      return this._config.fallbackModel;
    }

    if (this._isComplex(trimmed)) {
      return this._config.primaryModel;
    }

    if (trimmed.length < 50) {
      return this._config.fallbackModel;
    }

    if (trimmed.length > 200) {
      return this._config.primaryModel;
    }

    return this._config.primaryModel;
  }

  private _isSimple(input: string): boolean {
    return SIMPLE_PATTERNS.some((pattern) => pattern.test(input));
  }

  private _isComplex(input: string): boolean {
    return COMPLEX_PATTERNS.some((pattern) => pattern.test(input));
  }

  static resolveModelSelection(
    modelFlag: string | undefined,
    providers: readonly ProviderConfig[],
  ): { modelId: string; router: ModelRouter | null } {
    if (!modelFlag || modelFlag !== 'auto') {
      return { modelId: modelFlag ?? '', router: null };
    }

    const openrouter = providers.find((p) => p.name.toLowerCase().includes('openrouter'));

    if (!openrouter || openrouter.models.length < 2) {
      const provider = openrouter ?? providers[0];
      const model = provider?.models[0];
      return { modelId: model?.id ?? '', router: null };
    }

    const primary = openrouter.models.find((m) => m.recommended) ?? openrouter.models[0];
    const fallback = openrouter.models.find((m) => !m.recommended) ?? openrouter.models[0];

    if (!primary || !fallback) {
      return { modelId: primary?.id ?? '', router: null };
    }

    return {
      modelId: primary.id,
      router: new ModelRouter({
        primaryModel: primary.id,
        fallbackModel: fallback.id,
      }),
    };
  }
}
