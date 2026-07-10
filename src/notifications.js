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
      position: fixed;
      top: 20px;
      right: 20px;
      background: #2b2d31;
      color: ${config.color || '#e4e4e7'};
      padding: 12px 16px;
      border-radius: 6px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      z-index: 999999;
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
    `;

    return notification;
  },

  show(notification) {
    document.body.appendChild(notification);

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

  draftSuccess() {
    return this.create({
      id: 'lbc-draft-success',
      borderColor: '#10b981',
      color: '#e4e4e7',
      content: `
        <div style="font-weight: 600; margin-bottom: 6px;">Brouillon créé</div>
        <div style="font-size: 12px; color: #a1a1aa;">
          Brouillon créé avec succès, rafraîchissez la page.
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

