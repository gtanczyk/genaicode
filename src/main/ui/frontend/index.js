/* eslint-env browser */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/genaicode-app.js';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(React.createElement(App, null));
