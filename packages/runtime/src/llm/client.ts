import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  tokens_input: number;
  tokens_output: number;
  model: string;
  duration_ms: number;
}

export interface LLMClient {
  complete(params: {
    model: string;
    messages: Message[];
    max_tokens: number;
    system?: string;
  }): Promise<LLMResponse>;
}

export class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(params: {
    model: string;
    messages: Message[];
    max_tokens: number;
    system?: string;
  }): Promise<LLMResponse> {
    const start = Date.now();
    const response = await this.client.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      system: params.system,
      messages: params.messages,
    });
    return {
      content: response.content[0].type === 'text' ? response.content[0].text : '',
      tokens_input: response.usage.input_tokens,
      tokens_output: response.usage.output_tokens,
      model: response.model,
      duration_ms: Date.now() - start,
    };
  }
}

export class OpenAIClient implements LLMClient {
  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async complete(params: {
    model: string;
    messages: Message[];
    max_tokens: number;
    system?: string;
  }): Promise<LLMResponse> {
    const start = Date.now();
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (params.system) {
      messages.push({ role: 'system', content: params.system });
    }
    messages.push(...params.messages.map((m) => ({ role: m.role, content: m.content })));

    const response = await this.client.chat.completions.create({
      model: params.model,
      messages,
      max_tokens: params.max_tokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      tokens_input: response.usage?.prompt_tokens || 0,
      tokens_output: response.usage?.completion_tokens || 0,
      model: response.model,
      duration_ms: Date.now() - start,
    };
  }
}

export function createLLMClient(
  model: string,
  config: {
    default_provider: string;
    providers: Record<string, { api_key?: string; endpoint?: string }>;
  }
): LLMClient {
  if (model.startsWith('claude-')) {
    const apiKey =
      config.providers['anthropic']?.api_key || process.env['ANTHROPIC_API_KEY'] || '';
    return new AnthropicClient(apiKey);
  }
  const apiKey =
    config.providers['openai']?.api_key ||
    config.providers['azure_openai']?.api_key ||
    process.env['OPENAI_API_KEY'] ||
    '';
  const baseURL = config.providers['azure_openai']?.endpoint;
  return new OpenAIClient(apiKey, baseURL);
}
