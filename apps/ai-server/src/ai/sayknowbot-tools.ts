/**
 * SayKnowbot Tool Definitions
 * Definitions for local tools executed in the Electron app.
 * When AI returns tool_calls, SayKnowbot executes them.
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

/**
 * All available tool definitions for SayKnowbot.
 * OpenAI Function Calling format.
 */
export const SAYKNOWBOT_TOOLS: ToolDefinition[] = [
  // ===== Browser Tools =====
  {
    type: 'function',
    function: {
      name: 'browser_open',
      description: 'Opens a URL in the web browser. Used when the user wants to open a website or search.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'URL to open (e.g. https://google.com). If no URL, performs a Google search with the query.',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_content',
      description: 'Gets the text content of the current browser page.',
      parameters: {
        type: 'object',
        properties: {
          windowId: {
            type: 'number',
            description: 'Browser window ID (returned by browser_open)',
          },
          selector: {
            type: 'string',
            description: 'CSS selector (to get only specific elements)',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Clicks an element on the browser page.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector of the element to click (e.g. button.submit, #login-btn)',
          },
          windowId: {
            type: 'number',
            description: 'Browser window ID',
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Types text into an input field on the browser page.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector of the input field',
          },
          text: {
            type: 'string',
            description: 'Text to type',
          },
          windowId: {
            type: 'number',
            description: 'Browser window ID',
          },
        },
        required: ['selector', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scrolls the browser page.',
      parameters: {
        type: 'object',
        properties: {
          direction: {
            type: 'string',
            enum: ['up', 'down'],
            description: 'Scroll direction',
          },
          amount: {
            type: 'number',
            description: 'Scroll amount (pixels). Default: 500',
          },
          windowId: {
            type: 'number',
            description: 'Browser window ID',
          },
        },
        required: ['direction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Browser navigation (back, forward, refresh)',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['back', 'forward', 'refresh'],
            description: 'Action: back, forward, or refresh',
          },
          windowId: {
            type: 'number',
            description: 'Browser window ID',
          },
        },
        required: ['action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_close',
      description: 'Closes a browser window.',
      parameters: {
        type: 'object',
        properties: {
          windowId: {
            type: 'number',
            description: 'Browser window ID to close',
          },
        },
        required: ['windowId'],
      },
    },
  },

  // ===== Weather Tool =====
  {
    type: 'function',
    function: {
      name: 'weather',
      description: 'Gets the current weather and forecast for a specific city. Used when the user asks about weather or temperature.',
      parameters: {
        type: 'object',
        properties: {
          city: {
            type: 'string',
            description: 'City name to check weather for (e.g. Seoul, Tokyo, New York)',
          },
          days: {
            type: 'number',
            description: 'Number of forecast days (1-7, default: 1)',
          },
        },
        required: ['city'],
      },
    },
  },

  // ===== Screenshot Tool =====
  {
    type: 'function',
    function: {
      name: 'screenshot',
      description: 'Captures a screenshot of the current screen. Used when the user requests a screen capture or screenshot.',
      parameters: {
        type: 'object',
        properties: {
          region: {
            type: 'string',
            enum: ['full', 'window', 'selection'],
            description: 'Capture region: full (entire screen), window (current window), selection (selected area)',
          },
          path: {
            type: 'string',
            description: 'Save path (optional)',
          },
        },
      },
    },
  },

  // ===== Clipboard Tools =====
  {
    type: 'function',
    function: {
      name: 'clipboard_read',
      description: 'Reads the clipboard contents. Used when the user asks about copied content or clipboard contents.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clipboard_write',
      description: 'Copies text to the clipboard. Used when the user asks to copy text.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to copy to clipboard',
          },
        },
        required: ['text'],
      },
    },
  },

  // ===== Date/Time Tool =====
  {
    type: 'function',
    function: {
      name: 'datetime',
      description: 'Gets the current date and time. Used when the user asks what time it is or today\'s date.',
      parameters: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['full', 'date', 'time', 'iso'],
            description: 'Output format: full, date (date only), time (time only), iso (ISO format)',
          },
          timezone: {
            type: 'string',
            description: 'Timezone (e.g. Asia/Seoul, America/New_York)',
          },
        },
      },
    },
  },

  // ===== Calculator Tool =====
  {
    type: 'function',
    function: {
      name: 'calculator',
      description: 'Performs mathematical calculations. Used when the user requests calculations like addition, subtraction, multiplication, or division.',
      parameters: {
        type: 'object',
        properties: {
          expression: {
            type: 'string',
            description: 'Math expression to evaluate (e.g. 2+2, 100*5, sqrt(16))',
          },
        },
        required: ['expression'],
      },
    },
  },

  // ===== Notification Tool =====
  {
    type: 'function',
    function: {
      name: 'notification',
      description: 'Displays a system notification. Used to send notifications or set reminders for the user.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Notification title',
          },
          message: {
            type: 'string',
            description: 'Notification content',
          },
        },
        required: ['message'],
      },
    },
  },

  // ===== TTS Tool =====
  {
    type: 'function',
    function: {
      name: 'tts',
      description: 'Reads text aloud using text-to-speech. Used when the user asks to read something or requests voice output.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to read aloud',
          },
          language: {
            type: 'string',
            description: 'Language code (e.g. ko, en, ja)',
          },
        },
        required: ['text'],
      },
    },
  },

  // ===== News Tool =====
  {
    type: 'function',
    function: {
      name: 'news',
      description: 'Fetches the latest news. Used when the user asks about news or recent updates.',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            description: 'News topic (e.g. technology, sports, business)',
          },
          country: {
            type: 'string',
            description: 'Country code (e.g. kr, us, jp)',
          },
          count: {
            type: 'number',
            description: 'Number of news items to fetch (default: 5)',
          },
        },
      },
    },
  },

  // ===== Stock Tool =====
  {
    type: 'function',
    function: {
      name: 'stock',
      description: 'Gets stock price information. Used when the user asks about stock prices or stock info.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Stock symbol (e.g. AAPL, GOOGL, 005930.KS)',
          },
        },
        required: ['symbol'],
      },
    },
  },

  // ===== Cryptocurrency Tool =====
  {
    type: 'function',
    function: {
      name: 'crypto',
      description: 'Gets cryptocurrency price information. Used when the user asks about Bitcoin, Ethereum, or other coin prices.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Cryptocurrency symbol (e.g. BTC, ETH, XRP)',
          },
          currency: {
            type: 'string',
            description: 'Display currency (e.g. USD, KRW)',
          },
        },
        required: ['symbol'],
      },
    },
  },

  // ===== Translation Tool =====
  {
    type: 'function',
    function: {
      name: 'translate',
      description: 'Translates text to another language. Used when the user requests a translation.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'Text to translate',
          },
          targetLang: {
            type: 'string',
            description: 'Target language code (e.g. en, ko, ja, zh)',
          },
          sourceLang: {
            type: 'string',
            description: 'Source language code (omit for auto-detection)',
          },
        },
        required: ['text', 'targetLang'],
      },
    },
  },

  // ===== File System Tools =====
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Reads the contents of a file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path to read',
          },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Writes content to a file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path to write to',
          },
          content: {
            type: 'string',
            description: 'Content to write to the file',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'Lists the contents of a directory.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Directory path',
          },
        },
        required: ['path'],
      },
    },
  },

  // ===== Web Search Tool =====
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Searches the web for information. Used when the user wants to search for the latest info or a specific topic.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          count: {
            type: 'number',
            description: 'Number of search results (default: 5)',
          },
        },
        required: ['query'],
      },
    },
  },

  // ===== OCR Tool =====
  {
    type: 'function',
    function: {
      name: 'ocr',
      description: 'Extracts text from an image. Used when the user asks to read text from an image.',
      parameters: {
        type: 'object',
        properties: {
          imagePath: {
            type: 'string',
            description: 'Image file path or URL',
          },
          language: {
            type: 'string',
            description: 'Recognition language (e.g. kor, eng, jpn)',
          },
        },
        required: ['imagePath'],
      },
    },
  },
];

/**
 * Find a tool definition by name
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return SAYKNOWBOT_TOOLS.find(t => t.function.name === name);
}

/**
 * Get all tool names
 */
export function getToolNames(): string[] {
  return SAYKNOWBOT_TOOLS.map(t => t.function.name);
}
