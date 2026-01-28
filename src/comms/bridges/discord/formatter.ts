/**
 * Message Formatter
 *
 * Bidirectional message formatting between Discord and SignalDB.
 * Handles code blocks, markdown, truncation, and language detection.
 */

import type { PasteClient } from '../../pastes/paste-client';
import type { DiscordMessage, MessageFormatConfig } from './types';

// ============================================================================
// Constants
// ============================================================================

/** Discord message length limit */
const DISCORD_MAX_LENGTH = 2000;

/** Default truncation suffix */
const DEFAULT_TRUNCATION_SUFFIX = '... [truncated]';

/** Default code block language */
const DEFAULT_CODE_BLOCK_LANG = '';

/** Language detection patterns */
const LANGUAGE_PATTERNS: Array<{ pattern: RegExp; lang: string }> = [
  {
    pattern: /^(import|export|const|let|var|function|class|interface|type)\s/m,
    lang: 'typescript',
  },
  { pattern: /^(def|class|import|from|if __name__|print\()/m, lang: 'python' },
  { pattern: /^(package|func|import|type|var|const)\s/m, lang: 'go' },
  { pattern: /^(use|fn|let|mut|impl|struct|enum)\s/m, lang: 'rust' },
  { pattern: /^(public|private|protected|class|interface|package)\s/m, lang: 'java' },
  { pattern: /^\s*<\?php/m, lang: 'php' },
  { pattern: /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\s/im, lang: 'sql' },
  { pattern: /^(\{|\[)[\s\S]*(\}|\])$/m, lang: 'json' },
  { pattern: /^(---|\w+:)\s/m, lang: 'yaml' },
  { pattern: /^\s*<(!DOCTYPE|html|head|body|div|span|p|a)\s*/im, lang: 'html' },
  {
    pattern: /^(#!\/bin\/(bash|sh)|^\s*(if|then|fi|for|do|done|while|case|esac))\s/m,
    lang: 'bash',
  },
];

// ============================================================================
// Message Formatter
// ============================================================================

/**
 * Formats messages between Discord and SignalDB.
 *
 * Handles:
 * - Code block formatting with syntax highlighting hints
 * - Markdown normalization between platforms
 * - Content truncation with paste links for overflow
 * - Language detection for code blocks
 *
 * @example
 * ```typescript
 * const formatter = new MessageFormatter(config, pasteClient);
 *
 * // Format SignalDB message for Discord
 * const discordContent = await formatter.formatForDiscord(signalDBMessage);
 *
 * // Format Discord message for SignalDB
 * const signalDBContent = formatter.formatForSignalDB(discordMessage);
 *
 * // Truncate with paste link
 * const truncated = await formatter.truncateWithLink(longContent, 2000);
 * ```
 */
export class MessageFormatter {
  private readonly config: MessageFormatConfig;
  private readonly pasteClient: PasteClient | null;

  constructor(config?: Partial<MessageFormatConfig>, pasteClient?: PasteClient) {
    this.config = {
      maxLength: config?.maxLength ?? DISCORD_MAX_LENGTH,
      truncationSuffix: config?.truncationSuffix ?? DEFAULT_TRUNCATION_SUFFIX,
      codeBlockLang: config?.codeBlockLang ?? DEFAULT_CODE_BLOCK_LANG,
    };
    this.pasteClient = pasteClient ?? null;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Format a SignalDB message for Discord.
   *
   * - Wraps code in Discord code blocks with language hints
   * - Converts SignalDB markdown to Discord markdown
   * - Truncates at 2000 chars with optional paste link
   *
   * @param content - SignalDB message content
   * @returns Formatted Discord-ready content
   */
  async formatForDiscord(content: string): Promise<string> {
    let formatted = content;

    // Detect and format code blocks
    formatted = this.formatCodeBlocks(formatted);

    // Convert any platform-specific markdown
    formatted = this.normalizeMarkdown(formatted);

    // Truncate if needed
    if (formatted.length > this.config.maxLength) {
      formatted = await this.truncateWithLink(formatted, this.config.maxLength);
    }

    return formatted;
  }

  /**
   * Format a Discord message for SignalDB.
   *
   * - Strips Discord-specific formatting
   * - Normalizes code blocks
   * - Preserves essential markdown
   *
   * @param message - Discord message object
   * @returns Formatted SignalDB-ready content
   */
  formatForSignalDB(message: DiscordMessage): string {
    let content = message.content;

    // Strip Discord mentions and convert to readable format
    content = this.stripDiscordMentions(content);

    // Normalize code blocks
    content = this.normalizeCodeBlocks(content);

    // Handle attachments
    if (message.attachments.length > 0) {
      const attachmentLinks = message.attachments.map((a) => `[${a.filename}](${a.url})`);
      content += `\n\nAttachments:\n${attachmentLinks.join('\n')}`;
    }

    return content.trim();
  }

  /**
   * Truncate content and create a paste for the full version.
   *
   * @param content - Content to truncate
   * @param maxLen - Maximum length
   * @returns Truncated content with paste link (if available)
   */
  async truncateWithLink(content: string, maxLen?: number): Promise<string> {
    const limit = maxLen ?? this.config.maxLength;

    if (content.length <= limit) {
      return content;
    }

    // Calculate space needed for suffix and potential paste link
    const suffixSpace = this.config.truncationSuffix.length + 100; // Extra for paste URL
    const truncateAt = limit - suffixSpace;

    // Try to truncate at a word boundary
    let truncated = content.slice(0, truncateAt);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > truncateAt * 0.8) {
      truncated = truncated.slice(0, lastSpace);
    }

    // Create paste if client available
    if (this.pasteClient) {
      try {
        const paste = await this.pasteClient.create({
          content,
          contentType: this.detectContentType(content),
          accessMode: 'ttl',
          ttlSeconds: 3600, // 1 hour
        });
        return `${truncated}${this.config.truncationSuffix}\n\nFull content: paste://${paste.id}`;
      } catch {
        // Fall back to simple truncation
      }
    }

    return `${truncated}${this.config.truncationSuffix}`;
  }

  /**
   * Detect the programming language of a code block.
   *
   * @param codeBlock - Code content (without fence markers)
   * @returns Detected language or empty string
   */
  detectLanguage(codeBlock: string): string {
    for (let i = 0; i < LANGUAGE_PATTERNS.length; i++) {
      const { pattern, lang } = LANGUAGE_PATTERNS[i]!;
      if (pattern.test(codeBlock)) {
        return lang;
      }
    }

    return this.config.codeBlockLang;
  }

  /**
   * Format a code block with language hint.
   *
   * @param code - Code content
   * @param lang - Optional language override
   * @returns Formatted code block
   */
  formatCodeBlock(code: string, lang?: string): string {
    const language = lang || this.detectLanguage(code);
    return `\`\`\`${language}\n${code}\n\`\`\``;
  }

  /**
   * Check if content appears to be code.
   *
   * @param content - Content to check
   * @returns True if content looks like code
   */
  isCode(content: string): boolean {
    // Already in code block
    if (content.includes('```')) return true;

    // Has common code patterns
    for (let i = 0; i < LANGUAGE_PATTERNS.length; i++) {
      if (LANGUAGE_PATTERNS[i]!.pattern.test(content)) {
        return true;
      }
    }

    // Has significant indentation
    const lines = content.split('\n');
    let indentedLines = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s{2,}/.test(lines[i]!)) {
        indentedLines++;
      }
    }

    return indentedLines > lines.length * 0.3;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Format code blocks with language detection.
   */
  private formatCodeBlocks(content: string): string {
    // Find existing code blocks without language and add detection
    return content.replace(/```\n([\s\S]*?)```/g, (_match, code: string) => {
      const lang = this.detectLanguage(code);
      return `\`\`\`${lang}\n${code}\`\`\``;
    });
  }

  /**
   * Normalize markdown between platforms.
   */
  private normalizeMarkdown(content: string): string {
    let normalized = content;

    // Discord uses ** for bold, _ for italic (same as standard markdown)
    // No changes needed for basic markdown

    // Convert any HTML-style formatting to markdown
    normalized = normalized.replace(/<b>(.*?)<\/b>/gi, '**$1**');
    normalized = normalized.replace(/<i>(.*?)<\/i>/gi, '*$1*');
    normalized = normalized.replace(/<code>(.*?)<\/code>/gi, '`$1`');

    return normalized;
  }

  /**
   * Normalize code blocks (ensure consistent formatting).
   */
  private normalizeCodeBlocks(content: string): string {
    // Ensure code blocks have newlines
    return content.replace(/```(\w*)\s*([^`]+)\s*```/g, (_match, lang: string, code: string) => {
      return `\`\`\`${lang}\n${code.trim()}\n\`\`\``;
    });
  }

  /**
   * Strip Discord-specific mentions and convert to readable format.
   */
  private stripDiscordMentions(content: string): string {
    let stripped = content;

    // User mentions: <@123456789> or <@!123456789>
    stripped = stripped.replace(/<@!?(\d+)>/g, '@user:$1');

    // Role mentions: <@&123456789>
    stripped = stripped.replace(/<@&(\d+)>/g, '@role:$1');

    // Channel mentions: <#123456789>
    stripped = stripped.replace(/<#(\d+)>/g, '#channel:$1');

    // Custom emoji: <:name:123456789> or <a:name:123456789>
    stripped = stripped.replace(/<a?:(\w+):\d+>/g, ':$1:');

    // Timestamps: <t:123456789:R>
    stripped = stripped.replace(/<t:(\d+)(?::[a-zA-Z])?>/g, (_match, ts: string) => {
      return new Date(Number.parseInt(ts, 10) * 1000).toISOString();
    });

    return stripped;
  }

  /**
   * Detect content type for paste creation.
   */
  private detectContentType(content: string): string {
    if (content.includes('```')) {
      // Extract first code block language
      const match = content.match(/```(\w+)/);
      if (match) {
        const lang = match[1]!;
        switch (lang) {
          case 'typescript':
          case 'ts':
            return 'text/typescript';
          case 'javascript':
          case 'js':
            return 'text/javascript';
          case 'python':
          case 'py':
            return 'text/x-python';
          case 'json':
            return 'application/json';
          case 'yaml':
          case 'yml':
            return 'text/yaml';
          case 'html':
            return 'text/html';
          case 'css':
            return 'text/css';
          case 'sql':
            return 'text/x-sql';
          default:
            return 'text/plain';
        }
      }
    }

    return 'text/plain';
  }
}
