import logo from '../../media/logo.png';

// Create a custom element for the GenAICode overlay
class GenAICodeOverlay extends HTMLElement {
  isExpanded: boolean;
  dragStartX: number;
  dragStartY: number;
  isDragging: boolean;
  wasDragged: boolean;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.isExpanded = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.isDragging = false;
    this.wasDragged = false;
  }

  connectedCallback() {
    this.render();
    this.setupEventListeners();
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
      }
      .button:hover {
        transform: scale(1.05);
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
      }
      .overlay.expanded {
        display: flex;
      }
      .content {
        width: 90%;
        height: 90%;
        background-color: white;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 0 20px rgba(0,0,0,0.3);
      }
      iframe {
        border: none;
        width: 100%;
        height: 100%;
      }
    `;

    const genaicodePort = (document.querySelector('[data-genaicode-port]') as HTMLElement).dataset['genaicodePort'];

    this.getShadowRoot().innerHTML = `
      <style>${styles}</style>
      <div class="button"></div>
      <div class="overlay">
        <div class="content">
          <iframe src="http://localhost:${genaicodePort}"></iframe>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const button = this.getButton();
    const overlay = this.getOverlay();

    button.addEventListener('mousedown', this.startDragging.bind(this));
    document.addEventListener('mousemove', this.drag.bind(this));
    document.addEventListener('mouseup', this.stopDragging.bind(this));

    button.addEventListener('click', () => {
      if (!this.isDragging && !this.wasDragged) {
        this.toggleOverlay();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.toggleOverlay();
      }
    });
  }

  startDragging(e: MouseEvent) {
    this.wasDragged = false;
    this.isDragging = true;
    this.dragStartX = e.clientX - this.getButton().offsetLeft;
    this.dragStartY = e.clientY - this.getButton().offsetTop;
  }

  drag(e: MouseEvent) {
    if (this.isDragging) {
      this.wasDragged = true;
      const button = this.getButton();
      const newX = e.clientX - this.dragStartX;
      const newY = e.clientY - this.dragStartY;
      button.style.left = `${newX}px`;
      button.style.top = `${newY}px`;
      button.style.cursor = 'move';
    }
  }

  stopDragging() {
    this.isDragging = false;
    this.getButton().style.cursor = 'pointer';
  }

  toggleOverlay() {
    this.isExpanded = !this.isExpanded;
    this.getOverlay().classList.toggle('expanded', this.isExpanded);
    this.getButton().style.display = this.isExpanded ? 'none' : 'block';
  }
}

// Register the custom element
customElements.define('genaicode-overlay', GenAICodeOverlay);

// Create and append the overlay to the document body
document.body.appendChild(document.createElement('genaicode-overlay'));
