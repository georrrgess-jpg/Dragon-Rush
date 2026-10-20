import './style.css';
import './ui.css';
import './ui/hatchery.css';

const params = new URLSearchParams(location.search);
if (params.has('gallery')) {
  void import('./ui/gallery').then((m) => m.runGallery());
} else if (params.has('backgrounds')) {
  void import('./ui/bgPreview').then((m) => m.runBackgroundPreview());
} else {
  void import('./app').then(({ App }) => {
    const app = new App();
    // Exposed for manual inspection in dev tools and automated smoke checks.
    (window as unknown as { __emberwild: unknown }).__emberwild = app;
  });
}
