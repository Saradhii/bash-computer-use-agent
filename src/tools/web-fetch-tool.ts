import type { ToolDefinition, ToolSchema, ToolResult } from '../types.js';

const DEFAULT_MAX_LENGTH = 10000;

export class WebFetchTool implements ToolDefinition {
  readonly name = 'web_fetch';
  readonly description =
    'Fetch content from a URL. Returns text content from web pages, API responses, etc.';
  readonly requiresConfirmation = false;

  private _cwd: string;

  constructor(cwd: string) {
    this._cwd = cwd;
  }

  get schema(): ToolSchema {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to fetch',
            },
            format: {
              type: 'string',
              description: 'Response format: "text", "markdown", or "html". Default: "text"',
            },
            maxLength: {
              type: 'number',
              description: `Maximum response length in characters. Default: ${DEFAULT_MAX_LENGTH}`,
            },
          },
          required: ['url'],
        },
      },
    };
  }

  async execute(args: Record<string, unknown>): Promise<ToolResult> {
    const url = args['url'] as string;
    const maxLength = (args['maxLength'] as number) ?? DEFAULT_MAX_LENGTH;

    if (!url) {
      return { content: 'No URL provided', isError: true };
    }

    try {
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { content: `Unsupported protocol: ${parsedUrl.protocol}`, isError: true };
      }
    } catch {
      return { content: `Invalid URL: ${url}`, isError: true };
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'ComputerUseAgent/1.0',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return {
          content: `HTTP ${response.status} ${response.statusText} for ${url}`,
          isError: true,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      let text = await response.text();

      if (contentType.includes('text/html')) {
        text = this._stripHtmlTags(text);
      }

      if (text.length > maxLength) {
        text = text.substring(0, maxLength) + `\n\n... (truncated at ${maxLength} characters)`;
      }

      return {
        content: text || `Empty response from ${url}`,
        isError: false,
        metadata: { url, status: response.status, contentType, length: text.length },
      };
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        return { content: `Network error fetching ${url}: ${error.message}`, isError: true };
      }
      return {
        content: `Error fetching ${url}: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }

  private _stripHtmlTags(html: string): string {
    let text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<\/h[1-6]>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return text;
  }

  updateCwd(cwd: string): void {
    this._cwd = cwd;
  }
}
