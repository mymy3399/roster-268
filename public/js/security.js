const ALLOWED_PHOTO_PATHS = ['/photos/', '/data/photo/', 'photos/'];
const DATA_IMAGE_PATTERN = /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=\s]+$/i;
const BLOCKED_ELEMENTS = new Set(['base', 'embed', 'iframe', 'link', 'meta', 'object', 'script', 'style']);
const URL_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'src', 'xlink:href']);

export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]
  );
}

export function safePhotoUrl(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  if (DATA_IMAGE_PATTERN.test(candidate)) return candidate;

  try {
    const url = new URL(candidate, window.location.href);
    const isSameOrigin = url.origin === window.location.origin;
    const hasAllowedPath = ALLOWED_PHOTO_PATHS.some((prefix) => url.pathname.includes(prefix));
    return isSameOrigin && hasAllowedPath ? `${url.pathname}${url.search}` : '';
  } catch (error) {
    return '';
  }
}

export function safeTelephone(value) {
  const telephone = String(value || '').trim();
  return /^[0-9+().\-\s]{3,20}$/.test(telephone) ? telephone : '';
}

export function escapeVCard(value) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function isSafeMarkupUrl(attribute, value) {
  const candidate = String(value || '').trim();
  if (!candidate) return true;
  if (attribute === 'src') return Boolean(safePhotoUrl(candidate));
  if (candidate.startsWith('#')) return true;
  try {
    const url = new URL(candidate, window.location.origin);
    return url.origin === window.location.origin && ['http:', 'https:'].includes(url.protocol);
  } catch (error) {
    return false;
  }
}

export function renderSafeHtml(container, markup) {
  const documentNode = new DOMParser().parseFromString(
    `<template id="content">${String(markup)}</template>`,
    'text/html'
  );
  const template = documentNode.getElementById('content');

  for (const element of [...template.content.querySelectorAll('*')]) {
    if (BLOCKED_ELEMENTS.has(element.localName)) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')
          || name === 'srcdoc'
          || (URL_ATTRIBUTES.has(name) && !isSafeMarkupUrl(name, attribute.value))) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  container.replaceChildren(document.importNode(template.content, true));
}
