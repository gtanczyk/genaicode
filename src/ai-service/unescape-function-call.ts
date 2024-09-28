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
function unescapeObject(obj: unknown, key?: string): unknown {
  if (typeof obj === 'string') {
    let unescaped = unescapeString(obj);
    if (key === 'filePath' && unescaped.match(/^"(.+)"$/)) {
      unescaped = unescaped.substring(1, unescaped.length - 1);
    }
    return unescaped;
  }
  if (Array.isArray(obj)) {
    return obj.map((value) => unescapeObject(value, key === 'contextPaths' ? 'filePath' : ''));
  }
  if (typeof obj === 'object' && obj !== null) {
    return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, unescapeObject(value, key)]));
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
