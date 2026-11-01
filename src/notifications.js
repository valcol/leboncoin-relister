// ============================================================================
// NOTIFICATION MANAGER
// ============================================================================

import { escapeHtml } from './utils.js';
import { CONFIG } from './config.js';
import iconImage from '../icons/icon-48.png';

export const NotificationManager = {
  create(config) {
    const notification = document.createElement('div');

    notification.id = config.id;
    notification.style.cssText = `
      background: #2b2d31;
      color: ${config.color || '#e4e4e7'};
      padding: 12px 16px;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      font-weight: 500;
      border-left: 3px solid ${config.borderColor || '#6b7280'};
      max-width: 320px;
      line-height: 1.4;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    `;

    // Icon is imported as base64 data URL at build time
    notification.innerHTML = `
      <img src="${iconImage}" width="20" height="20" style="flex-shrink: 0; margin-top: 1px; border-radius: 4px;" alt="LBC" />
      <div style="flex: 1;">${config.content}</div>
      ${config.dismissible ? `
        <button
          data-lbc-dismiss
          type="button"
          title="Fermer"
          style="background: none; border: none; padding: 0; color: #a1a1aa; font-size: 16px; line-height: 1; cursor: pointer;">×</button>
      ` : ''}
    `;

    notification.querySelector('[data-lbc-dismiss]')?.addEventListener('click', () => notification.remove());

    return notification;
  },

  // Notifications stack in a shared top-right column instead of overlapping
  container() {
    let container = document.getElementById('lbc-notifications');

    if (!container) {
      container = document.createElement('div');
      container.id = 'lbc-notifications';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
      `;
      document.body.appendChild(container);
    }

    return container;
  },

  show(notification) {
    this.container().appendChild(notification);

    return notification;
  },

  remove(id) {
    const notification = document.getElementById(id);

    notification?.remove();
  },

  removeMultiple(...ids) {
    ids.forEach(id => this.remove(id));
  },

  fadeOut(element, delayMs) {
    setTimeout(() => {
      element.style.transition = 'opacity 0.3s';
      element.style.opacity = '0';
      setTimeout(() => element.remove(), CONFIG.delays.fadeOut);
    }, delayMs);
  },

  loading(message = 'Chargement...') {
    return this.create({
      id: 'lbc-loading',
      borderColor: '#ff8a4a',
      color: '#e4e4e7',
      content: message
    });
  },

  deleting() {
    return this.create({
      id: 'lbc-deleting',
      borderColor: '#ec5a13',
      color: '#e4e4e7',
      content: 'Suppression de l\'ancienne annonce...'
    });
  },

  publishing() {
    return this.create({
      id: 'lbc-publishing',
      borderColor: '#ff8a4a',
      color: '#e4e4e7',
      content: 'Publication de la nouvelle annonce...'
    });
  },

  creatingDraft() {
    return this.create({
      id: 'lbc-drafting',
      borderColor: '#ff8a4a',
      color: '#e4e4e7',
      content: 'Création du brouillon...'
    });
  },

  draftSuccess(draftUrl) {
    return this.create({
      id: 'lbc-draft-success',
      borderColor: '#10b981',
      color: '#e4e4e7',
      content: `
        <div style="font-weight: 600; margin-bottom: 6px;">Brouillon créé</div>
        <div style="font-size: 12px; color: #a1a1aa;">
          L'annonce originale reste en ligne.
          <a href="${escapeHtml(draftUrl)}" target="_blank" style="color: #ff8a4a; text-decoration: underline;">Ouvrir le brouillon</a>
        </div>
      `
    });
  },

  success(adId) {
    return this.create({
      id: 'lbc-success',
      borderColor: '#10b981',
      color: '#e4e4e7',
      content: `
        <div style="font-weight: 600; margin-bottom: 6px;">Republication réussie</div>
        <div style="font-size: 12px; color: #a1a1aa;">
          Annonce #${escapeHtml(String(adId))} créée avec succès, rafraîchissez la page.
        </div>
      `
    });
  },

  bulkProgress(current, total, title) {
    return this.create({
      id: 'lbc-bulk-progress',
      borderColor: '#ff8a4a',
      color: '#e4e4e7',
      content: `
        <div style="font-weight: 600; margin-bottom: 6px;">Republication ${current}/${total}...</div>
        <div style="font-size: 12px; color: #a1a1aa;">${escapeHtml(title)}</div>
      `
    });
  },

  // drafts: [{ title, url }] linked so they can be opened; failedTitles: ads skipped with failureHint
  bulkSummary({ title, drafts, failureHint, failedTitles, refreshHint }) {
    const hasFailures = failedTitles.length > 0;
    const list = (items) => `<ul style="margin: 4px 0; padding-left: 16px;">${items.join('')}</ul>`;

    return this.create({
      id: 'lbc-bulk-summary',
      borderColor: hasFailures ? '#ec5a13' : '#10b981',
      color: '#e4e4e7',
      dismissible: true,
      content: `
        <div style="font-weight: 600; margin-bottom: 6px;">${escapeHtml(title)}</div>
        <div style="font-size: 12px; color: #a1a1aa;">
          ${drafts.length > 0 ? list(drafts.map(draft => `
            <li><a href="${escapeHtml(draft.url)}" target="_blank" style="color: #ff8a4a; text-decoration: underline;">${escapeHtml(draft.title)}</a></li>
          `)) : ''}
          ${hasFailures ? `${escapeHtml(failureHint)}${list(failedTitles.map(failedTitle => `<li>${escapeHtml(failedTitle)}</li>`))}` : ''}
          ${refreshHint ? 'Rafraîchissez la page.' : ''}
        </div>
      `
    });
  },

  error(message) {
    return this.create({
      id: 'lbc-error',
      borderColor: '#ef4444',
      color: '#e4e4e7',
      content: `
        <div style="font-weight: 600; margin-bottom: 6px;">Erreur</div>
        <div style="font-size: 12px; color: #a1a1aa;">${escapeHtml(message)}</div>
      `
    });
  },

  info(message) {
    return this.create({
      id: 'lbc-info',
      borderColor: '#6b7280',
      color: '#e4e4e7',
      content: escapeHtml(message)
    });
  }
};

