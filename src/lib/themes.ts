// Terminal palettes. The names match what the settings panel offers, and the shape is
// xterm.js's ITheme so a palette can be handed straight to the terminal.

import type { ITheme } from "@xterm/xterm";

export interface TerminalTheme {
  name: string;
  /** Used for the light/dark decision the app chrome makes around the terminal. */
  dark: boolean;
  theme: ITheme;
}

export const TERMINAL_THEMES: TerminalTheme[] = [
  {
    name: "One Dark",
    dark: true,
    theme: {
      background: "#282c34", foreground: "#abb2bf", cursor: "#61afef",
      selectionBackground: "#3e4451",
      black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
      blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
      brightBlack: "#5c6370", brightRed: "#e06c75", brightGreen: "#98c379",
      brightYellow: "#e5c07b", brightBlue: "#61afef", brightMagenta: "#c678dd",
      brightCyan: "#56b6c2", brightWhite: "#ffffff",
    },
  },
  {
    name: "Dracula",
    dark: true,
    theme: {
      background: "#282a36", foreground: "#f8f8f2", cursor: "#ff79c6",
      selectionBackground: "#44475a",
      black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
      blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
      brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94",
      brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df",
      brightCyan: "#a4ffff", brightWhite: "#ffffff",
    },
  },
  {
    name: "Nord",
    dark: true,
    theme: {
      background: "#2e3440", foreground: "#d8dee9", cursor: "#88c0d0",
      selectionBackground: "#434c5e",
      black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
      blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
      brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb", brightWhite: "#eceff4",
    },
  },
  {
    name: "Solarized Dark",
    dark: true,
    theme: {
      background: "#002b36", foreground: "#93a1a1", cursor: "#93a1a1",
      selectionBackground: "#073642",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#586e75", brightRed: "#cb4b16", brightGreen: "#586e75",
      brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    name: "Tokyo Night",
    dark: true,
    theme: {
      background: "#1a1b26", foreground: "#c0caf5", cursor: "#7aa2f7",
      selectionBackground: "#33467c",
      black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
      blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
      brightBlack: "#414868", brightRed: "#f7768e", brightGreen: "#9ece6a",
      brightYellow: "#e0af68", brightBlue: "#7aa2f7", brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff", brightWhite: "#c0caf5",
    },
  },
  {
    name: "Matrix",
    dark: true,
    theme: {
      background: "#0b0f0b", foreground: "#3ddc60", cursor: "#3ddc60",
      selectionBackground: "#173d20",
      black: "#0b0f0b", red: "#2f7c3f", green: "#3ddc60", yellow: "#5ff08a",
      blue: "#2f9c56", magenta: "#37b366", cyan: "#4fe08a", white: "#a8f0bd",
      brightBlack: "#1d4a28", brightRed: "#48d96a", brightGreen: "#6dff96",
      brightYellow: "#8bffb0", brightBlue: "#48d98a", brightMagenta: "#56e69a",
      brightCyan: "#7bffbb", brightWhite: "#d8ffe4",
    },
  },
  {
    name: "Solarized Light",
    dark: false,
    theme: {
      background: "#fdf6e3", foreground: "#657b83", cursor: "#586e75",
      selectionBackground: "#eee8d5",
      black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
      blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
      brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75",
      brightYellow: "#657b83", brightBlue: "#839496", brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1", brightWhite: "#fdf6e3",
    },
  },
  {
    name: "Paper",
    dark: false,
    theme: {
      background: "#ffffff", foreground: "#24292f", cursor: "#0969da",
      selectionBackground: "#d7e6fb",
      black: "#24292f", red: "#cf222e", green: "#116329", yellow: "#4d2d00",
      blue: "#0969da", magenta: "#8250df", cyan: "#1b7c83", white: "#6e7781",
      brightBlack: "#57606a", brightRed: "#a40e26", brightGreen: "#1a7f37",
      brightYellow: "#633c01", brightBlue: "#218bff", brightMagenta: "#a475f9",
      brightCyan: "#3192aa", brightWhite: "#8c959f",
    },
  },
];

export function findTheme(name: string): TerminalTheme {
  return TERMINAL_THEMES.find((t) => t.name === name) ?? TERMINAL_THEMES[0];
}
