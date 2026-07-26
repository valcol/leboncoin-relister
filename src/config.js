// ============================================================================
// CONFIGURATION
// ============================================================================

export const CONFIG = {
  version: process.env.VERSION,
  selectors: {
    adContainer: 'li[data-qa-id="ad_item_container"]',
    adLink: 'a[href*="/ad/"]',
    buttonContainer: '.mt-md.gap-md.flex.flex-wrap',
    republishButton: '[data-lbc-republish-btn]',
    adListContainer: '[data-test-id="ad-list-container"]'
  },
  // Republishing a paused ad makes no sense, so skip ads showing this banner text
  pausedAdText: 'mise en pause',
  delays: {
    buttonInjection: 500,
    pageReload: 3000,
    notificationFade: 6000,
    notificationError: 10000,
    beforeSubmit: 1000,
    fadeOut: 300,
    retryAttempts: [1000, 2000, 3000, 5000]
  },
  throttle: {
    betweenStepsMinMs: 400,
    betweenStepsMaxMs: 1200,
    cooldownMs: 2000,
    backoffBaseMs: 20000,
    backoffMaxMs: 30000
  },
  tracking: {
    dd: 'app:308.2'
  },
  api: {
    baseUrl: 'https://api.leboncoin.fr',
    adData: (listId) => `https://api.leboncoin.fr/api/pintad/v1/public/manual/classified/${listId}`,
    deleteAd: 'https://api.leboncoin.fr/api/pintad/v1/public/manual/delete/ads',
    createAd: 'https://api.leboncoin.fr/api/adsubmit/v2/classifieds?with_variation=true',
    createDraft: 'https://api.leboncoin.fr/api/ad-draft/v1/draft',
    pricing: 'https://api.leboncoin.fr/api/options/v4/pricing/classifieds',
    submit: 'https://api.leboncoin.fr/api/services/v4/submit'
  },
  headers: {
    accept: '*/*',
    acceptLanguage: 'fr-FR,fr;q=0.9',
    contentType: 'application/json',
    origin: 'https://www.leboncoin.fr',
    deleteApiKey: 'ba0c2dad52b3ec'
  },
  referers: {
    deposit: 'https://www.leboncoin.fr/deposer-une-annonce',
    options: 'https://www.leboncoin.fr/deposer-une-annonce/options',
    deletion: 'https://www.leboncoin.fr/compte/mes-annonces/suppression'
  },
  pages: {
    draftEdit: (draftId) => `https://www.leboncoin.fr/brouillon/${draftId}/finaliser`
  },
  readOnlyFields: [
    'list_id', 'ad_id', 'first_publication_date',
    'index_date', 'status', 'url', 'price'
  ]
};

