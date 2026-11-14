export type TerminalSessionStatus = 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export interface TerminalSessionInfo {
  sessionId: string;
  projectId: string;
  status: TerminalSessionStatus;
  createdAt: string;
}

export type {
  TerminalInputMessage,
  TerminalResizeMessage,
  TerminalPingMessage,
  TerminalClientMessage,
  TerminalOutputMessage,
  TerminalExitMessage,
  TerminalErrorMessage,
  TerminalPongMessage,
  TerminalServerMessage,
} from '../schemas/terminal';
