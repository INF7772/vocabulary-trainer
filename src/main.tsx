import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './app/App';
import './i18n';
import './styles/index.css';
import { installBuiltInDemoLesson } from './services/demo-content';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Application root element was not found.');
}

const shouldInstallPresentationDemo =
  new URLSearchParams(window.location.search).get("demo") === "1";

void (shouldInstallPresentationDemo
  ? installBuiltInDemoLesson()
  : Promise.resolve())
  .catch((error: unknown) => {
    console.warn("The built-in demo lesson could not be prepared.", error);
  })
  .finally(() => {
    ReactDOM.createRoot(rootElement).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
