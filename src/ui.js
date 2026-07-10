// ============================================================================
// UI & DOM MANAGEMENT
// ============================================================================

import { captureError, captureMessage, LEVELS } from './logger.js';
import { debounce, extractListId } from './utils.js';
import { NotificationManager } from './notifications.js';
import { fetchAdData, deleteAd, createAdViaAPI, createDraftViaAPI } from './api.js';
import { CONFIG } from './config.js';

// ============================================================================
// USER INTERACTION
// ============================================================================

const promptForNewPrice = (currentPrice) => {
  const pricePrompt = `Prix actuel: ${currentPrice} €\n\nEntrez le nouveau prix (en euros) ou laissez vide pour garder le prix actuel:`;
  const input = prompt(pricePrompt, currentPrice);

  if (input === null) {
    return null;
  }

  if (input.trim() === '') {
    return currentPrice;
  }

  const newPrice = parseFloat(input.trim());

  if (isNaN(newPrice) || newPrice <= 0) {
    throw new Error('Prix invalide. Veuillez entrer un nombre positif.');
  }

  return newPrice;
};

const confirmRepublish = (adData) => confirm(
  '✅ Prêt à republier:\n\n' +
    `📋 ${adData.subject}\n` +
    `💰 ${adData.price} €\n` +
    `📁 ${adData.category_name}\n\n` +
    'Lancer la republication automatique?'
);

const confirmDraft = (adData) => confirm(
  '📝 Créer un brouillon de:\n\n' +
    `📋 ${adData.subject}\n` +
    `💰 ${adData.price} €\n` +
    `📁 ${adData.category_name}\n\n` +
    'L\'annonce originale restera en ligne. Continuer?'
);

// ============================================================================
// REPUBLISH WORKFLOW
// ============================================================================

// Throttle state (module-scoped, persists for the page session across SPA nav)
let isBusy = false;
let nextAllowedAt = 0;
let consecutiveFailures = 0;

// Shared busy-guard / cooldown / backoff wrapper. workFn resolves to true when
// the action completed, false when the user cancelled (no cooldown applied).
const runThrottled = async (actionName, workFn) => {
  if (isBusy) {
    const busyNotif = NotificationManager.show(
      NotificationManager.info('Une action est déjà en cours, patientez…')
    );

    NotificationManager.fadeOut(busyNotif, CONFIG.delays.notificationFade);

    return;
  }

  const waitMs = nextAllowedAt - Date.now();

  if (waitMs > 0) {
    const cooldownNotif = NotificationManager.show(
      NotificationManager.info(`Patientez encore ${Math.ceil(waitMs / 1000)} s avant une nouvelle action.`)
    );

    NotificationManager.fadeOut(cooldownNotif, CONFIG.delays.notificationFade);

    return;
  }

  isBusy = true;

  try {
    const completed = await workFn();

    if (!completed) {
      return;
    }

    consecutiveFailures = 0;
    nextAllowedAt = Date.now() + CONFIG.throttle.cooldownMs + Math.random() * CONFIG.throttle.betweenStepsMaxMs;
  } catch (error) {
    console.error(`Erreur ${actionName}:`, error);
    captureError(error, {
      action: actionName,
      step: 'workflow'
    });

    consecutiveFailures += 1;
    const backoffMs = Math.min(
      CONFIG.throttle.backoffBaseMs * (2 ** (consecutiveFailures - 1)),
      CONFIG.throttle.backoffMaxMs
    );

    nextAllowedAt = Date.now() + (error.status === 403 ? CONFIG.throttle.backoffMaxMs : backoffMs);

    NotificationManager.removeMultiple('lbc-loading', 'lbc-deleting', 'lbc-publishing', 'lbc-drafting');

    const errorNotif = NotificationManager.show(NotificationManager.error(error.message));

    setTimeout(() => errorNotif.remove(), CONFIG.delays.notificationError);
  } finally {
    isBusy = false;
  }
};

const republishWorkflow = async (listId) => {
  console.log(`Republication de l'annonce ${listId}...`);
  captureMessage('Starting republish process', LEVELS.info);

  const loadingNotif = NotificationManager.show(NotificationManager.loading('Chargement des données...'));
  const adData = await fetchAdData(listId);

  loadingNotif.remove();

  const newPrice = promptForNewPrice(adData.price);

  if (newPrice === null) {
    captureMessage('Republish cancelled by user', LEVELS.info);

    return false;
  }

  const updatedAdData = { ...adData, price: newPrice };

  if (!confirmRepublish(updatedAdData)) {
    console.log('Republication annulée');
    captureMessage('Republish cancelled by user confirmation', LEVELS.info);

    return false;
  }

  const publishingNotif = NotificationManager.show(NotificationManager.publishing());
  const adId = await createAdViaAPI(updatedAdData);

  publishingNotif.remove();

  const deletingNotif = NotificationManager.show(NotificationManager.deleting());

  await deleteAd(listId);
  deletingNotif.remove();

  const successNotif = NotificationManager.show(NotificationManager.success(adId));

  NotificationManager.fadeOut(successNotif, CONFIG.delays.notificationFade);

  captureMessage('Republish completed successfully', LEVELS.info);

  return true;
};

const draftWorkflow = async (listId) => {
  console.log(`Création d'un brouillon pour l'annonce ${listId}...`);
  captureMessage('Starting draft process', LEVELS.info);

  const loadingNotif = NotificationManager.show(NotificationManager.loading('Chargement des données...'));
  const adData = await fetchAdData(listId);

  loadingNotif.remove();

  if (!confirmDraft(adData)) {
    console.log('Création du brouillon annulée');
    captureMessage('Draft cancelled by user confirmation', LEVELS.info);

    return false;
  }

  const draftingNotif = NotificationManager.show(NotificationManager.creatingDraft());

  await createDraftViaAPI(adData);
  draftingNotif.remove();

  const successNotif = NotificationManager.show(NotificationManager.draftSuccess());

  NotificationManager.fadeOut(successNotif, CONFIG.delays.notificationFade);

  captureMessage('Draft completed successfully', LEVELS.info);

  return true;
};

const handleRepublishClick = (listId) => runThrottled('handleRepublishClick', () => republishWorkflow(listId));

const handleDraftClick = (listId) => runThrottled('handleDraftClick', () => draftWorkflow(listId));

// ============================================================================
// BUTTON INJECTION
// ============================================================================

const createRepublishButton = (listId) => {
  const wrapper = document.createElement('div');

  wrapper.className = 'shrink-0 grow-0 md:basis-auto basis-[calc(50%-1rem)]';
  wrapper.innerHTML = `
    <div
      style="display: flex; width: 100%; background: linear-gradient(135deg, #ff8a4a 0%, #ec5a13 100%); border-radius: 0.5rem; overflow: hidden;">
      <button
        data-lbc-republish-btn="${listId}"
        data-spark-component="button"
        type="button"
        class="u-shadow-border-transition box-border inline-flex items-center justify-center gap-md whitespace-nowrap default:px-lg text-body-1 font-bold focus-visible:u-outline min-w-sz-44 h-sz-44 cursor-pointer w-full"
        style="background: transparent; color: white; transition: background 0.15s;"
        onmouseover="this.style.background='rgba(0,0,0,0.14)'"
        onmouseout="this.style.background='transparent'"
        aria-busy="false"
        aria-live="off"
        title="Republier cette annonce">✨ Republier</button>
      <button
        data-lbc-menu-toggle
        type="button"
        class="u-shadow-border-transition box-border inline-flex items-center justify-center text-body-1 font-bold focus-visible:u-outline h-sz-44 cursor-pointer"
        style="background: transparent; color: white; border-left: 1px solid rgba(255,255,255,0.35); padding: 0 12px; transition: background 0.15s;"
        onmouseover="this.style.background='rgba(0,0,0,0.14)'"
        onmouseout="this.style.background='transparent'"
        aria-haspopup="menu"
        aria-expanded="false"
        title="Plus d'actions"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-three-dots-vertical" viewBox="0 0 16 16">
  <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>
</svg></button>
    </div>
    `;

  const republishButton = wrapper.querySelector('[data-lbc-republish-btn]');
  const menuToggle = wrapper.querySelector('[data-lbc-menu-toggle]');

  // The menu lives in document.body (position: fixed) while open, so it cannot
  // be clipped by the ad card's overflow or trapped in its stacking context
  const menu = document.createElement('div');

  menu.setAttribute('role', 'menu');
  menu.style.cssText = `
    position: fixed;
    z-index: 999999;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    min-width: 200px;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  `;
  menu.innerHTML = `
    <button
      data-lbc-draft-btn
      type="button"
      role="menuitem"
      style="display: block; width: 100%; padding: 10px 14px; background: none; border: none; text-align: left; font-size: 14px; color: #1a1a1a; cursor: pointer; transition: background 0.15s;"
      onmouseover="this.style.background='#ffe9dc'"
      onmouseout="this.style.background='none'"
      title="Créer uniquement un brouillon, l'annonce reste en ligne">📝 Créer un brouillon</button>
  `;

  const draftButton = menu.querySelector('[data-lbc-draft-btn]');

  const closeMenu = () => {
    menu.remove();
    menuToggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onOutsideClick, true);
    window.removeEventListener('scroll', closeMenu, true);
    window.removeEventListener('resize', closeMenu);
  };

  const onOutsideClick = (event) => {
    if (!menu.contains(event.target) && !menuToggle.contains(event.target)) {
      closeMenu();
    }
  };

  const openMenu = () => {
    const rect = menuToggle.getBoundingClientRect();

    menu.style.top = `${rect.bottom + 4}px`;
    menu.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    document.body.appendChild(menu);
    menuToggle.setAttribute('aria-expanded', 'true');
    // Capture phase: still fires if the site stops propagation in bubble phase
    document.addEventListener('click', onOutsideClick, true);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
  };

  menuToggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (menu.isConnected) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  republishButton.addEventListener('click', () => handleRepublishClick(listId));

  draftButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    handleDraftClick(listId);
  });

  return wrapper;
};

const shouldInjectButton = (adItem) => {
  if (adItem.querySelector(CONFIG.selectors.republishButton)) {
    return false;
  }

  const adLink = adItem.querySelector(CONFIG.selectors.adLink);

  if (!adLink) {
    return false;
  }

  const listId = extractListId(adLink.getAttribute('href'));

  if (!listId) {
    return false;
  }

  const buttonContainer = adItem.querySelector(CONFIG.selectors.buttonContainer);

  if (!buttonContainer) {
    return false;
  }

  return { listId, buttonContainer };
};

export const injectRepublishButtons = () => {
  console.log('Injection des boutons de republication...');

  try {
    const adItems = document.querySelectorAll(CONFIG.selectors.adContainer);
    let injectedCount = 0;

    adItems.forEach(adItem => {
      const result = shouldInjectButton(adItem);

      if (result) {
        const { listId, buttonContainer } = result;
        const republishButton = createRepublishButton(listId);

        buttonContainer.appendChild(republishButton);
        injectedCount++;
      }
    });

    console.log(`✓ ${injectedCount} boutons injectés sur ${adItems.length} annonces`);
    if (injectedCount > 0) {
      captureMessage('Injected buttons', LEVELS.info, { count: injectedCount, total: adItems.length });
    }
  } catch (error) {
    captureError(error, { action: 'injectRepublishButtons' });
    console.error('Erreur lors de l\'injection des boutons:', error);
  }
};

// ============================================================================
// DOM OBSERVER
// ============================================================================

const debouncedInject = debounce(injectRepublishButtons, CONFIG.delays.buttonInjection);

const hasAdContainerChanges = (mutations) => mutations.some(mutation =>
  Array.from(mutation.addedNodes).some(node => {
    if (node.nodeType !== 1) {
      return false;
    }

    return node.matches?.(CONFIG.selectors.adContainer) ||
             node.querySelector?.(CONFIG.selectors.adContainer);
  })
);

export const observeAdChanges = () => {
  const observer = new MutationObserver((mutations) => {
    if (hasAdContainerChanges(mutations)) {
      console.log('Annonces modifiées, ré-injection des boutons...');
      debouncedInject();
    }
  });

  // Watch the ad list container specifically, fallback to body if not found
  const adListContainer = document.querySelector(CONFIG.selectors.adListContainer);
  const targetElement = adListContainer || document.body;

  observer.observe(targetElement, {
    childList: true,
    subtree: true
  });

  console.log(`Observer attaché à: ${adListContainer ? 'ad-list-container' : 'document.body'}`);
};

export const scheduleRetries = () => {
  CONFIG.delays.retryAttempts.forEach(delay => {
    setTimeout(injectRepublishButtons, delay);
  });
};

