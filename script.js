'use strict';
document.documentElement.classList.add('js');
const toggle = document.querySelector('.menu-toggle');
const navigation = document.getElementById('navigation');
if (toggle && navigation) {
  const setOpen = (open, restoreFocus = false) => {
    toggle.setAttribute('aria-expanded', String(open));
    navigation.dataset.open = String(open);
    if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
  navigation.querySelectorAll('a').forEach(link => link.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') setOpen(false, true);
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.site-header')) setOpen(false);
  });
  const wide = matchMedia('(min-width: 761px)');
  wide.addEventListener('change', () => setOpen(false));
}

(() => {
  const form = document.getElementById('wholesale-form');
  if (!form) return;
  const cfg = window.CAPRAZ_CONTACT || {};
  const local = cfg.localPreview === true && ['localhost', '127.0.0.1'].includes(location.hostname);
  const button = form.querySelector('button[type=submit]');
  const fields = document.getElementById('inquiry-fields');
  const error = document.getElementById('inquiry-error');
  const success = document.getElementById('inquiry-success');
  const note = document.getElementById('form-availability');
  const verificationBox = document.getElementById('inquiry-verification');
  let configured = local && cfg.endpoint === '/local/contact';
  if (!local && cfg.endpoint) {
    try {
      const url = new URL(cfg.endpoint);
      configured = url.protocol === 'https:' && url.pathname === '/contact' &&
        !url.username && !url.password && !url.search && !url.hash;
    } catch { configured = false; }
  }
  configured = configured && typeof cfg.siteKey === 'string' && !!cfg.siteKey.trim();
  // Cloudflare's public test key is restricted to the local preview.
  if (!local && /^[123]x0+/.test(cfg.siteKey || '')) configured = false;
  let phase = 'idle', lastPayload = '', requestId = '', token = '';
  let widgetId = null, generation = 0, widgetSize = '', verificationError = false;
  const showError = message => { error.textContent = message; error.hidden = false; };
  const ready = () => {
    fields.disabled = !configured || phase === 'sending';
    button.disabled = !configured || !token || phase !== 'idle';
    form.setAttribute('aria-busy', String(phase === 'sending'));
  };
  const removeWidget = () => {
    generation++;
    token = '';
    if (widgetId !== null && window.turnstile) window.turnstile.remove(widgetId);
    widgetId = null;
  };
  const sizeForWidth = () => verificationBox.clientWidth < 300 ? 'compact' : 'flexible';
  const renderWidget = () => {
    if (!configured || phase !== 'idle' || !window.turnstile) return;
    removeWidget();
    const current = generation;
    widgetSize = sizeForWidth();
    try {
      widgetId = window.turnstile.render(verificationBox, {
        sitekey: cfg.siteKey,
        action: 'wholesale_contact',
        theme: 'light',
        language: 'en',
        size: widgetSize,
        'response-field': false,
        callback: value => {
          if (current !== generation || phase !== 'idle') return;
          token = value;
          if (verificationError) { error.hidden = true; verificationError = false; }
          ready();
        },
        'expired-callback': () => {
          if (current !== generation || phase !== 'idle') return;
          token = '';
          ready();
        },
        'error-callback': () => {
          if (current !== generation || phase !== 'idle') return;
          token = '';
          verificationError = true;
          showError('Verification could not load. Please check your connection or email us directly.');
          ready();
        },
        'timeout-callback': () => {
          if (current !== generation || phase !== 'idle') return;
          token = '';
          ready();
        }
      });
    } catch {
      verificationError = true;
      showError('Verification is temporarily unavailable. Please email us directly.');
    }
    ready();
  };
  note.textContent = local ? 'Local preview — test submissions do not send email.' :
    configured ? '' : 'The form is temporarily unavailable. Please email support@caprazllc.com.';
  ready();
  if (configured) {
    window.caprazTurnstileReady = renderWidget;
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=caprazTurnstileReady&render=explicit';
    script.async = true;
    script.onerror = () => {
      verificationError = true;
      showError('Verification could not load. Please check your connection or email us directly.');
    };
    document.head.append(script);
    new ResizeObserver(() => {
      if (phase === 'idle' && widgetId !== null && widgetSize !== sizeForWidth()) renderWidget();
    }).observe(verificationBox);
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!configured || !token || phase !== 'idle') return;
    if (!form.reportValidity()) return;
    const entries = new FormData(form);
    const values = Object.fromEntries(['name', 'company', 'email', 'website', 'message', 'companyFax'].map(key => [key, entries.get(key) || '']));
    // Token refreshes do not change Resend's idempotency key for unchanged content.
    const fingerprint = JSON.stringify(values);
    if (fingerprint !== lastPayload) {
      requestId = crypto.randomUUID();
      lastPayload = fingerprint;
    }
    const verificationToken = token;
    error.hidden = true;
    verificationError = false;
    phase = 'sending';
    removeWidget();
    ready();
    button.querySelector('span').textContent = 'Sending…';
    try {
      const response = await fetch(cfg.endpoint, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, requestId, token: verificationToken }),
        signal: AbortSignal.timeout(22000)
      });
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (!response.ok || result?.ok !== true) {
        const message = response.status === 429 ?
          'Too many attempts. Please wait a minute before trying again, or email us directly.' :
          result?.message || 'We could not confirm submission. Your message is still here. Please email us before retrying.';
        throw Object.assign(new Error('submission'), { userMessage: message });
      }
      phase = 'success';
      form.hidden = true;
      success.hidden = false;
      document.getElementById('inquiry-success-copy').textContent = local ?
        'Local test completed. No email was sent.' : 'Your inquiry has been submitted to CAPRAZ LLC.';
      success.focus();
      success.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
    } catch (err) {
      phase = 'idle';
      showError(err.userMessage || 'Submission could not be confirmed. Your message is still here. Please email us before retrying.');
      renderWidget();
    } finally {
      button.querySelector('span').textContent = 'Send inquiry';
      ready();
    }
  });
  document.getElementById('new-inquiry').addEventListener('click', () => {
    form.reset();
    lastPayload = '';
    requestId = '';
    verificationError = false;
    error.hidden = true;
    phase = 'idle';
    success.hidden = true;
    form.hidden = false;
    renderWidget();
    ready();
    form.querySelector('input').focus();
  });
})();
