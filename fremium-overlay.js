(() => {
  const launcherId = "fremium-floating-launcher";
  const logoSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" aria-hidden="true"><rect width="128" height="128" rx="20" fill="#101010"/><rect x="39" y="41" width="50" height="39" rx="8" fill="none" stroke="#a45c35" stroke-width="5"/><path d="M56 80v10M72 80v10M48 96h32" fill="none" stroke="#a45c35" stroke-width="5" stroke-linecap="round"/><circle cx="53" cy="60" r="3.5" fill="#a45c35"/><circle cx="64" cy="60" r="3.5" fill="#a45c35"/><circle cx="75" cy="60" r="3.5" fill="#a45c35"/></svg>';
  const createLauncher = () => {
    let button = document.getElementById(launcherId);
    if (button) {
      button.innerHTML = logoSvg;
      return button;
    }
    button = document.createElement("button");
    button.id = launcherId;
    button.className = "fremium-floating-launcher";
    button.title = "Open full Fremium window";
    button.innerHTML = logoSvg;
    button.onclick = () => {
      if (window.FremiumOpen) return window.FremiumOpen();
      const path = "/spicify-plugin";
      try {
        if (window.Spicetify?.Platform?.History?.location?.pathname !== path) {
          window.Spicetify.Platform.History.push(path);
        }
      } catch {}
    };
    document.body.appendChild(button);
    return button;
  };
  const wait = () => new Promise(resolve => {
    if (window.Spicetify?.ReactDOM) return resolve();
    const timer = setInterval(() => {
      if (window.Spicetify?.ReactDOM) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
  wait().then(() => {
    createLauncher();
    setInterval(createLauncher, 1500);
  });
})();
