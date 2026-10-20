import './style.css';
import { App } from './app';

const app = new App();
// Exposed for manual inspection in dev tools and automated smoke checks.
(window as unknown as { __emberwild: App }).__emberwild = app;
