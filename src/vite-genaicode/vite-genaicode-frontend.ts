import logo from '../../media/logo.png';
import { NotificationEvent, NotificationEventType } from './vite-genaicode-types.js';
import { contextManager } from './vite-genaicode-context.js';
import { ConsoleInterceptor } from '../main/ui/frontend/app/utils/console-interceptor.js';

interface GenAICodeOverlayState {
  isExpanded: boolean;
  dragStartX: number;
  dragStartY: number;
  isDragging: boolean;
  wasDragged: boolean;
  unreadCount: number;
  isFocused: boolean;
  lastShakeTime: number;
}

// Create a custom element for the GenAICode overlay
class GenAICodeOverlay extends HTMLElement {
  private state: GenAICodeOverlayState;
  private shakeTimeout?: number;
  private readonly SHAKE_COOLDOWN = 3000; // ms between shakes

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.state = {
      isExpanded: false,
      dragStartX: 0,
      dragStartY: 0,
      isDragging: false,
      wasDragged: false,
      unreadCount: 0,
      isFocused: true,
      lastShakeTime: 0,
    };
  }

  connectedCallback() {
    this.render();
    this.setupMessageHandlers();
    this.setupEventListeners();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.handleMessage);
    if (this.shakeTimeout) {
      window.clearTimeout(this.shakeTimeout);
    }
  }

  getShadowRoot() {
    return this.shadowRoot!;
  }

  getButton() {
    return this.getShadowRoot().querySelector('.button') as HTMLButtonElement;
  }

  getOverlay() {
    return this.getShadowRoot().querySelector('.overlay') as HTMLDivElement;
  }

  getIframe() {
    return this.getShadowRoot().querySelector('iframe') as HTMLIFrameElement;
  }

  render() {
    const styles = `
      :host {
        position: fixed;
        z-index: 9999;
        font-family: Arial, sans-serif;
      }
      .button {
        position: fixed;
        right: 20px;
        bottom: 20px;
        width: 100px;
        height: 100px;
        background-image: url(${logo});
        background-size: 170px;
        background-repeat: no-repeat;
        background-position: center;
        cursor: pointer;
        user-select: none;
        transition: transform 0.3s ease;
        border-radius: 50%;
      }
      .button:hover {
        transform: scale(1.05);
      }
      .button.shake {
        animation: shake 0.5s cubic-bezier(.36,.07,.19,.97) both;
        transform: translate3d(0, 0, 0);
        backface-visibility: hidden;
        perspective: 1000px;
      }
      @keyframes shake {
        10%, 90% {
          transform: translate3d(-1px, 0, 0);
        }
        20%, 80% {
          transform: translate3d(2px, 0, 0);
        }
        30%, 50%, 70% {
          transform: translate3d(-4px, 0, 0);
        }
        40%, 60% {
          transform: translate3d(4px, 0, 0);
        }
      }
      .button .notification-badge {
        position: absolute;
        top: 0;
        right: 0;
        background-color: #ff4444;
        color: white;
        border-radius: 50%;
        min-width: 24px;
        height: 24px;
        padding: 0 6px;
        font-size: 14px;
        line-height: 24px;
        text-align: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        transform: translate(30%, -30%);
        transition: transform 0.2s ease;
        font-weight: bold;
      }
      .overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background-color: rgba(0, 0, 0, 0.5);
        display: none;
        justify-content: center;
        align-items: center;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .overlay.expanded {
        display: flex;
        opacity: 1;
      }
      .content {
        width: 90%;
        height: 90%;
        background-color: white;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 0 20px rgba(0,0,0,0.3);
        transform: scale(0.95);
        transition: transform 0.3s ease;
      }
      .overlay.expanded .content {
        transform: scale(1);
      }
      iframe {
        border: none;
        width: 100%;
        height: 100%;
      }
    `;

    const genaicodePort =
      (document.querySelector('[data-genaicode-port]') as HTMLElement)?.dataset['genaicodePort'] || '3000';

    this.getShadowRoot().innerHTML = `
      <style>${styles}</style>
      <div class="button"></div>
      <div class="overlay">
        <div class="content">
          <iframe src="http://localhost:${genaicodePort}" allow="clipboard-write autoplay"></iframe>
        </div>
      </div>
    `;
  }

  private updateBadge() {
    this.getButton().innerHTML =
      this.state.unreadCount > 0 ? `<div class="notification-badge">${this.state.unreadCount}</div>` : '';
  }

  private setupMessageHandlers() {
    this.handleMessage = this.handleMessage.bind(this);
    window.addEventListener('message', this.handleMessage);
  }

  private handleMessage(event: MessageEvent<NotificationEvent>) {
    // Verify message origin
    if (!event.origin.startsWith('http://localhost')) {
      return;
    }

    // Verify it's a GenAIcode message
    if (event.data?.source !== 'genaicode') {
      return;
    }

    const { type, payload } = event.data;

    switch (type) {
      case NotificationEventType.NEW_MESSAGES:
        this.handleNewMessages(payload.count || 0);
        break;
      case NotificationEventType.FOCUS:
        this.handleFocusChange(true);
        break;
      case NotificationEventType.BLUR:
        this.handleFocusChange(false);
        break;
      case NotificationEventType.RESET_NOTIFICATIONS:
        this.resetNotifications();
        break;
    }
  }

  private handleNewMessages(count: number) {
    if (this.state.isExpanded || this.state.isFocused) {
      return; // Don't show notifications when expanded or focused
    }

    this.state.unreadCount += count;
    this.updateBadge(); // Update badge
    this.triggerShakeAnimation();
  }

  private handleFocusChange(isFocused: boolean) {
    this.state.isFocused = isFocused;
    if (isFocused) {
      this.resetNotifications();
    }
  }

  private resetNotifications() {
    if (this.state.unreadCount > 0) {
      this.state.unreadCount = 0;
      this.updateBadge();
    }
  }

  private triggerShakeAnimation() {
    const now = Date.now();
    if (now - this.state.lastShakeTime < this.SHAKE_COOLDOWN) {
      return; // Prevent too frequent shaking
    }

    const button = this.getButton();
    button.classList.remove('shake');
    // Force reflow to restart animation
    void button.offsetWidth;
    button.classList.add('shake');

    this.state.lastShakeTime = now;

    // Remove shake class after animation
    if (this.shakeTimeout) {
      window.clearTimeout(this.shakeTimeout);
    }
    this.shakeTimeout = window.setTimeout(() => {
      button.classList.remove('shake');
    }, 500);
  }

  setupEventListeners() {
    const button = this.getButton();
    const overlay = this.getOverlay();

    button.addEventListener('mousedown', this.startDragging.bind(this));
    document.addEventListener('mousemove', this.drag.bind(this));
    document.addEventListener('mouseup', this.stopDragging.bind(this));

    button.addEventListener('click', () => {
      if (!this.state.isDragging && !this.state.wasDragged) {
        this.toggleOverlay();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.toggleOverlay();
      }
    });

    // Handle iframe focus events
    const iframe = this.getIframe();
    iframe.addEventListener('load', () => {
      // Send initial focus state
      this.sendMessageToIframe({
        type: this.state.isFocused ? NotificationEventType.FOCUS : NotificationEventType.BLUR,
        payload: { isFocused: this.state.isFocused },
        source: 'genaicode',
      });
    });
  }

  private sendMessageToIframe(message: NotificationEvent) {
    try {
      const iframe = this.getIframe();
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(message, 'http://localhost');
      }
    } catch (error) {
      console.warn('Failed to send message to iframe:', error);
    }
  }

  startDragging(e: MouseEvent) {
    this.state.wasDragged = false;
    this.state.isDragging = true;
    const button = this.getButton();
    const rect = button.getBoundingClientRect();
    this.state.dragStartX = e.clientX - rect.left;
    this.state.dragStartY = e.clientY - rect.top;
  }

  drag(e: MouseEvent) {
    if (!this.state.isDragging) return;

    this.state.wasDragged = true;
    const button = this.getButton();
    const newX = e.clientX - this.state.dragStartX;
    const newY = e.clientY - this.state.dragStartY;

    // Constrain to viewport
    const maxX = window.innerWidth - button.offsetWidth;
    const maxY = window.innerHeight - button.offsetHeight;

    button.style.left = `${Math.max(0, Math.min(newX, maxX))}px`;
    button.style.top = `${Math.max(0, Math.min(newY, maxY))}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
    button.style.cursor = 'move';
  }

  stopDragging() {
    this.state.isDragging = false;
    this.getButton().style.cursor = 'pointer';
  }

  toggleOverlay() {
    this.state.isExpanded = !this.state.isExpanded;
    const overlay = this.getOverlay();
    const button = this.getButton();

    if (this.state.isExpanded) {
      overlay.classList.add('expanded');
      button.style.display = 'none';
      this.resetNotifications();
    } else {
      overlay.classList.remove('expanded');
      button.style.display = 'block';
    }

    // Notify iframe about visibility change
    this.sendMessageToIframe({
      type: this.state.isExpanded ? NotificationEventType.FOCUS : NotificationEventType.BLUR,
      payload: { isFocused: this.state.isExpanded },
      source: 'genaicode',
    });
  }
}

// Register the custom element
customElements.define('genaicode-overlay', GenAICodeOverlay);

// Create and append the overlay to the document body
document.body.appendChild(document.createElement('genaicode-overlay'));

// Initialize console interception if app context is enabled
const scriptTag = document.querySelector('[data-genaicode-app-context-enabled]') as HTMLElement;
if (scriptTag?.dataset['genaicodeAppContextEnabled'] === 'true') {
  const maxSize = parseInt(scriptTag.dataset['genaicodeLogBufferMaxSize'] || '1000', 10);
  new ConsoleInterceptor(maxSize, async (logs) => {
    await contextManager.setContext('__console_logs', logs);
  });
  console.log('GenAIcode: Console log interception enabled.');
}
