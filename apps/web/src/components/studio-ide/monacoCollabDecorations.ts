import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditorNamespace } from 'monaco-editor';
import {
  COLLAB_LIMITS,
  type RealtimePresenceUser,
} from '@codecollab/shared';

const STYLE_ELEMENT_ID = 'codecollab-collab-cursor-styles';
const SAME_LINE_GUARD_IDLE_MS = 6500;
const FOCUS_MODE_WINDOW_RADIUS = 6;

export interface GuardedLineInfo {
  lineNumber: number;
  user: RealtimePresenceUser;
}

/**
 * Resolves lines actively claimed by remote `'edit'` collaborators when
 * `preventSameLineEdit` is enabled. Uses `isTyping` or a recent active window
 * so passive/abandoned cursors release automatically without deadlocking lines.
 */
export function resolveGuardedLines(params: {
  presenceUsers: RealtimePresenceUser[];
  currentUserId: string;
  preventSameLineEdit: boolean;
  now?: number;
}): Map<number, GuardedLineInfo> {
  const guarded = new Map<number, GuardedLineInfo>();
  if (!params.preventSameLineEdit) return guarded;

  const now = params.now ?? Date.now();
  for (const user of params.presenceUsers) {
    if (user.userId === params.currentUserId) continue;
    if (user.permission !== 'edit') continue;

    const targetLine = user.focusLine ?? user.cursor?.headLine ?? null;
    if (targetLine === null) continue;

    const isActivelyClaimed =
      user.isTyping || now - user.lastActiveAt <= SAME_LINE_GUARD_IDLE_MS;
    if (!isActivelyClaimed) continue;

    const existing = guarded.get(targetLine);
    if (!existing || user.lastActiveAt > existing.user.lastActiveAt) {
      guarded.set(targetLine, { lineNumber: targetLine, user });
    }
  }

  return guarded;
}

const sanitizeCssToken = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, '');

const sanitizeHexColor = (color: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#f97316';

const hexToRgba = (hex: string, alpha: number): string => {
  const clean = sanitizeHexColor(hex).slice(1);
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Keeps dynamic per-collaborator CSS rules synced in `<head>` for Monaco carets,
 * selection tinting, frosted cursor glass bubbles, Focus Mode markers, and Same-Line Guard rails.
 */
export function syncCollaboratorStyleSheet(users: RealtimePresenceUser[]): void {
  if (typeof document === 'undefined') return;

  let styleEl = document.getElementById(
    STYLE_ELEMENT_ID,
  ) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ELEMENT_ID;
    document.head.appendChild(styleEl);
  }

  const userRules = users
    .map((user) => {
      const id = sanitizeCssToken(user.userId);
      const color = sanitizeHexColor(user.color);
      const selectionBg = hexToRgba(color, 0.22);
      const selectionBorder = hexToRgba(color, 0.48);
      const caretGlow = hexToRgba(color, 0.72);
      const focusLineBg = hexToRgba(color, 0.08);
      const bubbleBorder = hexToRgba(color, 0.62);
      const bubbleTint = hexToRgba(color, 0.16);
      const bubbleShadow = hexToRgba(color, 0.34);

      return `
        .cc-remote-selection-${id} {
          background-color: ${selectionBg};
          border-bottom: 1.5px solid ${selectionBorder};
          border-radius: 2px;
        }
        .cc-remote-focus-line-${id} {
          background-color: ${focusLineBg};
        }
        .cc-remote-focus-gutter-${id} {
          border-left: 3px solid ${color};
          margin-left: 2px;
          border-radius: 2px;
        }
        .cc-overlay-caret-${id} {
          background: ${color};
          box-shadow: 0 0 10px ${caretGlow};
        }
        .cc-overlay-caret-cap-${id} {
          background: radial-gradient(circle at 35% 30%, #ffffff 0%, ${color} 68%);
          border: 1px solid rgba(255, 255, 255, 0.8);
          box-shadow: 0 0 10px ${caretGlow};
        }
        .cc-cursor-bubble-${id} {
          border: 1px solid ${bubbleBorder};
          background-image:
            linear-gradient(
              132deg,
              rgba(255, 255, 255, 0.56) 0%,
              rgba(255, 255, 255, 0.08) 38%,
              transparent 62%
            ),
            linear-gradient(
              152deg,
              rgba(255, 255, 255, 0.92) 0%,
              rgba(248, 250, 252, 0.8) 62%,
              ${bubbleTint} 100%
            );
          color: #0f172a;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.98),
            inset 0 -1px 0 ${hexToRgba(color, 0.16)},
            0 10px 24px -6px rgba(15, 23, 42, 0.24),
            0 0 16px -3px ${bubbleShadow};
        }
        .cc-cursor-bubble-${id} .cc-cursor-bubble-arrow {
          border-top-color: rgba(248, 250, 252, 0.9);
          filter: drop-shadow(0 1px 0 ${bubbleBorder});
        }
        .cc-cursor-bubble-${id}.cc-cursor-glass-bubble-below .cc-cursor-bubble-arrow {
          border-top-color: transparent;
          border-bottom-color: rgba(248, 250, 252, 0.9);
          filter: drop-shadow(0 -1px 0 ${bubbleBorder});
        }
        .dark .cc-cursor-bubble-${id} {
          background-image:
            linear-gradient(
              132deg,
              rgba(255, 255, 255, 0.22) 0%,
              rgba(255, 255, 255, 0.04) 36%,
              transparent 62%
            ),
            linear-gradient(
              152deg,
              rgba(46, 52, 66, 0.84) 0%,
              rgba(18, 21, 29, 0.84) 64%,
              ${bubbleTint} 100%
            );
          color: #f8fafc;
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.34),
            inset 0 -1px 0 ${hexToRgba(color, 0.22)},
            0 12px 28px -6px rgba(0, 0, 0, 0.72),
            0 0 18px -3px ${bubbleShadow};
        }
        .dark .cc-cursor-bubble-${id} .cc-cursor-bubble-arrow {
          border-top-color: rgba(24, 28, 38, 0.88);
          filter: drop-shadow(0 1px 0 ${bubbleBorder});
        }
        .dark .cc-cursor-bubble-${id}.cc-cursor-glass-bubble-below .cc-cursor-bubble-arrow {
          border-top-color: transparent;
          border-bottom-color: rgba(24, 28, 38, 0.88);
          filter: drop-shadow(0 -1px 0 ${bubbleBorder});
        }
      `;
    })
    .join('\n');

  styleEl.textContent = `
    ${userRules}
    .cc-collab-overlay-layer {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
      z-index: 35;
    }
    .cc-cursor-anchor {
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      will-change: transform;
    }
    .cc-overlay-caret {
      position: absolute;
      top: 0;
      left: -1px;
      width: 2px;
      border-radius: 1px;
      pointer-events: none;
    }
    .cc-overlay-caret-cap {
      position: absolute;
      top: -3px;
      left: -2.5px;
      width: 7px;
      height: 7px;
      border-radius: 9999px;
      pointer-events: none;
    }
    .cc-cursor-glass-bubble {
      pointer-events: none;
      user-select: none;
      position: absolute;
      left: -10px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-family: "Geist Mono Variable", ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10.5px;
      font-weight: 600;
      letter-spacing: -0.01em;
      line-height: 1.2;
      white-space: nowrap;
      -webkit-backdrop-filter: blur(16px) saturate(200%);
      backdrop-filter: blur(16px) saturate(200%);
      animation: ccGlassBubblePop 160ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .cc-cursor-bubble-arrow {
      position: absolute;
      left: 10px;
      bottom: -5px;
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 5px solid rgba(255, 255, 255, 0.85);
      pointer-events: none;
    }
    .cc-cursor-glass-bubble-below .cc-cursor-bubble-arrow {
      bottom: auto;
      top: -5px;
      border-top-width: 0;
      border-bottom: 5px solid rgba(248, 250, 252, 0.9);
    }
    .cc-cursor-glass-bubble-idle {
      opacity: 0.88;
      transition: opacity 220ms ease;
    }
    @keyframes ccGlassBubblePop {
      0% { opacity: 0; transform: scale(0.94); }
      100% { opacity: 1; transform: scale(1); }
    }
    @keyframes ccBeaconPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.25); opacity: 0.75; }
    }
    .cc-cursor-beacon {
      width: 6px;
      height: 6px;
      border-radius: 9999px;
      flex-shrink: 0;
    }
    .cc-cursor-beacon-typing {
      animation: ccBeaconPulse 1s infinite ease-in-out;
    }
    .cc-focus-dim-line {
      opacity: 0.42;
      transition: opacity 140ms ease;
    }
    .cc-guarded-line {
      background-color: rgba(245, 158, 11, 0.11);
      box-shadow: inset 2px 0 0 rgba(245, 158, 11, 0.75);
    }
    .cc-guarded-gutter {
      background-color: rgba(245, 158, 11, 0.85);
      border-radius: 9999px;
      width: 6px !important;
      height: 6px !important;
      margin-top: 7px;
      margin-left: 4px;
    }
    @keyframes ccCursorTypingPulse {
      0%, 80%, 100% { opacity: 0.3; transform: translateY(0px); }
      40% { opacity: 1; transform: translateY(-1.5px); }
    }
    .cc-typing-dot {
      display: inline-block;
      width: 3px;
      height: 3px;
      border-radius: 9999px;
      background-color: currentColor;
      animation: ccCursorTypingPulse 1.1s infinite ease-in-out;
    }
    .cc-typing-dot:nth-child(2) { animation-delay: 0.16s; }
    .cc-typing-dot:nth-child(3) { animation-delay: 0.32s; }
  `;
}

interface OverlayCursorEntry {
  anchorEl: HTMLDivElement;
  caretEl: HTMLDivElement;
  bubbleEl: HTMLDivElement;
  arrowEl: HTMLSpanElement;
  lineNumber: number;
  column: number;
}

/**
 * Manages Monaco decorations and pixel-locked cursor + frosted glass bubble overlays
 * anchored directly via `editor.getScrolledVisiblePosition(...)` so bubbles always sit
 * directly over their collaborator's caret across scrolling, resizing, and Line 1 edge cases.
 */
export class MonacoCollabOverlay {
  private readonly editor: MonacoEditorNamespace.IStandaloneCodeEditor;
  private readonly monaco: Monaco;
  private readonly overlayRoot: HTMLDivElement;
  private readonly editorListeners: Array<{ dispose: () => void }> = [];
  private rafPendingId: number | null = null;
  private decorations: MonacoEditorNamespace.IEditorDecorationsCollection;
  private cursorEntries = new Map<string, OverlayCursorEntry>();

  constructor(
    editor: MonacoEditorNamespace.IStandaloneCodeEditor,
    monaco: Monaco,
  ) {
    this.editor = editor;
    this.monaco = monaco;
    this.decorations = editor.createDecorationsCollection();

    this.overlayRoot = document.createElement('div');
    this.overlayRoot.className = 'cc-collab-overlay-layer';
    const container = editor.getContainerDomNode();
    container.appendChild(this.overlayRoot);

    this.editorListeners.push(
      editor.onDidScrollChange(() => this.repositionAll()),
      editor.onDidLayoutChange(() => this.repositionAll()),
      editor.onDidChangeModelContent(() => {
        this.repositionAll();
        if (this.rafPendingId === null && typeof requestAnimationFrame !== 'undefined') {
          this.rafPendingId = requestAnimationFrame(() => {
            this.rafPendingId = null;
            this.repositionAll();
          });
        }
      }),
    );
  }

  update(params: {
    presenceUsers: RealtimePresenceUser[];
    currentUserId: string;
    focusModeEnabled: boolean;
    localCursorLine: number;
    guardedLines: Map<number, GuardedLineInfo>;
    now?: number;
  }): void {
    const model = this.editor.getModel();
    if (!model) {
      this.clear();
      return;
    }

    const now = params.now ?? Date.now();
    syncCollaboratorStyleSheet(params.presenceUsers);

    const remoteUsers = params.presenceUsers.filter(
      (u) => u.userId !== params.currentUserId,
    );

    // Cap visible remote cursors cleanly (`MAX_VISIBLE_CURSORS = 6`) prioritizing active typists
    const visibleCursorUsers = [...remoteUsers]
      .filter((u) => u.cursor !== null)
      .sort((a, b) => {
        if (a.isTyping !== b.isTyping) return a.isTyping ? -1 : 1;
        return b.lastActiveAt - a.lastActiveAt;
      })
      .slice(0, COLLAB_LIMITS.MAX_VISIBLE_CURSORS);

    const lineCount = Math.max(1, model.getLineCount());
    const clampLine = (line: number) =>
      Math.min(Math.max(1, Math.trunc(line)), lineCount);
    const clampCol = (line: number, col: number) => {
      const maxCol = Math.max(1, model.getLineMaxColumn(line));
      return Math.min(Math.max(1, Math.trunc(col)), maxCol);
    };

    const nextDecorations: MonacoEditorNamespace.IModelDeltaDecoration[] = [];

    // 1. Focus Mode: gently dim lines far outside local +/- 6 line focus band
    if (params.focusModeEnabled && lineCount > 1) {
      const minFocus = Math.max(
        1,
        params.localCursorLine - FOCUS_MODE_WINDOW_RADIUS,
      );
      const maxFocus = Math.min(
        lineCount,
        params.localCursorLine + FOCUS_MODE_WINDOW_RADIUS,
      );

      if (minFocus > 1) {
        nextDecorations.push({
          range: new this.monaco.Range(
            1,
            1,
            minFocus - 1,
            model.getLineMaxColumn(minFocus - 1),
          ),
          options: {
            inlineClassName: 'cc-focus-dim-line',
          },
        });
      }
      if (maxFocus < lineCount) {
        nextDecorations.push({
          range: new this.monaco.Range(
            maxFocus + 1,
            1,
            lineCount,
            model.getLineMaxColumn(lineCount),
          ),
          options: {
            inlineClassName: 'cc-focus-dim-line',
          },
        });
      }
    }

    // 2. Remote Collaborator Gutter Focus Markers + Selections + Pixel-Locked Caret & Glass Bubble
    const activeEntryIds = new Set<string>();

    for (const user of visibleCursorUsers) {
      const safeId = sanitizeCssToken(user.userId);
      const cursor = user.cursor!;

      const aLine = clampLine(cursor.anchorLine);
      const aCol = clampCol(aLine, cursor.anchorColumn);
      const hLine = clampLine(cursor.headLine);
      const hCol = clampCol(hLine, cursor.headColumn);

      // Subtle gutter bar & line tint showing where teammate is working
      if (user.focusLine !== null || params.focusModeEnabled) {
        const fLine = clampLine(user.focusLine ?? hLine);
        nextDecorations.push({
          range: new this.monaco.Range(fLine, 1, fLine, 1),
          options: {
            isWholeLine: true,
            className: `cc-remote-focus-line-${safeId}`,
            linesDecorationsClassName: `cc-remote-focus-gutter-${safeId}`,
            hoverMessage: {
              value: `**@${user.username}** (${user.permission === 'edit' ? 'editing' : 'viewing'}) · Line ${fLine}`,
            },
          },
        });
      }

      if (!params.focusModeEnabled) {
        // Remote non-collapsed selection range highlight
        if (aLine !== hLine || aCol !== hCol) {
          const isForward =
            aLine < hLine || (aLine === hLine && aCol <= hCol);
          const startLine = isForward ? aLine : hLine;
          const startCol = isForward ? aCol : hCol;
          const endLine = isForward ? hLine : aLine;
          const endCol = isForward ? hCol : aCol;

          nextDecorations.push({
            range: new this.monaco.Range(
              startLine,
              startCol,
              endLine,
              endCol,
            ),
            options: {
              className: `cc-remote-selection-${safeId}`,
              stickiness:
                this.monaco.editor.TrackedRangeStickiness
                  .NeverGrowsWhenTypingAtEdges,
            },
          });
        }

        const isIdleBadge =
          !user.isTyping &&
          now - user.lastActiveAt > COLLAB_LIMITS.CURSOR_BADGE_IDLE_MS;

        activeEntryIds.add(safeId);
        this.upsertCursorOverlay(safeId, user, hLine, hCol, isIdleBadge);
      }
    }

    // 3. Same-Line Edit Guard amber rail & gutter dot on claimed lines
    for (const [rawLine, info] of params.guardedLines.entries()) {
      const guardedLine = clampLine(rawLine);
      nextDecorations.push({
        range: new this.monaco.Range(guardedLine, 1, guardedLine, 1),
        options: {
          isWholeLine: true,
          className: 'cc-guarded-line',
          glyphMarginClassName: 'cc-guarded-gutter',
          glyphMarginHoverMessage: {
            value: `**Same-Line Edit Guard:** @${info.user.username} is actively editing Line ${guardedLine}`,
          },
          hoverMessage: {
            value: `**Line ${guardedLine} guarded** by @${info.user.username}`,
          },
        },
      });
    }

    // Remove stale cursor overlays
    for (const [entryId, entry] of this.cursorEntries.entries()) {
      if (!activeEntryIds.has(entryId)) {
        entry.anchorEl.remove();
        this.cursorEntries.delete(entryId);
      }
    }

    this.decorations.set(nextDecorations);
    this.repositionAll();
  }

  private upsertCursorOverlay(
    safeId: string,
    user: RealtimePresenceUser,
    lineNumber: number,
    column: number,
    isIdleBadge: boolean,
  ): void {
    const color = sanitizeHexColor(user.color);
    let entry = this.cursorEntries.get(safeId);

    if (!entry) {
      const anchorEl = document.createElement('div');
      anchorEl.className = 'cc-cursor-anchor';

      const caretEl = document.createElement('div');
      const capEl = document.createElement('span');
      caretEl.appendChild(capEl);

      const bubbleEl = document.createElement('div');
      const arrowEl = document.createElement('span');
      arrowEl.className = 'cc-cursor-bubble-arrow';

      anchorEl.appendChild(caretEl);
      anchorEl.appendChild(bubbleEl);
      this.overlayRoot.appendChild(anchorEl);

      entry = {
        anchorEl,
        caretEl,
        bubbleEl,
        arrowEl,
        lineNumber,
        column,
      };
      this.cursorEntries.set(safeId, entry);
    }

    entry.lineNumber = lineNumber;
    entry.column = column;

    entry.caretEl.className = `cc-overlay-caret cc-overlay-caret-${safeId}`;
    const capEl = entry.caretEl.firstElementChild as HTMLSpanElement;
    capEl.className = `cc-overlay-caret-cap cc-overlay-caret-cap-${safeId}`;

    entry.bubbleEl.className = [
      'cc-cursor-glass-bubble',
      `cc-cursor-bubble-${safeId}`,
      isIdleBadge ? 'cc-cursor-glass-bubble-idle' : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Build custom glass pill safely using DOM nodes (zero innerHTML / XSS risk)
    entry.bubbleEl.replaceChildren();

    const beacon = document.createElement('span');
    beacon.className = user.isTyping
      ? 'cc-cursor-beacon cc-cursor-beacon-typing'
      : 'cc-cursor-beacon';
    beacon.style.backgroundColor = color;
    beacon.style.boxShadow = `0 0 8px ${hexToRgba(color, 0.75)}`;
    entry.bubbleEl.appendChild(beacon);

    const labelSpan = document.createElement('span');
    labelSpan.textContent = `@${user.username}`;
    entry.bubbleEl.appendChild(labelSpan);

    if (user.permission === 'read_only') {
      const roleSpan = document.createElement('span');
      roleSpan.textContent = 'view';
      roleSpan.style.fontSize = '9px';
      roleSpan.style.opacity = '0.68';
      entry.bubbleEl.appendChild(roleSpan);
    }

    if (user.isTyping) {
      const dots = document.createElement('span');
      dots.className = 'inline-flex items-center gap-[2px] ml-0.5';
      dots.style.color = color;
      for (let i = 0; i < 3; i += 1) {
        const dot = document.createElement('span');
        dot.className = 'cc-typing-dot';
        dots.appendChild(dot);
      }
      entry.bubbleEl.appendChild(dots);
    }

    entry.bubbleEl.appendChild(entry.arrowEl);
  }

  private repositionAll(): void {
    const model = this.editor.getModel();
    if (!model || this.cursorEntries.size === 0) return;

    const layout = this.editor.getLayoutInfo();
    const minLeft = layout.contentLeft;
    const maxRight = layout.contentLeft + layout.contentWidth;
    const lineCount = Math.max(1, model.getLineCount());

    for (const entry of this.cursorEntries.values()) {
      const line = Math.min(Math.max(1, entry.lineNumber), lineCount);
      const col = Math.min(
        Math.max(1, entry.column),
        Math.max(1, model.getLineMaxColumn(line)),
      );

      const pos = this.editor.getScrolledVisiblePosition({
        lineNumber: line,
        column: col,
      });

      if (
        !pos ||
        pos.top + pos.height < 0 ||
        pos.top > layout.height ||
        pos.left < minLeft - 2 ||
        pos.left > maxRight + 2
      ) {
        entry.anchorEl.style.display = 'none';
        continue;
      }

      entry.anchorEl.style.display = 'block';
      entry.anchorEl.style.transform = `translate3d(${Math.round(pos.left)}px, ${Math.round(pos.top)}px, 0)`;
      entry.caretEl.style.height = `${Math.max(14, Math.round(pos.height))}px`;

      // Place bubble directly over the caret unless near top viewport edge, where it flips below
      const bubbleWidth = entry.bubbleEl.offsetWidth || 96;
      const bubbleHeight = entry.bubbleEl.offsetHeight || 24;
      const placeBelow = pos.top < bubbleHeight + 12;

      entry.bubbleEl.classList.toggle('cc-cursor-glass-bubble-below', placeBelow);
      if (placeBelow) {
        entry.bubbleEl.style.top = `${Math.round(pos.height + 6)}px`;
        entry.bubbleEl.style.bottom = 'auto';
      } else {
        entry.bubbleEl.style.top = `${Math.round(-(bubbleHeight + 6))}px`;
        entry.bubbleEl.style.bottom = 'auto';
      }

      // Keep bubble inside horizontal editor content bounds while keeping arrow aligned over caret
      const idealBubbleLeft = -15;
      const minBubbleLeft = minLeft - pos.left + 4;
      const maxBubbleLeft = maxRight - pos.left - bubbleWidth - 6;
      const clampedBubbleLeft =
        maxBubbleLeft >= minBubbleLeft
          ? Math.min(Math.max(idealBubbleLeft, minBubbleLeft), maxBubbleLeft)
          : minBubbleLeft;

      entry.bubbleEl.style.left = `${Math.round(clampedBubbleLeft)}px`;
      const arrowOffset = Math.min(
        Math.max(10, Math.round(-clampedBubbleLeft - 5)),
        Math.max(10, bubbleWidth - 20),
      );
      entry.arrowEl.style.left = `${arrowOffset}px`;
    }
  }

  clear(): void {
    if (this.rafPendingId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafPendingId);
      this.rafPendingId = null;
    }
    for (const entry of this.cursorEntries.values()) {
      entry.anchorEl.remove();
    }
    this.cursorEntries.clear();
    this.decorations.clear();
  }

  dispose(): void {
    this.clear();
    for (const listener of this.editorListeners) {
      listener.dispose();
    }
    this.editorListeners.length = 0;
    this.overlayRoot.remove();
  }
}
