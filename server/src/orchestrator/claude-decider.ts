import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageCreateParamsNonStreaming,
  ThinkingBlock,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/messages';
import type { DecideContext, Decider, Decision } from './decider.js';
import { buildOrchestratorSystemPrompt, renderLoopState } from './prompt.js';
import { orchestratorTools, toolUseToAction } from './tools.js';

export class DeciderError extends Error {
  override readonly name = 'DeciderError';
}

export class ClaudeDecider implements Decider {
  readonly #model: string;
  readonly #effort: 'low' | 'medium' | 'high' | 'max';
  readonly #createMessage: (params: MessageCreateParamsNonStreaming) => Promise<Message>;

  constructor(opts: {
    model?: string;
    effort?: 'low' | 'medium' | 'high' | 'max';
    createMessage?: (params: MessageCreateParamsNonStreaming) => Promise<Message>;
  } = {}) {
    this.#model = opts.model ?? 'claude-opus-4-8';
    this.#effort = opts.effort ?? 'high';
    if (opts.createMessage !== undefined) this.#createMessage = opts.createMessage;
    else {
      const client = new Anthropic();
      this.#createMessage = (params) => client.messages.create(params);
    }
  }

  async decide({ loop, roster, rejection }: DecideContext): Promise<Decision> {
    const rejectionInstruction = rejection === undefined
      ? ''
      : `\n\nYour previous choice was rejected by policy: ${rejection}. Choose a different, legal action now.`;
    const params: MessageCreateParamsNonStreaming = {
      model: this.#model,
      max_tokens: 8_192,
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort: this.#effort },
      system: buildOrchestratorSystemPrompt(),
      tools: orchestratorTools,
      messages: [{ role: 'user', content: `${renderLoopState(loop, roster)}${rejectionInstruction}` }],
    };
    const response = await this.#createMessage(params);
    const reasoning = response.content
      .filter((block): block is ThinkingBlock => block.type === 'thinking')
      .map(({ thinking }) => thinking)
      .join('\n');
    const toolUse = response.content.find((block): block is ToolUseBlock => block.type === 'tool_use');
    if (toolUse === undefined) throw new DeciderError('model returned no tool call');
    return { reasoning, action: toolUseToAction(toolUse.name, toolUse.input) };
  }
}
