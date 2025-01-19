// Type definitions for GenAIcode context
interface GenAIcodeContext {
  setContext<T = unknown>(key: string, value: T): Promise<void>;
  getContext<T = unknown>(key: string): Promise<T | undefined>;
  clearContext(key?: string): Promise<void>;
}

// Error class for context operations
class ContextError extends Error {
  constructor(message: string) {
    super(`GenAIcode Context Error: ${message}`);
    this.name = 'ContextError';
  }
}

/**
 * Implementation of the GenAIcode context management
 */
class GenAIcodeContextManager implements GenAIcodeContext {
  getPort(): number {
    const portAttr = (document.querySelector('[data-genaicode-port]') as HTMLElement).dataset['genaicodePort'];
    if (!portAttr) {
      throw new ContextError('GenAIcode port not found in the document');
    }
    return parseInt(portAttr);
  }

  getToken(): string {
    const tokenAttr = (document.querySelector('[data-genaicode-token]') as HTMLElement).dataset['genaicodeToken'];
    if (!tokenAttr) {
      throw new ContextError('GenAIcode token not found in the document');
    }
    return tokenAttr;
  }

  /**
   * Sets a context value
   * @param key - The context key
   * @param value - The value to store
   */
  async setContext<T = unknown>(key: string, value: T): Promise<void> {
    try {
      // Notify the GenAIcode server about context update
      try {
        await fetch(`http://localhost:${this.getPort()}/api/app-context/${key}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.getToken()}`,
          },
          body: JSON.stringify({ value }),
        });
      } catch (error) {
        console.warn('Failed to notify GenAIcode server about context update:', error);
        // Don't throw here - the local storage update was successful
      }
    } catch (error) {
      if (error instanceof ContextError) {
        throw error;
      }
      throw new ContextError(`Failed to set context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets a context value
   * @param key - The context key
   * @returns The stored value, or undefined if not found
   */
  async getContext<T = unknown>(key: string): Promise<T | undefined> {
    try {
      const { value } = await fetch(`http://localhost:${this.getPort()}/api/app-context/${key}`, {
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
        },
      }).then((res) => res.json());
      return value as T;
    } catch (error) {
      console.error('Failed to get context:', error);
      return undefined;
    }
  }

  /**
   * Clears context value(s)
   * @param key - Optional key to clear specific context. If not provided, clears all context.
   */
  async clearContext(key?: string): Promise<void> {
    try {
      if (key) {
        // Notify the GenAIcode server about context removal
        try {
          await fetch(`http://localhost:${this.getPort()}/api/app-context/${key}`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${this.getToken()}`,
            },
          });
        } catch (error) {
          console.warn('Failed to notify GenAIcode server about context removal:', error);
        }
      } else {
        // Notify the GenAIcode server about clearing all context
        try {
          await fetch(`http://localhost:${this.getPort()}/api/app-context`, {
            method: 'DELETE',
            headers: {
              Authorization: `Bearer ${this.getToken()}`,
            },
          });
        } catch (error) {
          console.warn('Failed to notify GenAIcode server about context clear:', error);
        }
      }
    } catch (error) {
      if (error instanceof ContextError) {
        throw error;
      }
      throw new ContextError(`Failed to clear context: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Create and export the context manager instance
export const contextManager = new GenAIcodeContextManager();
