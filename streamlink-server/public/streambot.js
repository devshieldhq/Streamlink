(() => {
  if (window.__STREAMBOT_WIDGET__) return;
  window.__STREAMBOT_WIDGET__ = true;

  const root = document.createElement('div');
  root.id = 'streambot-root';
  root.innerHTML = `
    <section id="streambot-panel" role="dialog" aria-label="Chat with StreamBot" aria-modal="false">
      <header id="streambot-head">
        <div id="streambot-avatar" aria-hidden="true">S</div>
        <div id="streambot-heading"><strong>StreamBot</strong><small>StreamLink XR assistant</small></div>
        <button id="streambot-close" type="button" aria-label="Close StreamBot">×</button>
      </header>
      <div id="streambot-status" aria-live="polite">Connecting to StreamLink…</div>
      <div id="streambot-messages" role="log" aria-live="polite"></div>
      <div id="streambot-suggestions">
        <button type="button" data-prompt="What can StreamLink XR do?">Explore StreamLink</button>
        <button type="button" data-prompt="How do I start a multistream?">Start streaming</button>
        <button type="button" data-prompt="Show me the latest StreamLink updates.">Latest updates</button>
      </div>
      <form id="streambot-form">
        <textarea id="streambot-input" rows="1" maxlength="1200" placeholder="Ask StreamBot anything…" aria-label="Message StreamBot"></textarea>
        <button id="streambot-send" type="submit">Send</button>
      </form>
      <div id="streambot-foot">Never share passwords, stream keys or recovery phrases in chat.</div>
    </section>
    <button id="streambot-toggle" type="button" aria-label="Open StreamBot" aria-expanded="false">S</button>
  `;
  document.body.appendChild(root);

  const panel = root.querySelector('#streambot-panel');
  const toggle = root.querySelector('#streambot-toggle');
  const close = root.querySelector('#streambot-close');
  const status = root.querySelector('#streambot-status');
  const messagesEl = root.querySelector('#streambot-messages');
  const form = root.querySelector('#streambot-form');
  const input = root.querySelector('#streambot-input');
  const send = root.querySelector('#streambot-send');
  const suggestions = root.querySelector('#streambot-suggestions');
  const history = [];

  function addMessage(role, text, error = false) {
    const item = document.createElement('div');
    item.className = 'streambot-msg ' + (role === 'user' ? 'user' : 'bot') + (error ? ' error' : '');
    item.textContent = text;
    messagesEl.appendChild(item);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return item;
  }

  function setOpen(open) {
    panel.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Close StreamBot' : 'Open StreamBot');
    if (open) input.focus();
  }

  async function refreshStatus() {
    try {
      const res = await fetch('/api/streambot/status', { headers: { Accept: 'application/json' } });
      const data = await res.json();
      if (!res.ok) throw new Error('Status unavailable');
      status.textContent = data.configured
        ? '● Online'
        : '○ Setup required · API key not configured';
      status.style.color = data.configured ? '#70dfb0' : '#ffc77a';
      if (!messagesEl.childElementCount) {
        addMessage('bot', 'Hey! I’m StreamBot, your StreamLink XR assistant. I can help with setup, streaming, VR/XR, accounts and troubleshooting. What would you like to do?');
      }
    } catch (e) {
      status.textContent = 'Unable to reach StreamLink right now.';
    }
  }

  async function sendMessage(text) {
    const message = (text || '').trim();
    if (!message || send.disabled) return;
    addMessage('user', message);
    history.push({ role: 'user', content: message });
    input.value = '';
    send.disabled = true;
    send.textContent = '…';
    const pending = addMessage('assistant', 'StreamBot is thinking…');
    try {
      const response = await fetch('/api/streambot/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message, history: history.slice(-8, -1) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'StreamBot could not answer right now.');
      pending.textContent = data.reply || 'I could not create a response. Please try again.';
      history.push({ role: 'assistant', content: pending.textContent });
      while (history.length > 10) history.shift();
    } catch (error) {
      pending.textContent = error.message || 'StreamBot is temporarily unavailable.';
      pending.classList.add('error');
    } finally {
      send.disabled = false;
      send.textContent = 'Send';
      input.focus();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  toggle.addEventListener('click', () => setOpen(!panel.classList.contains('open')));
  close.addEventListener('click', () => setOpen(false));
  form.addEventListener('submit', event => {
    event.preventDefault();
    sendMessage(input.value);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  suggestions.addEventListener('click', event => {
    const button = event.target.closest('button[data-prompt]');
    if (button) sendMessage(button.dataset.prompt);
  });
  refreshStatus();
})();
