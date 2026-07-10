// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export const escapeHtml = (text) => {
  const div = document.createElement('div');

  div.textContent = text;

  return div.innerHTML;
};

export const extractListId = (url) => {
  const match = url?.match(/\/(\d+)$/);

  return match ? match[1] : null;
};

export const getCookie = (name) => {
  const match = document.cookie.match(new RegExp(`${name}=([^;]+)`));

  return match ? match[1] : null;
};

export const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const jitteredDelay = (min, max) => delay(min + Math.random() * (max - min));

export const debounce = (func, wait) => {
  let timeout;

  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

