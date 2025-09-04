(function(){
  const currentScript = document.currentScript || (function(){
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const cfg = {
    appUrl: currentScript.getAttribute('data-app-url') || 'https://<your-vercel-app>.vercel.app/app/index.html',
    retailer: currentScript.getAttribute('data-retailer') || '',
    theme: currentScript.getAttribute('data-theme') || 'light',
    budget: currentScript.getAttribute('data-budget') || '',
    buttonSelector: currentScript.getAttribute('data-button') || '[data-bike-widget]'
  };

  let modal, iframe, backdrop;

  function ensureModal(){
    if (modal) return;

    backdrop = document.createElement('div');
    backdrop.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,.45);
      opacity:0;transition:opacity .18s ease;z-index:999999998;display:none;`;
    modal = document.createElement('div');
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.style.cssText = `
      position:fixed;inset:5%;background:#fff;border-radius:12px;
      box-shadow:0 20px 60px rgba(0,0,0,.25);z-index:999999999;display:none;overflow:hidden;`;
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label','Close');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
      position:absolute;top:8px;right:12px;width:36px;height:36px;
      border:none;background:transparent;font-size:28px;cursor:pointer;z-index:1;`;
    closeBtn.addEventListener('click', close);

    iframe = document.createElement('iframe');
    iframe.title = 'Bike Match';
    iframe.allow = 'clipboard-write; fullscreen';
    iframe.style.cssText = `width:100%;height:100%;border:0;`;

    modal.appendChild(iframe);
    modal.appendChild(closeBtn);
    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    window.addEventListener('message', (e) => {
      if (!e.data || !e.data.type) return;
      if (e.data.type === 'widget:close') close();
      // host can listen for others (loaded, resultsShown, purchaseClick)
    }, false);
  }

  function open(params = {}){
    ensureModal();
    const qs = new URLSearchParams({
      retailer: cfg.retailer,
      theme: cfg.theme,
      budget: cfg.budget,
      ...params
    }).toString();
    iframe.src = `${cfg.appUrl}${cfg.appUrl.includes('?') ? '&' : '?'}${qs}`;
    backdrop.style.display = 'block';
    modal.style.display = 'block';
    requestAnimationFrame(() => { backdrop.style.opacity = '1'; });
    document.body.style.overflow = 'hidden';
    dispatch('widget:open');
  }

  function close(){
    if (!modal) return;
    backdrop.style.opacity = '0';
    setTimeout(() => {
      backdrop.style.display = 'none';
      modal.style.display = 'none';
      iframe.src = 'about:blank';
      document.body.style.overflow = '';
    }, 180);
    dispatch('widget:close');
  }

  function dispatch(type, payload){ window.dispatchEvent(new CustomEvent('bike-widget', { detail: { type, payload }})); }

  window.BikeWidget = { open, close };

  function bindButtons(){
    ensureModal();
    const nodes = document.querySelectorAll(cfg.buttonSelector);
    nodes.forEach(btn => {
      if (btn.__bikeWidgetBound) return;
      btn.__bikeWidgetBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        open({
          budget: btn.getAttribute('data-budget') || undefined,
          use_case: btn.getAttribute('data-usecase') || undefined
        });
      });
    });
  }

  const mo = new MutationObserver(bindButtons);
  mo.observe(document.documentElement, { childList:true, subtree:true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindButtons); else bindButtons();
})();
