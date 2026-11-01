// ============================================================================
// UI & DOM MANAGEMENT
// ============================================================================

import { captureError, captureMessage, LEVELS } from './logger.js';
import { debounce, extractListId, jitteredDelay, pluralize } from './utils.js';
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

const confirmBulk = (action, ads) => confirm(
  `${action.confirmTitle} — ${ads.length} ${pluralize(ads.length, 'annonce')}:\n\n` +
    ads.map(({ title }) => `📋 ${title}`).join('\n') + '\n\n' +
    action.confirmNote
);

const confirmModifyDraft = (adData) => confirm(
  '📝 Modifier avant republication:\n\n' +
    `📋 ${adData.subject}\n` +
    `💰 ${adData.price} €\n` +
    `📁 ${adData.category_name}\n\n` +
    'L\'ancienne annonce sera supprimée et vous serez redirigé vers le brouillon. Continuer?'
);

const confirmClone = (adData) => confirm(
  '🐑 Cloner en brouillon:\n\n' +
    `📋 ${adData.subject}\n` +
    `💰 ${adData.price} €\n` +
    `📁 ${adData.category_name}\n\n` +
    'Un brouillon sera créé, l\'annonce originale restera en ligne. Continuer?'
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

    NotificationManager.removeMultiple(
      'lbc-loading', 'lbc-deleting', 'lbc-publishing', 'lbc-drafting', 'lbc-bulk-progress'
    );

    const errorNotif = NotificationManager.show(NotificationManager.error(error.message));

    setTimeout(() => errorNotif.remove(), CONFIG.delays.notificationError);
  } finally {
    isBusy = false;
  }
};

// Per-ad steps, shared by the single-ad and bulk workflows
const loadAdData = async (listId) => {
  const loadingNotif = NotificationManager.show(NotificationManager.loading('Chargement des données...'));
  const adData = await fetchAdData(listId);

  loadingNotif.remove();

  return adData;
};

const createDraft = async (adData) => {
  const draftingNotif = NotificationManager.show(NotificationManager.creatingDraft());
  const draftId = await createDraftViaAPI(adData);

  draftingNotif.remove();

  return draftId;
};

const deleteOldAd = async (listId) => {
  const deletingNotif = NotificationManager.show(NotificationManager.deleting());

  await jitteredDelay(CONFIG.throttle.betweenStepsMinMs, CONFIG.throttle.betweenStepsMaxMs);
  await deleteAd(listId);
  deletingNotif.remove();
};

const publishAndDelete = async (listId, adData) => {
  const publishingNotif = NotificationManager.show(NotificationManager.publishing());
  const adId = await createAdViaAPI(adData);

  publishingNotif.remove();
  await deleteOldAd(listId);

  return adId;
};

const draftAndDelete = async (listId, adData) => {
  const draftId = await createDraft(adData);

  await deleteOldAd(listId);

  return draftId;
};

const republishWorkflow = async (listId) => {
  console.log(`Republication de l'annonce ${listId}...`);
  captureMessage('Starting republish process', LEVELS.info);

  const adData = await loadAdData(listId);
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

  const adId = await publishAndDelete(listId, updatedAdData);
  const successNotif = NotificationManager.show(NotificationManager.success(adId));

  NotificationManager.fadeOut(successNotif, CONFIG.delays.notificationFade);

  captureMessage('Republish completed successfully', LEVELS.info);

  return true;
};

const modifyDraftWorkflow = async (listId) => {
  console.log(`Création d'un brouillon (modification) pour l'annonce ${listId}...`);
  captureMessage('Starting modify-draft process', LEVELS.info);

  const adData = await loadAdData(listId);

  if (!confirmModifyDraft(adData)) {
    console.log('Modification annulée');
    captureMessage('Modify-draft cancelled by user confirmation', LEVELS.info);

    return false;
  }

  const draftId = await draftAndDelete(listId, adData);

  captureMessage('Modify-draft completed successfully', LEVELS.info);

  // Navigate to the draft finalize page (leaves the dashboard)
  window.location.assign(CONFIG.pages.draftEdit(draftId));

  return true;
};

const cloneWorkflow = async (listId) => {
  console.log(`Clonage en brouillon de l'annonce ${listId}...`);
  captureMessage('Starting clone process', LEVELS.info);

  const adData = await loadAdData(listId);

  if (!confirmClone(adData)) {
    console.log('Clonage annulé');
    captureMessage('Clone cancelled by user confirmation', LEVELS.info);

    return false;
  }

  const draftId = await createDraft(adData);
  const successNotif = NotificationManager.show(NotificationManager.draftSuccess(CONFIG.pages.draftEdit(draftId)));

  NotificationManager.fadeOut(successNotif, CONFIG.delays.notificationFade);

  captureMessage('Clone completed successfully', LEVELS.info);

  return true;
};

// Bulk variants of the button's actions: the same per-ad steps, run one ad after the other
const BULK_ACTIONS = {
  republish: {
    name: 'handleBulkRepublishClick',
    confirmTitle: '✅ Republier',
    confirmNote: 'Les prix actuels seront conservés et les anciennes annonces supprimées. Lancer la republication automatique?',
    runOnAd: (listId, adData) => publishAndDelete(listId, adData),
    summaryTitle: (count) => `${count} ${pluralize(count, 'annonce')} ${pluralize(count, 'republiée')}`,
    failureHint: 'Champs obligatoires manquants, utilisez « Modifier avant republication (brouillon) » pour :',
    createsDrafts: false,
    deletesAds: true
  },
  modifyDraft: {
    name: 'handleBulkModifyDraftClick',
    confirmTitle: '📝 Modifier avant republication',
    confirmNote: 'Un brouillon sera créé pour chaque annonce, puis l\'annonce sera supprimée. Continuer?',
    runOnAd: (listId, adData) => draftAndDelete(listId, adData),
    summaryTitle: (count) => `${count} ${pluralize(count, 'brouillon')} ${pluralize(count, 'créé')}`,
    failureHint: 'Brouillon refusé pour :',
    createsDrafts: true,
    deletesAds: true
  },
  clone: {
    name: 'handleBulkCloneClick',
    confirmTitle: '🐑 Cloner en brouillon',
    confirmNote: 'Un brouillon sera créé pour chaque annonce, les annonces originales resteront en ligne. Continuer?',
    runOnAd: (_listId, adData) => createDraft(adData),
    summaryTitle: (count) => `${count} ${pluralize(count, 'brouillon')} ${pluralize(count, 'créé')}`,
    failureHint: 'Brouillon refusé pour :',
    createsDrafts: true,
    deletesAds: false
  }
};

const bulkWorkflow = async (action, ads) => {
  if (ads.length === 0) {
    return false;
  }

  console.log(`${action.name}: ${ads.length} annonces...`);
  captureMessage('Starting bulk process', LEVELS.info, { action: action.name, count: ads.length });

  if (!confirmBulk(action, ads)) {
    console.log('Action groupée annulée');
    captureMessage('Bulk process cancelled by user confirmation', LEVELS.info, { action: action.name });

    return false;
  }

  const done = [];
  const failedTitles = [];
  let stopError = null;

  for (const [index, { listId, title }] of ads.entries()) {
    NotificationManager.remove('lbc-bulk-progress');
    NotificationManager.show(NotificationManager.bulkProgress(index + 1, ads.length, title));

    // Random pause between two ads, on top of the jitter between each API call
    if (index > 0) {
      await jitteredDelay(CONFIG.throttle.betweenAdsMinMs, CONFIG.throttle.betweenAdsMaxMs);
    }

    try {
      const adData = await loadAdData(listId);
      const resultId = await action.runOnAd(listId, adData);

      done.push({ title, resultId });
    } catch (error) {
      // A 400 only concerns this ad (e.g. too old to republish directly). Anything else
      // (auth, rate limit, network) would hit the remaining ads too, so stop there
      if (error.status !== 400) {
        stopError = error;
        break;
      }

      failedTitles.push(title);
    }
  }

  NotificationManager.remove('lbc-bulk-progress');

  // Shown even when interrupted, so the drafts already created stay reachable
  if (done.length > 0 || failedTitles.length > 0) {
    const drafts = action.createsDrafts
      ? done.map(({ title, resultId }) => ({ title, url: CONFIG.pages.draftEdit(resultId) }))
      : [];
    const summaryNotif = NotificationManager.show(NotificationManager.bulkSummary({
      title: action.summaryTitle(done.length),
      drafts,
      failureHint: action.failureHint,
      failedTitles,
      refreshHint: action.deletesAds
    }));

    if (drafts.length === 0) {
      NotificationManager.fadeOut(
        summaryNotif,
        failedTitles.length > 0 ? CONFIG.delays.notificationError : CONFIG.delays.notificationFade
      );
    }
  }

  if (stopError) {
    const processedCount = done.length + failedTitles.length;
    const interruptedError = new Error(
      `Interrompu après ${processedCount}/${ads.length} ${pluralize(ads.length, 'annonce')}: ${stopError.message}`
    );

    interruptedError.status = stopError.status;
    throw interruptedError;
  }

  captureMessage('Bulk process completed', LEVELS.info, {
    action: action.name,
    succeeded: done.length,
    failed: failedTitles.length
  });

  return true;
};

const handleRepublishClick = (listId) => runThrottled('handleRepublishClick', () => republishWorkflow(listId));

const handleModifyDraftClick = (listId) => runThrottled('handleModifyDraftClick', () => modifyDraftWorkflow(listId));

const handleCloneClick = (listId) => runThrottled('handleCloneClick', () => cloneWorkflow(listId));

const handleBulkClick = (action) => runThrottled(action.name, () => bulkWorkflow(action, getSelectedAds()));

// ============================================================================
// BUTTON INJECTION
// ============================================================================

// Split button "✨ Republier | ⋮", shared by the ad cards and the selection toolbar.
// marker: attribute flagging the injected button; className: layout classes for where it goes
const createActionButton = ({ marker, className, title, onRepublish, onModifyDraft, onClone }) => {
  const container = document.createElement('div');

  container.setAttribute(marker, '');
  // rounded-full: same pill shape as leboncoin's buttons. vertical-align: inline in the toolbar,
  // the emoji shifts the baseline, which would sit the button lower than its neighbours
  container.className = `inline-flex rounded-full ${className}`;
  container.style.cssText = 'vertical-align: top; background: linear-gradient(135deg, #ff8a4a 0%, #ec5a13 100%); overflow: hidden;';
  container.innerHTML = `
    <button
      data-lbc-republish-action
      data-spark-component="button"
      type="button"
      class="u-shadow-border-transition box-border inline-flex items-center justify-center gap-md whitespace-nowrap default:px-lg text-body-1 font-bold focus-visible:u-outline min-w-sz-44 h-sz-44 cursor-pointer grow"
      style="background: transparent; color: white; transition: background 0.15s;"
      onmouseover="if (!this.disabled) this.style.background='rgba(0,0,0,0.14)'"
      onmouseout="this.style.background='transparent'"
      aria-busy="false"
      aria-live="off"
      title="${title}">✨ Republier</button>
    <button
      data-lbc-menu-toggle
      type="button"
      class="u-shadow-border-transition box-border inline-flex items-center justify-center text-body-1 font-bold focus-visible:u-outline h-sz-44 cursor-pointer"
      style="background: transparent; color: white; border-left: 1px solid rgba(255,255,255,0.35); padding: 0 12px; transition: background 0.15s;"
      onmouseover="if (!this.disabled) this.style.background='rgba(0,0,0,0.14)'"
      onmouseout="this.style.background='transparent'"
      aria-haspopup="menu"
      aria-expanded="false"
      title="Plus d'actions"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-three-dots-vertical" viewBox="0 0 16 16">
  <path d="M9.5 13a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0m0-5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0"/>
</svg></button>
  `;

  const republishButton = container.querySelector('[data-lbc-republish-action]');
  const menuToggle = container.querySelector('[data-lbc-menu-toggle]');

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
      data-lbc-modify-draft-btn
      type="button"
      role="menuitem"
      style="display: block; width: 100%; padding: 10px 14px; background: none; border: none; text-align: left; font-size: 14px; color: #1a1a1a; cursor: pointer; transition: background 0.15s;"
      onmouseover="this.style.background='#ffe9dc'"
      onmouseout="this.style.background='none'"
      title="Crée un brouillon à modifier, puis supprime l'annonce">📝 Modifier avant republication (brouillon)</button>
    <button
      data-lbc-clone-btn
      type="button"
      role="menuitem"
      style="display: block; width: 100%; padding: 10px 14px; background: none; border: none; text-align: left; font-size: 14px; color: #1a1a1a; cursor: pointer; transition: background 0.15s;"
      onmouseover="this.style.background='#ffe9dc'"
      onmouseout="this.style.background='none'"
      title="Crée un brouillon, l'annonce originale reste en ligne">🐑 Cloner (brouillon)</button>
  `;

  const modifyDraftButton = menu.querySelector('[data-lbc-modify-draft-btn]');
  const cloneButton = menu.querySelector('[data-lbc-clone-btn]');

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

  republishButton.addEventListener('click', onRepublish);

  modifyDraftButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    onModifyDraft();
  });

  cloneButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    onClone();
  });

  return container;
};

const createRepublishButton = (listId) => {
  const wrapper = document.createElement('div');

  wrapper.className = 'shrink-0 grow-0 md:basis-auto basis-[calc(50%-1rem)]';
  wrapper.appendChild(createActionButton({
    marker: 'data-lbc-republish-btn',
    className: 'w-full',
    title: 'Republier cette annonce',
    onRepublish: () => handleRepublishClick(listId),
    onModifyDraft: () => handleModifyDraftClick(listId),
    onClone: () => handleCloneClick(listId)
  }));

  return wrapper;
};

const isAdPaused = (adItem) =>
  adItem.textContent?.toLowerCase().includes(CONFIG.pausedAdText);

// Ads ticked in leboncoin's own selection checkboxes, minus paused ones
const getSelectedAds = () => Array.from(document.querySelectorAll(CONFIG.selectors.adContainer))
  .filter(adItem => adItem.querySelector(CONFIG.selectors.selectedAdCheckbox) && !isAdPaused(adItem))
  .map(adItem => {
    const listId = extractListId(adItem.querySelector(CONFIG.selectors.adLink)?.getAttribute('href'));
    const title = adItem.querySelector(CONFIG.selectors.adTitle)?.getAttribute('title') || `Annonce ${listId}`;

    return { listId, title };
  })
  .filter(({ listId }) => listId);

const createBulkRepublishButton = () => createActionButton({
  marker: 'data-lbc-bulk-republish-btn',
  // Same spacing as the native toolbar buttons next to it
  className: 'mr-sm lg:mr-lg',
  title: 'Republier les annonces sélectionnées',
  onRepublish: () => handleBulkClick(BULK_ACTIONS.republish),
  onModifyDraft: () => handleBulkClick(BULK_ACTIONS.modifyDraft),
  onClone: () => handleBulkClick(BULK_ACTIONS.clone)
});

// Disabled like the native toolbar buttons while nothing is selected
const syncBulkRepublishButtons = () => {
  const hasSelection = getSelectedAds().length > 0;

  document.querySelectorAll(CONFIG.selectors.bulkRepublishButton).forEach(container => {
    container.classList.toggle('opacity-dim-3', !hasSelection);
    container.querySelectorAll('button').forEach(button => {
      button.disabled = !hasSelection;
      button.classList.toggle('cursor-pointer', hasSelection);
      button.classList.toggle('cursor-not-allowed', !hasSelection);
    });
  });
};

// The toolbar is capped in width: turning "Remontez votre annonce" into an icon frees the room
// for the bulk button. React owns the text node, so it is hidden (font-size: 0) rather than removed
const compactBumpButton = (bar) => {
  const bumpButton = bar.querySelector(CONFIG.selectors.bumpButton);

  if (!bumpButton || bumpButton.hasAttribute('data-lbc-compacted')) {
    return;
  }

  const label = bumpButton.textContent.trim();

  bumpButton.setAttribute('data-lbc-compacted', '');
  bumpButton.title = label;
  bumpButton.setAttribute('aria-label', label);
  bumpButton.style.fontSize = '0';
  bumpButton.style.gap = '0';
};

const injectBulkRepublishButtons = () => {
  document.querySelectorAll(CONFIG.selectors.bulkActionBar).forEach(bar => {
    compactBumpButton(bar);

    if (!bar.querySelector(CONFIG.selectors.bulkRepublishButton)) {
      // Prepended: React re-renders the trailing "Supprimer" item, so appending would get reordered
      bar.prepend(createBulkRepublishButton());
    }
  });

  syncBulkRepublishButtons();
};

const shouldInjectButton = (adItem) => {
  if (adItem.querySelector(CONFIG.selectors.republishButton)) {
    return false;
  }

  // Paused ads can't be republished, skip them
  if (isAdPaused(adItem)) {
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

    injectBulkRepublishButtons();

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

    // Ad checkboxes flip aria-checked on (de)selection
    if (mutations.some(mutation => mutation.type === 'attributes')) {
      syncBulkRepublishButtons();
    }
  });

  // Watch the ad list container specifically, fallback to body if not found
  const adListContainer = document.querySelector(CONFIG.selectors.adListContainer);
  const targetElement = adListContainer || document.body;

  observer.observe(targetElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-checked']
  });

  console.log(`Observer attaché à: ${adListContainer ? 'ad-list-container' : 'document.body'}`);
};

export const scheduleRetries = () => {
  CONFIG.delays.retryAttempts.forEach(delay => {
    setTimeout(injectRepublishButtons, delay);
  });
};

