(() => {
  const launcherId = "fremium-floating-launcher";
  const createLauncher = () => {
    let button = document.getElementById(launcherId);
    if (button) return button;
    button = document.createElement("button");
    button.id = launcherId;
    button.className = "fremium-floating-launcher";
    button.title = "Open full Fremium window";
    button.textContent = "◈";
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
