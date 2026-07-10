// ============================================================================
// API FUNCTIONS
// ============================================================================

import { captureError, captureMessage, LEVELS } from './logger.js';
import { getAuthToken, buildExperimentHeader, buildHeaders } from './auth.js';
import { delay, jitteredDelay } from './utils.js';
import { CONFIG } from './config.js';

// ============================================================================
// DATA PROCESSING
// ============================================================================

export const cleanPayload = (adData) => {
  const payload = {
    ...adData,
    tracking_dd: CONFIG.tracking.dd,
    price_cents: typeof adData.price === 'number'
      ? Math.round(adData.price * 100).toString()
      : adData.price_cents
  };

  CONFIG.readOnlyFields.forEach(field => delete payload[field]);

  return payload;
};

const handleApiResponse = async (response, action) => {
  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Erreur ${action}: ${response.status} ${errorText}`);

    error.status = response.status;

    captureError(error, { status: response.status, action });
    throw error;
  }

  return response;
};

// ============================================================================
// API CALLS
// ============================================================================

export const fetchAdData = async (listId) => {
  console.log(`Récupération des données de l'annonce ${listId}...`);
  captureMessage('Fetching ad data', LEVELS.info);

  const authToken = getAuthToken();
  const response = await fetch(CONFIG.api.adData(listId), {
    method: 'GET',
    headers: {
      accept: CONFIG.headers.accept,
      authorization: `Bearer ${authToken}`,
      'content-type': CONFIG.headers.contentType
    },
    credentials: 'include'
  });

  await handleApiResponse(response, 'fetchAdData');
  const data = await response.json();

  console.log('✓ Données d\'annonce récupérées');

  return data;
};

export const deleteAd = async (listId) => {
  console.log(`Suppression de l'annonce ${listId}...`);
  captureMessage('Deleting ad', LEVELS.info);

  const authToken = getAuthToken();
  const response = await fetch(CONFIG.api.deleteAd, {
    method: 'DELETE',
    headers: {
      accept: CONFIG.headers.accept,
      api_key: CONFIG.headers.deleteApiKey,
      authorization: `Bearer ${authToken}`,
      'content-type': CONFIG.headers.contentType,
      origin: CONFIG.headers.origin,
      referer: CONFIG.referers.deletion
    },
    body: JSON.stringify({ list_ids: [parseInt(listId, 10)] }),
    credentials: 'include'
  });

  await handleApiResponse(response, 'deleteAd');
  console.log('✓ Annonce supprimée avec succès');
};

const createAdDraft = async (payload, authToken, experimentHeader) => {
  console.log('Étape 1: Création du brouillon...');
  const response = await fetch(CONFIG.api.createAd, {
    method: 'POST',
    headers: buildHeaders(authToken, experimentHeader, CONFIG.referers.deposit),
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  await handleApiResponse(response, 'createAdDraft');
  const data = await response.json();

  console.log('✓ Brouillon créé');

  if (!data.ad_id) {
    throw new Error('Pas d\'ad_id dans la réponse');
  }

  return {
    ad_id: data.ad_id,
    action_id: data.action_id || 1
  };
};

const fetchPricingId = async (adId, actionId, categoryId, authToken, experimentHeader) => {
  console.log('Étape 2: Récupération du pricing_id...');
  const payload = {
    user_journey: 'deposit',
    page_name: 'option',
    classifieds: [{
      ad_id: adId,
      category: categoryId.toString(),
      action_id: actionId
    }],
    is_edit_refused: false
  };

  const response = await fetch(CONFIG.api.pricing, {
    method: 'POST',
    headers: buildHeaders(authToken, experimentHeader, CONFIG.referers.options),
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  await handleApiResponse(response, 'fetchPricingId');
  const data = await response.json();

  console.log('✓ Tarification récupérée');

  if (!data.pricing_id) {
    throw new Error('Pas de pricing_id dans la réponse');
  }

  return data.pricing_id;
};

const publishAd = async (adId, actionId, adType, pricingId, authToken, experimentHeader) => {
  console.log('Étape 3: Publication de l\'annonce...');
  const payload = {
    ads: [{
      ad_type: adType,
      ad_id: adId,
      options: [],
      action_id: actionId,
      transaction_type: 'new_ad'
    }],
    pricing_id: pricingId,
    user_journey: 'deposit'
  };

  await delay(CONFIG.delays.beforeSubmit);

  const response = await fetch(CONFIG.api.submit, {
    method: 'POST',
    headers: buildHeaders(authToken, experimentHeader, CONFIG.referers.options),
    credentials: 'include',
    body: JSON.stringify(payload)
  });

  await handleApiResponse(response, 'publishAd');
  await response.json();
  console.log('✓ Annonce publiée');
};

export const createAdViaAPI = async (adData) => {
  console.log('Création de l\'annonce via l\'API...');
  captureMessage('Creating ad via API', LEVELS.info, {
    category: adData.category_name,
    price: adData.price
  });

  const authToken = getAuthToken();
  const experimentHeader = buildExperimentHeader();
  const payload = cleanPayload(adData);

  await jitteredDelay(CONFIG.throttle.betweenStepsMinMs, CONFIG.throttle.betweenStepsMaxMs);
  const { ad_id, action_id } = await createAdDraft(payload, authToken, experimentHeader);

  await jitteredDelay(CONFIG.throttle.betweenStepsMinMs, CONFIG.throttle.betweenStepsMaxMs);
  const pricing_id = await fetchPricingId(ad_id, action_id, payload.category_id, authToken, experimentHeader);

  await publishAd(ad_id, action_id, payload.ad_type, pricing_id, authToken, experimentHeader);

  captureMessage('Successfully created ad', LEVELS.info, { price: adData.price });

  return ad_id;
};

