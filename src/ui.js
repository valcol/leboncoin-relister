// ============================================================================
// UI & DOM MANAGEMENT
// ============================================================================

import { captureError, captureMessage, LEVELS } from './logger.js';
import { debounce, extractListId } from './utils.js';
import { NotificationManager } from './notifications.js';
import { fetchAdData, deleteAd, createAdViaAPI } from './api.js';
import { CONFIG } from './config.js';

// ============================================================================
// USER INTERACTION
// ============================================================================

const fieldStyle = `
  width: 100%;
  box-sizing: border-box;
  background: #1e2024;
  color: #e4e4e7;
  border: 1px solid #3f4147;
  border-radius: 6px;
  padding: 8px 10px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 13px;
  outline: none;
  margin-top: 4px;
`;

const labelStyle = `
  display: block;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-top: 14px;
`;

const showEditModal = (adData) => new Promise((resolve) => {
  const overlay = document.createElement('div');

  overlay.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    z-index: 999998;
    display: flex;
    align-items: center;
    justify-content: center;
  `;

  const card = document.createElement('div');

  card.style.cssText = `
    background: #2b2d31;
    color: #e4e4e7;
    padding: 20px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.5);
    border-left: 3px solid #ff8a4a;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    width: 480px;
    max-width: 90vw;
  `;

  const title = document.createElement('div');

  title.style.cssText = 'font-weight: 600; font-size: 14px; margin-bottom: 4px;';
  title.textContent = 'Modifier l\'annonce';

  const labelSubject = document.createElement('label');

  labelSubject.style.cssText = labelStyle;
  labelSubject.textContent = 'Titre';

  const inputSubject = document.createElement('input');

  inputSubject.type = 'text';
  inputSubject.value = adData.subject;
  inputSubject.style.cssText = fieldStyle;

  const labelBody = document.createElement('label');

  labelBody.style.cssText = labelStyle;
  labelBody.textContent = 'Description';

  const inputBody = document.createElement('textarea');

  inputBody.value = adData.body;
  inputBody.rows = 5;
  inputBody.style.cssText = fieldStyle + 'resize: vertical;';

  const labelPrice = document.createElement('label');

  labelPrice.style.cssText = labelStyle;
  labelPrice.textContent = 'Prix (€)';

  const inputPrice = document.createElement('input');

  inputPrice.type = 'number';
  inputPrice.min = '0';
  inputPrice.step = '1';
  inputPrice.value = adData.price;
  inputPrice.style.cssText = fieldStyle;

  const errorMsg = document.createElement('div');

  errorMsg.style.cssText = `
    color: #ef4444;
    font-size: 12px;
    margin-top: 10px;
    min-height: 16px;
  `;

  const btnRow = document.createElement('div');

  btnRow.style.cssText = 'display: flex; gap: 8px; margin-top: 16px; justify-content: flex-end;';

  const btnCancel = document.createElement('button');

  btnCancel.type = 'button';
  btnCancel.textContent = 'Annuler';
  btnCancel.style.cssText = `
    background: #3f4147;
    color: #e4e4e7;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  `;

  const btnSubmit = document.createElement('button');

  btnSubmit.type = 'button';
  btnSubmit.textContent = '✨ Republier';
  btnSubmit.style.cssText = `
    background: linear-gradient(135deg, #ff8a4a 0%, #ec5a13 100%);
    color: white;
    border: none;
    border-radius: 6px;
    padding: 8px 16px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  `;

  const close = (result) => { overlay.remove(); resolve(result); };

  btnCancel.addEventListener('click', () => close(null));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });

  btnSubmit.addEventListener('click', () => {
    const subject = inputSubject.value.trim();
    const body = inputBody.value;
    const price = parseFloat(inputPrice.value);

    if (!subject) {
      errorMsg.textContent = 'Le titre ne peut pas être vide.';
      return;
    }

    if (isNaN(price) || price <= 0) {
      errorMsg.textContent = 'Prix invalide. Veuillez entrer un nombre positif.';
      return;
    }

    close({ subject, body, price });
  });

  btnRow.appendChild(btnCancel);
  btnRow.appendChild(btnSubmit);

  card.appendChild(title);
  card.appendChild(labelSubject);
  card.appendChild(inputSubject);
  card.appendChild(labelBody);
  card.appendChild(inputBody);
  card.appendChild(labelPrice);
  card.appendChild(inputPrice);
  card.appendChild(errorMsg);
  card.appendChild(btnRow);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
  inputSubject.focus();
});

// ============================================================================
// REPUBLISH WORKFLOW
// ============================================================================

const handleRepublishClick = async (listId) => {
  console.log(`Republication de l'annonce ${listId}...`);
  captureMessage('Starting republish process', LEVELS.info);

  const loadingNotif = NotificationManager.show(NotificationManager.loading('Chargement des données...'));

  try {
    const adData = await fetchAdData(listId);

    loadingNotif.remove();

    const edits = await showEditModal(adData);

    if (edits === null) {
      captureMessage('Republish cancelled by user', LEVELS.info);

      return;
    }

    const updatedAdData = { ...adData, ...edits };

    const publishingNotif = NotificationManager.show(NotificationManager.publishing());
    const adId = await createAdViaAPI(updatedAdData);

    publishingNotif.remove();

    const deletingNotif = NotificationManager.show(NotificationManager.deleting());

    await deleteAd(listId);
    deletingNotif.remove();

    const successNotif = NotificationManager.show(NotificationManager.success(adId));

    NotificationManager.fadeOut(successNotif, CONFIG.delays.notificationFade);

    captureMessage('Republish completed successfully', LEVELS.info);
  } catch (error) {
    console.error('Erreur de republication:', error);
    captureError(error, {
      action: 'handleRepublishClick',
      step: 'republish_process'
    });

    NotificationManager.removeMultiple('lbc-loading', 'lbc-deleting', 'lbc-publishing');

    const errorNotif = NotificationManager.show(NotificationManager.error(error.message));

    setTimeout(() => errorNotif.remove(), CONFIG.delays.notificationError);
  }
};

// ============================================================================
// BUTTON INJECTION
// ============================================================================

const createRepublishButton = (listId) => {
  const wrapper = document.createElement('div');

  wrapper.className = 'shrink-0 grow-0 md:basis-auto basis-[calc(50%-1rem)]';
  wrapper.innerHTML = `
    <button
      data-lbc-republish-btn="${listId}"
      data-spark-component="button"
      type="button"
      class="u-shadow-border-transition box-border inline-flex items-center justify-center gap-md whitespace-nowrap default:px-lg text-body-1 font-bold focus-visible:u-outline min-w-sz-44 h-sz-44 rounded-lg cursor-pointer w-full"
      style="background: linear-gradient(135deg, #ff8a4a 0%, #ec5a13 100%); color: white;"
      onmouseover="this.style.transform='scale(1.02)'"
      onmouseout="this.style.transform='scale(1)'"
      aria-busy="false"
      aria-live="off"
      title="Republier cette annonce">✨ Republier</button>
    `;

  const button = wrapper.querySelector('button');

  button.addEventListener('click', () => handleRepublishClick(listId));

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

