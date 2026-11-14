import { z } from 'zod';

export const TerminalInputMessageSchema = z.object({
  type: z.literal('input'),
  data: z.string(),
});

export const TerminalResizeMessageSchema = z.object({
  type: z.literal('resize'),
  cols: z.number().int().min(1).max(500),
  rows: z.number().int().min(1).max(200),
});

export const TerminalPingMessageSchema = z.object({
  type: z.literal('ping'),
});

export const TerminalClientMessageSchema = z.discriminatedUnion('type', [
  TerminalInputMessageSchema,
  TerminalResizeMessageSchema,
  TerminalPingMessageSchema,
]);

export const TerminalOutputMessageSchema = z.object({
  type: z.literal('output'),
  data: z.string(),
});

export const TerminalExitMessageSchema = z.object({
  type: z.literal('exit'),
  exitCode: z.number().int(),
});

export const TerminalErrorMessageSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
});

export const TerminalPongMessageSchema = z.object({
  type: z.literal('pong'),
});

export const TerminalServerMessageSchema = z.discriminatedUnion('type', [
  TerminalOutputMessageSchema,
  TerminalExitMessageSchema,
  TerminalErrorMessageSchema,
  TerminalPongMessageSchema,
]);

export type TerminalInputMessage = z.infer<typeof TerminalInputMessageSchema>;
export type TerminalResizeMessage = z.infer<typeof TerminalResizeMessageSchema>;
export type TerminalPingMessage = z.infer<typeof TerminalPingMessageSchema>;
export type TerminalClientMessage = z.infer<typeof TerminalClientMessageSchema>;

export type TerminalOutputMessage = z.infer<typeof TerminalOutputMessageSchema>;
export type TerminalExitMessage = z.infer<typeof TerminalExitMessageSchema>;
export type TerminalErrorMessage = z.infer<typeof TerminalErrorMessageSchema>;
export type TerminalPongMessage = z.infer<typeof TerminalPongMessageSchema>;
export type TerminalServerMessage = z.infer<typeof TerminalServerMessageSchema>;
