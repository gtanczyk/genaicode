import { FunctionCall } from './common';

/**
 * Unescapes a c-escaped string
 * @param str The string to unescape
 * @returns The unescaped string
 */
function unescapeString(str: string): string {
  return str.replace(/\\(.)/g, (_, char) => {
    switch (char) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '"':
        return '"';
      case "'":
        return "'";
      case '\\':
        return '\\';
      default:
        return char;
    }
  });
}

/**
 * Recursively unescapes all string values in an object
 * @param obj The object to unescape
 * @returns The unescaped object
 */
function unescapeObject(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return unescapeString(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(unescapeObject);
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, unescapeObject(value)]));
  }
  return obj;
}

/**
 * Unescapes c-escaped strings in a function call object
 * @param functionCall The function call object to unescape
 * @returns The unescaped function call object
 */
export function unescapeFunctionCall(functionCall: FunctionCall): FunctionCall {
  return {
    ...functionCall,
    name: unescapeString(functionCall.name),
    args: unescapeObject(functionCall.args) as Record<string, unknown>,
  };
}
